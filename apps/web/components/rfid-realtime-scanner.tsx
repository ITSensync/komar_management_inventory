"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiEnvelope, type PoSessionItem, type RfidProgress, type ScanResponse, messageFromError } from "@/lib/api";
import { ErrorList, Field } from "@/components/ui";

type ScanSession = { id: string; po_session_item_id: string; reader_code: string; status: string; expires_at: string };
type SocketMessage = {
  type: string;
  scan_session_id?: string;
  status?: string;
  code?: string;
  message?: string;
  result?: ScanResponse;
};

const input = "mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-teal-300 disabled:cursor-not-allowed disabled:opacity-50";

function websocketUrl() {
  if (process.env.NEXT_PUBLIC_RFID_WS_URL) return process.env.NEXT_PUBLIC_RFID_WS_URL;
  if (typeof window === "undefined") return "ws://localhost:3000/ws";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3000/ws`;
}

export function RealtimeRfidScanner({ item, onClose, onSaved }: { item: PoSessionItem; onClose: () => void; onSaved: () => Promise<void> }) {
  const socketRef = useRef<WebSocket | null>(null);
  const scanSessionRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const [progress, setProgress] = useState<RfidProgress | null>(null);
  const [session, setSession] = useState<ScanSession | null>(null);
  const [connection, setConnection] = useState("Menghubungkan ke backend…");
  const [lastUid, setLastUid] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(true);

  const loadProgress = useCallback(async () => {
    try {
      const result = await api<ApiEnvelope<RfidProgress>>(`/api/po-session-items/${item.id}/rfid-progress`);
      setProgress(result.data);
    } catch (loadError) {
      setError(messageFromError(loadError));
    }
  }, [item.id]);

  const stop = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    const scanSessionId = scanSessionRef.current;
    if (scanSessionId) {
      try {
        await api(`/api/rfid-scan-sessions/${scanSessionId}/stop`, { method: "POST" });
      } catch {
        // The reader may already have stopped after completing the item.
      }
    }
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const socket = new WebSocket(websocketUrl());
    socketRef.current = socket;

    socket.onopen = async () => {
      if (cancelled) return;
      setConnection("Backend terhubung, menyiapkan reader…");
      socket.send(JSON.stringify({ type: "hello", role: "dashboard" }));
      try {
        const result = await api<ApiEnvelope<ScanSession>>(`/api/po-session-items/${item.id}/rfid-scan-sessions`, {
          method: "POST",
          body: JSON.stringify({ reader_code: process.env.NEXT_PUBLIC_RFID_READER_CODE || "orangepi-reader-01" }),
        });
        if (cancelled) return;
        const scanSession = result.data;
        scanSessionRef.current = scanSession.id;
        setSession(scanSession);
        socket.send(JSON.stringify({ type: "subscribe", scan_session_id: scanSession.id }));
        setStarting(false);
        setConnection("Menunggu UID dari reader…");
      } catch (startError) {
        if (!cancelled) {
          setStarting(false);
          setConnection("Reader tidak siap");
          setError(messageFromError(startError));
        }
      }
    };
    socket.onmessage = (event) => {
      let incoming: SocketMessage;
      try { incoming = JSON.parse(event.data as string) as SocketMessage; } catch { return; }
      if (incoming.type === "hello.accepted") return;
      if (incoming.type === "subscription.started") return;
      if (incoming.type === "scan.session") {
        setSession((current) => current ? { ...current, status: incoming.status || current.status } : current);
        return;
      }
      if (incoming.type === "reader.ready") {
        setConnection("Reader siap membaca UID");
        return;
      }
      if (incoming.type === "reader.status") {
        setConnection(incoming.status === "online" ? "Reader online" : `Reader: ${incoming.status || "unknown"}`);
        return;
      }
      if (incoming.type === "scan.error" || incoming.type === "reader.error") {
        setError(incoming.message || "Reader mengirim error.");
        return;
      }
      if (incoming.type === "scan.duplicate") return;
      if (incoming.type === "scan.result" && incoming.result) {
        const result = incoming.result;
        const latest = result.results[result.results.length - 1];
        if (latest) setLastUid(latest.rfid_number);
        if (result.total_assigned > 0) {
          setMessage(`${result.total_assigned} UID berhasil dipasangkan. Sisa ${result.remaining_rfid_count}.`);
          setError("");
          setProgress((current) => current ? { ...current, assigned_rfid_count: current.required_rfid_count - result.remaining_rfid_count, remaining_rfid_count: result.remaining_rfid_count, status: result.remaining_rfid_count === 0 ? "ready_to_print" : current.status } : current);
          void onSaved();
        } else if (result.errors.length) {
          setError(result.errors.map((entry) => entry.message).join(" "));
        }
        if (result.remaining_rfid_count === 0) {
          setConnection("Semua RFID selesai");
          void stop();
        }
      }
    };
    socket.onerror = () => { if (!cancelled) setError("Koneksi WebSocket ke backend gagal."); };
    socket.onclose = () => { if (!cancelled) setConnection("Koneksi reader terputus"); };
    void loadProgress();

    return () => {
      cancelled = true;
      void stop();
    };
  }, [item.id, loadProgress, onSaved, stop]);

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4"><section className="mx-auto my-6 w-full max-w-3xl rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-2xl shadow-slate-950/30"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[.14em] text-teal-300">REALTIME RFID SCAN</p><h2 className="mt-1 text-xl font-bold">{item.product_name_snapshot}</h2><p className="mt-1 text-sm text-slate-400">{progress ? `${progress.assigned_rfid_count} / ${progress.required_rfid_count} terpasang · ${progress.remaining_rfid_count} tersisa` : "Memuat progres…"}</p></div><button disabled={starting} onClick={() => { void stop(); onClose(); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold disabled:opacity-50">Tutup</button></div><div className="mt-5 rounded-lg border border-teal-300/20 bg-teal-300/5 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Status koneksi</p><p className="mt-1 font-bold text-teal-100">{connection}</p>{session && <p className="mt-1 font-mono text-xs text-slate-500">scan session: {session.id}</p>}</div>{lastUid && <div className="mt-4 rounded-lg bg-slate-800 p-4"><p className="text-xs text-slate-400">UID terakhir</p><p className="mt-1 break-all font-mono text-lg text-teal-100">{lastUid}</p></div>}<div className="mt-4 rounded-lg bg-slate-800 p-4"><p className="font-bold">Cara penggunaan</p><p className="mt-1 text-sm text-slate-400">Pastikan reader Orange Pi aktif, lalu dekatkan tag RFID satu per satu. UID yang valid akan langsung disimpan ke database dan progress diperbarui otomatis.</p></div><ErrorList messages={error ? [error] : []}/>{message && <p className="mt-4 rounded-lg border border-teal-300/20 bg-teal-300/5 p-3 text-sm text-teal-100">{message}</p>}<Field className="mt-5 block text-sm font-semibold" label="Reader code" hint="Reader code harus sama dengan konfigurasi gateway Orange Pi."><input disabled value={session?.reader_code || process.env.NEXT_PUBLIC_RFID_READER_CODE || "orangepi-reader-01"} className={input}/></Field></section></div>;
}
