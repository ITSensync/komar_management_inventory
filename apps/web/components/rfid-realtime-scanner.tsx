"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiEnvelope, type PoSessionItem, type RfidProgress, type ScanError, type ScanResponse } from "@/lib/api";
import { Field } from "@/components/ui";

type ScanSession = { id: string; po_session_item_id: string; reader_code: string; status: string; expires_at: string };
type SocketMessage = {
  type: string;
  scan_session_id?: string;
  status?: string;
  code?: string;
  uid?: string;
  message?: string;
  result?: ScanResponse;
};
type FeedbackKind = "success" | "error";
type ScanFeedback = { kind: FeedbackKind; label: string; uid: string; message: string };

const input = "mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-teal-300 disabled:cursor-not-allowed disabled:opacity-50";

function websocketUrl() {
  if (process.env.NEXT_PUBLIC_RFID_WS_URL) return process.env.NEXT_PUBLIC_RFID_WS_URL;
  if (typeof window === "undefined") return "ws://localhost:3000/ws";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3000/ws`;
}

function feedbackClass(kind: FeedbackKind) {
  return kind === "success" ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100" : "border-red-300/40 bg-red-300/10 text-red-100";
}

function errorLabel(kind: FeedbackKind) {
  return kind === "success" ? "BERHASIL" : "DITOLAK";
}

function errorMessage(error: ScanError) {
  const context = error.session_number
    ? ` Saat ini digunakan pada ${error.session_number}${error.product_name ? ` untuk ${error.product_name}` : ""}.`
    : "";

  switch (error.code) {
    case "RFID_NOT_REGISTERED":
      return "RFID belum terdaftar. Daftarkan UID ini melalui menu Master RFID terlebih dahulu.";
    case "RFID_ALREADY_PLACED":
      return "RFID sudah ditempatkan di rak dan belum dapat digunakan sebagai UID baru.";
    case "RFID_DUPLICATE_IN_ITEM":
      return "RFID ini sudah terpasang pada item PO yang sedang diproses.";
    case "RFID_DUPLICATE_IN_SESSION":
      return "RFID ini sudah digunakan pada item lain dalam PO/session yang sama.";
    case "RFID_ALREADY_ASSIGNED_TO_PO":
      return `RFID masih digunakan pada PO lain dan belum dapat digunakan kembali.${context}`;
    case "RFID_REUSE_NOT_RELEASED":
      return `RFID belum dilepas dari penggunaan sebelumnya.${context}`;
    case "RFID_RETIRED":
      return "RFID sudah retired dan tidak dapat digunakan kembali.";
    case "RFID_NOT_AVAILABLE":
      return "RFID belum available sehingga tidak dapat digunakan untuk product baru.";
    case "RFID_DATA_INCONSISTENT":
      return "Data lifecycle RFID belum konsisten. UID ini perlu diperiksa Admin sebelum digunakan kembali.";
    case "no_remaining_pack":
      return "Semua kebutuhan RFID pada item ini sudah terpenuhi.";
    default:
      return error.message || "RFID ditolak oleh backend.";
  }
}

export function RealtimeRfidScanner({ item, onClose, onSaved }: { item: PoSessionItem; onClose: () => void; onSaved: () => Promise<void> }) {
  const socketRef = useRef<WebSocket | null>(null);
  const scanSessionRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const [progress, setProgress] = useState<RfidProgress | null>(null);
  const [session, setSession] = useState<ScanSession | null>(null);
  const [connection, setConnection] = useState("Menghubungkan ke backend…");
  const [lastUid, setLastUid] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [history, setHistory] = useState<ScanFeedback[]>([]);
  const [starting, setStarting] = useState(true);

  const loadProgress = useCallback(async () => {
    try {
      const result = await api<ApiEnvelope<RfidProgress>>(`/api/po-session-items/${item.id}/rfid-progress`);
      setProgress(result.data);
    } catch (loadError) {
      setConnectionError(loadError instanceof Error ? loadError.message : "Progress RFID tidak dapat dimuat.");
    }
  }, [item.id]);

  const pushFeedback = useCallback((next: ScanFeedback) => {
    setFeedback(next);
    setHistory((current) => [next, ...current].slice(0, 8));
  }, []);

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
          setConnectionError(startError instanceof Error ? startError.message : "Reader tidak dapat disiapkan.");
        }
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
      if (incoming.type === "reader.ready") {
        setConnection("Reader siap membaca UID");
        return;
      }
      if (incoming.type === "reader.status") {
        setConnection(incoming.status === "online" ? "Reader online" : `Reader: ${incoming.status || "unknown"}`);
        return;
      }
      if (incoming.type === "scan.error" || incoming.type === "reader.error") {
        setConnectionError(incoming.message || "Reader mengirim error.");
        return;
      }
      if (incoming.type === "scan.duplicate") {
        // Repeated reader events are intentionally silent in the modal.
        return;
      }
      if (incoming.type !== "scan.result" || !incoming.result) return;

      const result = incoming.result;
      const latestResult = result.results[result.results.length - 1];
      const visibleErrors = result.errors.filter((entry) => !["duplicate_in_request", "duplicate_read"].includes(entry.code));
      const latestError = visibleErrors[visibleErrors.length - 1];
      if (latestResult) {
        setLastUid(latestResult.rfid_number);
        pushFeedback({
          kind: "success",
          label: "BERHASIL",
          uid: latestResult.rfid_number,
          message: latestResult.registered_now
            ? `RFID baru berhasil didaftarkan dan dipasangkan ke paket nomor ${latestResult.pack_number ?? "baru"}.`
            : `RFID berhasil dipasangkan ke paket nomor ${latestResult.pack_number ?? "baru"}.`,
        });
      }
      if (latestError) {
        const uid = latestError.rfid_number || latestResult?.rfid_number || "UID tidak diketahui";
        setLastUid(uid);
        pushFeedback({ kind: "error", label: "DITOLAK", uid, message: errorMessage(latestError) });
      }
      if (result.total_assigned > 0) {
        setConnectionError("");
        setProgress((current) => current ? {
          ...current,
          assigned_rfid_count: current.required_rfid_count - result.remaining_rfid_count,
          remaining_rfid_count: result.remaining_rfid_count,
          status: result.remaining_rfid_count === 0 ? "ready_to_print" : current.status,
        } : current);
        void onSaved();
      }
      if (result.remaining_rfid_count === 0) {
        setConnection("Semua RFID selesai");
        void stop();
      }
    };
    socket.onerror = () => { if (!cancelled) setConnectionError("Koneksi WebSocket ke backend gagal."); };
    socket.onclose = () => { if (!cancelled) setConnection("Koneksi reader terputus"); };
    void loadProgress();

    return () => {
      cancelled = true;
      void stop();
    };
  }, [item.id, loadProgress, onSaved, pushFeedback, stop]);

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4"><section className="mx-auto my-6 w-full max-w-3xl rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-2xl shadow-slate-950/30"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[.14em] text-teal-300">REALTIME RFID SCAN</p><h2 className="mt-1 text-xl font-bold">{item.product_name_snapshot}</h2><p className="mt-1 text-sm text-slate-400">{progress ? `${progress.assigned_rfid_count} / ${progress.required_rfid_count} terpasang · ${progress.remaining_rfid_count} tersisa` : "Memuat progres…"}</p></div><button disabled={starting} onClick={() => { void stop(); onClose(); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold disabled:opacity-50">Tutup</button></div><div className="mt-5 rounded-lg border border-teal-300/20 bg-teal-300/5 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Status koneksi</p><p className="mt-1 font-bold text-teal-100">{connection}</p>{session && <p className="mt-1 font-mono text-xs text-slate-500">scan session: {session.id}</p>}</div>{connectionError && <div className="mt-4 rounded-lg border border-red-300/40 bg-red-300/10 p-4 text-red-100"><p className="text-xs font-black tracking-wide">ERROR KONEKSI</p><p className="mt-1 text-sm">{connectionError}</p></div>}{feedback && <div className={`mt-4 rounded-lg border p-4 ${feedbackClass(feedback.kind)}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full border border-current px-3 py-1 text-xs font-black tracking-wide">{feedback.label}</span><span className="font-mono text-sm">{feedback.uid}</span></div><p className="mt-3 font-semibold">{feedback.message}</p></div>}<div className="mt-4 rounded-lg bg-slate-800 p-4"><p className="font-bold">Cara penggunaan</p><p className="mt-1 text-sm text-slate-400">Pastikan reader Orange Pi aktif, lalu dekatkan tag RFID satu per satu. UID valid akan langsung disimpan dan UID yang tidak boleh digunakan akan ditolak di modal ini.</p></div>{history.length > 0 && <div className="mt-4 rounded-lg bg-slate-800 p-4"><p className="font-bold">Riwayat scan</p><div className="mt-3 space-y-2">{history.map((entry, index) => <div key={`${entry.uid}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-2 text-sm last:border-0 last:pb-0"><span className={`font-black ${entry.kind === "success" ? "text-emerald-300" : "text-red-300"}`}>{errorLabel(entry.kind)}</span><span className="font-mono text-slate-300">{entry.uid}</span><span className="w-full text-slate-400">{entry.message}</span></div>)}</div></div>}<Field className="mt-5 block text-sm font-semibold" label="Reader code" hint="Reader code harus sama dengan konfigurasi gateway Orange Pi."><input disabled value={session?.reader_code || process.env.NEXT_PUBLIC_RFID_READER_CODE || "orangepi-reader-01"} className={input}/></Field></section></div>;
}
