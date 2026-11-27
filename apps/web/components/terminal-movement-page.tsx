"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, PackageCheck, Play, RefreshCcw, ScanLine, Send, Square, Trash2, Wifi } from "lucide-react";
import { api, type ApiEnvelope, type InventoryMovementResponse, type ScanResult, type TerminalMovementType, type TerminalPreview, type TerminalScanSession, messageFromError } from "@/lib/api";
import { ErrorList, PageState, StatusBadge } from "@/components/ui";

const card = "rounded-xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/10";

type SocketMessage = {
  type: string;
  status?: string;
  code?: string;
  uid?: string;
  message?: string;
  scan_session_id?: string;
  result?: {
    results: ScanResult[];
    errors: Array<{ rfid_number?: string; code: string; message: string }>;
  };
};
type RejectedScan = { rfid_number: string; code: string; message: string };

function websocketUrl() {
  if (process.env.NEXT_PUBLIC_RFID_WS_URL) return process.env.NEXT_PUBLIC_RFID_WS_URL;
  if (typeof window === "undefined") return "ws://localhost:3000/ws";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3000/ws`;
}

function movementLabel(movementType: TerminalMovementType) {
  return movementType === "outbound" ? "Outbound" : "Trash";
}

function scanItemFromResult(result: ScanResult) {
  return {
    ...result,
    product_name: result.product_name || "Produk tidak ditemukan",
    sku: result.sku || "-",
  };
}

export function TerminalMovementPage() {
  const [movementType, setMovementType] = useState<TerminalMovementType>("outbound");
  const [session, setSession] = useState<TerminalScanSession | null>(null);
  const [readerState, setReaderState] = useState("Reader belum dimulai");
  const [scanned, setScanned] = useState<Record<string, ScanResult>>({});
  const [rejected, setRejected] = useState<RejectedScan[]>([]);
  const [preview, setPreview] = useState<TerminalPreview | null>(null);
  const [completed, setCompleted] = useState<InventoryMovementResponse | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const scanSessionRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);

  const stopReader = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const scanSessionId = scanSessionRef.current;
    if (scanSessionId) {
      try {
        await api(`/api/rfid-scan-sessions/${scanSessionId}/stop`, { method: "POST" });
      } catch {
        // The backend may already have expired or stopped the session.
      }
    }
    socketRef.current?.close();
    socketRef.current = null;
    scanSessionRef.current = null;
    setSession(null);
    setReaderState("Reader dihentikan");
    stoppingRef.current = false;
  }, []);

  useEffect(() => () => { void stopReader(); }, [stopReader]);

  const startReader = async () => {
    setPending(true);
    setError("");
    setCompleted(null);
    setPreview(null);
    setScanned({});
    setRejected([]);
    stoppingRef.current = false;
    try {
      const socket = new WebSocket(websocketUrl());
      socketRef.current = socket;
      socket.onopen = async () => {
        socket.send(JSON.stringify({ type: "hello", role: "dashboard" }));
        try {
          const result = await api<ApiEnvelope<TerminalScanSession>>("/api/mobile/placements/terminal-scan-sessions", {
            method: "POST",
            body: JSON.stringify({
              movement_type: movementType,
              reader_code: process.env.NEXT_PUBLIC_RFID_TERMINAL_READER_CODE || "orangepi-reader-02",
            }),
          });
          scanSessionRef.current = result.data.id;
          setSession(result.data);
          socket.send(JSON.stringify({ type: "subscribe", scan_session_id: result.data.id }));
          setReaderState("Menunggu UID dari reader…");
        } catch (startError) {
          setError(messageFromError(startError));
          setReaderState("Reader tidak siap");
          socket.close();
        } finally {
          setPending(false);
        }
      };
      socket.onmessage = (event) => {
        let incoming: SocketMessage;
        try { incoming = JSON.parse(event.data as string) as SocketMessage; } catch { return; }
        if (incoming.type === "hello.accepted" || incoming.type === "subscription.started") return;
        if (incoming.type === "scan.session") {
          setSession((current) => current ? { ...current, status: incoming.status || current.status } : current);
          return;
        }
        if (incoming.type === "reader.ready" || incoming.type === "reader.status") {
          setReaderState(incoming.status === "ready" ? "Reader siap membaca UID" : `Reader: ${incoming.status || "unknown"}`);
          return;
        }
        if (incoming.type === "reader.error" || incoming.type === "scan.error") {
          setError(incoming.message || "Reader atau scan session mengirim error.");
          return;
        }
        if (incoming.type === "scan.duplicate") return;
        if (incoming.type !== "scan.result" || !incoming.result) return;

        const result = incoming.result;
        if (result.results.length) {
          setPreview(null);
          setScanned((current) => {
            const next = { ...current };
            result.results.forEach((item) => { next[item.rfid_number] = scanItemFromResult(item); });
            return next;
          });
          setError("");
        }
        if (result.errors.length) {
          setRejected((current) => {
            const existing = new Set(current.map((item) => `${item.rfid_number}:${item.code}`));
            return [...current, ...result.errors
              .filter((item) => !existing.has(`${item.rfid_number || "-"}:${item.code}`))
              .map((item) => ({ rfid_number: item.rfid_number || "-", code: item.code, message: item.message }))];
          });
        }
      };
      socket.onerror = () => {
        setPending(false);
        setError("Koneksi WebSocket ke backend gagal. Periksa URL API dan koneksi Orange Pi.");
      };
      socket.onclose = () => {
        if (!stoppingRef.current && scanSessionRef.current) setReaderState("Koneksi reader terputus");
        if (!scanSessionRef.current) setPending(false);
      };
    } catch (startError) {
      setPending(false);
      setError(startError instanceof Error ? startError.message : "Reader tidak dapat dimulai.");
    }
  };

  const previewMovement = async () => {
    const rfidNumbers = Object.keys(scanned);
    if (!rfidNumbers.length) {
      setError("Belum ada RFID valid yang terbaca.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await api<ApiEnvelope<TerminalPreview>>(`/api/mobile/placements/${movementType}/preview`, {
        method: "POST",
        body: JSON.stringify({ rfid_numbers: rfidNumbers }),
      });
      setPreview(result.data);
    } catch (previewError) {
      setError(messageFromError(previewError));
    } finally {
      setPending(false);
    }
  };

  const submitMovement = async () => {
    if (!preview?.eligible) {
      setError("Preview belum valid. Pastikan semua RFID eligible sebelum submit.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await api<ApiEnvelope<InventoryMovementResponse>>(`/api/mobile/placements/${movementType}`, {
        method: "POST",
        body: JSON.stringify({
          rfid_numbers: preview.items.map((item) => item.rfid_number),
          client_request_id: `web-${movementType}-${crypto.randomUUID()}`,
        }),
      });
      setCompleted(result.data);
      setPreview(null);
      setScanned({});
      setRejected([]);
      await stopReader();
    } catch (submitError) {
      setError(messageFromError(submitError));
    } finally {
      setPending(false);
    }
  };

  const removeScanned = (uid: string) => {
    setScanned((current) => {
      const next = { ...current };
      delete next[uid];
      return next;
    });
    setPreview(null);
  };

  const scannedItems = Object.values(scanned);
  const isReading = Boolean(session);
  const actionLabel = movementLabel(movementType);

  if (completed) {
    return <section className={card}><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-full bg-emerald-300/10 text-emerald-200"><PackageCheck size={22}/></span><div><h2 className="text-xl font-black">{actionLabel} berhasil</h2><p className="text-sm text-slate-400">{completed.total_processed} paket berhasil diproses dan RFID siap digunakan kembali.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-400">Movement</p><p className="mt-1 font-bold uppercase">{completed.movement_type}</p></div><div className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-400">Total paket</p><p className="mt-1 text-xl font-black">{completed.total_processed}</p></div><div className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-400">Waktu</p><p className="mt-1 text-sm font-semibold">{new Date(completed.processed_at).toLocaleString("id-ID")}</p></div></div><button type="button" onClick={() => setCompleted(null)} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-300 px-4 py-2 text-sm font-bold text-slate-950"><RefreshCcw size={16}/> Proses berikutnya</button></section>;
  }

  return <>
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[.14em] text-teal-300">INVENTORY TERMINAL MOVEMENT</p><h1 className="mt-1 text-2xl font-black md:text-3xl">Outbound / Trash</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Reader hanya membaca UID. Produk tidak berubah sampai preview valid dan submit dikonfirmasi.</p></div><div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"><Wifi size={16} className={isReading ? "text-teal-300" : "text-slate-500"}/><span>{readerState}</span></div></header>
    <ErrorList messages={error ? [error] : []}/>
    <div className="mt-5 grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
      <section className={card}><h2 className="font-bold">1. Pilih proses dan scan</h2><div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-950 p-1"><button type="button" disabled={isReading || pending} onClick={() => { setMovementType("outbound"); setPreview(null); }} className={`rounded-md px-3 py-2 text-sm font-bold ${movementType === "outbound" ? "bg-teal-300 text-slate-950" : "text-slate-300"}`}>Outbound</button><button type="button" disabled={isReading || pending} onClick={() => { setMovementType("trash"); setPreview(null); }} className={`rounded-md px-3 py-2 text-sm font-bold ${movementType === "trash" ? "bg-red-300 text-slate-950" : "text-slate-300"}`}>Trash</button></div><p className="mt-4 text-sm leading-6 text-slate-400">Scan semua paket yang akan diproses menggunakan reader yang sama seperti session PO. UID duplikat otomatis diabaikan oleh backend.</p><div className="mt-5 flex flex-wrap gap-3">{!isReading ? <button type="button" disabled={pending} onClick={() => void startReader()} className="inline-flex items-center gap-2 rounded-lg bg-teal-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"><Play size={16}/> Mulai reader</button> : <button type="button" disabled={pending} onClick={() => void stopReader()} className="inline-flex items-center gap-2 rounded-lg border border-amber-300/50 px-4 py-2 text-sm font-bold text-amber-100 disabled:opacity-50"><Square size={15}/> Stop reader</button>}<button type="button" disabled={pending || isReading || !scannedItems.length} onClick={() => void previewMovement()} className="inline-flex items-center gap-2 rounded-lg border border-teal-300/50 px-4 py-2 text-sm font-bold text-teal-100 disabled:opacity-50"><Eye size={16}/> Preview produk</button></div>{session && <p className="mt-4 font-mono text-xs text-slate-500">scan session: {session.id}</p>}<div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-400">RFID valid</p><p className="mt-1 text-2xl font-black text-teal-200">{scannedItems.length}</p></div><div className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-400">RFID ditolak</p><p className="mt-1 text-2xl font-black text-red-200">{rejected.length}</p></div></div></section>
      <section className={`${card} p-0`}><div className="flex items-center justify-between border-b border-slate-700 p-5"><div><h2 className="font-bold">RFID terbaca</h2><p className="mt-1 text-sm text-slate-400">Produk akan tampil segera setelah UID dinyatakan eligible.</p></div><ScanLine size={20} className="text-teal-300"/></div>{scannedItems.length === 0 ? <PageState>Belum ada RFID valid. Mulai reader lalu dekatkan paket.</PageState> : <div className="divide-y divide-slate-800">{scannedItems.map((item) => <div key={item.rfid_number} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{item.product_name}</p><p className="mt-1 text-xs text-slate-400">{item.sku} · {item.units ?? "-"} {item.base_unit ?? "pcs"} · Paket #{item.pack_number ?? "-"}</p><p className="mt-1 font-mono text-xs text-teal-100">{item.rfid_number}</p></div><button type="button" onClick={() => removeScanned(item.rfid_number)} className="rounded border border-slate-600 p-1.5 text-slate-400 hover:text-red-200" title="Hapus dari daftar preview"><Trash2 size={14}/></button></div><div className="mt-2 flex flex-wrap gap-2 text-xs"><StatusBadge value={item.placement_status || "placed"}/>{item.current_rack && <span className="rounded-full border border-slate-600 px-2 py-0.5 text-slate-300">Rak {item.current_rack.code}</span>}</div></div>)}</div>}{rejected.length > 0 && <div className="border-t border-red-300/20 bg-red-300/5 p-4"><p className="text-sm font-bold text-red-100">UID ditolak</p><ul className="mt-2 space-y-1 text-xs text-red-100">{rejected.map((item, index) => <li key={`${item.rfid_number}-${item.code}-${index}`}><span className="font-mono">{item.rfid_number}</span>: {item.message}</li>)}</ul></div>}</section>
    </div>
    {preview && <section className={`${card} mt-5`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">2. Preview {actionLabel}</h2><p className="mt-1 text-sm text-slate-400">Belum ada perubahan inventory. Semua item harus valid sebelum submit.</p></div><StatusBadge value={preview.eligible ? "eligible" : "rejected"}/></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-y border-slate-700 bg-slate-800/60 text-xs uppercase text-slate-400"><tr><th className="p-3">RFID</th><th className="p-3">Produk</th><th className="p-3">Paket</th><th className="p-3">Rak</th><th className="p-3">Status</th></tr></thead><tbody>{preview.items.map((item) => <tr key={item.rfid_number} className="border-b border-slate-800"><td className="p-3 font-mono text-xs">{item.rfid_number}</td><td className="p-3"><p className="font-semibold">{item.product_name}</p><p className="text-xs text-slate-500">{item.sku}</p></td><td className="p-3">#{item.pack_number} · {item.units} {item.base_unit}</td><td className="p-3">{item.current_rack?.code || "-"}</td><td className="p-3">{item.eligible ? <StatusBadge value="eligible"/> : <div><StatusBadge value="rejected"/><p className="mt-1 max-w-xs text-xs text-red-200">{item.message}</p></div>}</td></tr>)}</tbody></table></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-400">{preview.total_eligible} dari {preview.total_requested} RFID siap diproses.</p><button type="button" disabled={pending || !preview.eligible} onClick={() => void submitMovement()} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50 ${movementType === "trash" ? "bg-red-300 text-slate-950" : "bg-teal-300 text-slate-950"}`}><Send size={16}/> Submit {actionLabel}</button></div></section>}
  </>;
}
