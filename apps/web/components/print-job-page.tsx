"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Printer, RefreshCcw } from "lucide-react";
import { api, type ApiEnvelope, type PrintJobDetail, messageFromError } from "@/lib/api";
import { ConfirmDialog, ErrorList, PageState, StatusBadge } from "@/components/ui";

export function PrintJobPage({ printJobId, sessionId }: { printJobId: string; sessionId?: string }) {
  const [job, setJob] = useState<PrintJobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJob((await api<ApiEnvelope<PrintJobDetail>>(`/api/print-jobs/${printJobId}`)).data);
      setError("");
    } catch (loadError) {
      setError(messageFromError(loadError));
    } finally {
      setLoading(false);
    }
  }, [printJobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const markPrinted = async () => {
    setPending(true);
    try {
      await api(`/api/print-jobs/${printJobId}/mark-printed`, { method: "POST" });
      setConfirm(false);
      await load();
    } catch (markError) {
      setError(messageFromError(markError));
      setConfirm(false);
    } finally {
      setPending(false);
    }
  };

  const backHref = sessionId ? `/app/admin/purchase-orders/${sessionId}` : "/app/admin/purchase-orders";

  if (loading) return <PageState>Memuat data label dari API…</PageState>;
  if (!job) {
    return <><ErrorList messages={[error || "Print job tidak ditemukan."]}/><Link href={backHref} className="mt-4 inline-block text-sm font-bold text-teal-300">Kembali</Link></>;
  }

  return <>
    <Link href={backHref} className="no-print mb-5 inline-flex items-center gap-2 text-sm font-bold text-teal-300"><ArrowLeft size={16}/> Kembali ke session</Link>
    <header className="no-print flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold tracking-[.14em] text-teal-300">PRINT JOB</p>
        <h1 className="mt-1 font-mono text-2xl font-black">{job.id}</h1>
        <p className="mt-2 text-sm text-slate-400">Preview memakai snapshot label dari server, bukan data katalog live.</p>
      </div>
      <StatusBadge value={job.status}/>
    </header>
    <ErrorList messages={error ? [error] : []}/>
    <div className="no-print mt-5 flex flex-wrap gap-3">
      {job.status === "generated" && <>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-teal-300/50 px-4 py-2 text-sm font-bold text-teal-200"><Printer size={16}/> Cetak dari browser</button>
        <button onClick={() => setConfirm(true)} className="rounded-lg bg-teal-300 px-4 py-2 text-sm font-bold text-slate-950">Tandai berhasil dicetak</button>
      </>}
      <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm"><RefreshCcw size={16}/> Perbarui status</button>
    </div>
    {job.status === "generated" && <p className="no-print mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">Jangan tandai printed sebelum printer fisik benar-benar berhasil mencetak semua label.</p>}
    <section className="print-labels mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {job.items.map(({ label_snapshot: label }, index) => <article key={`${label.label_code}-${index}`} className="print-card rounded-xl border border-slate-600 bg-white p-5 text-slate-950 shadow-xl">
        <h2 className="label-product text-2xl font-black leading-none">{label.product_name}</h2>
        <div className="label-divider my-5 border-t border-slate-300"/>
        <div className="label-meta grid grid-cols-2 gap-x-4 gap-y-3 text-center">
          <div className="label-session min-w-0">
            <span className="label-key block text-xs text-slate-500">Session</span>
            <strong className="label-value block truncate font-mono text-base font-black">{label.session_number}</strong>
          </div>
          <div className="min-w-0">
            <span className="label-key block text-xs text-slate-500">Isi</span>
            <strong className="label-value block truncate text-base font-black">{label.units} {label.base_unit}</strong>
          </div>
          <div className="label-expiry col-span-2 min-w-0">
            <span className="label-key block text-xs text-slate-500">Expiry</span>
            <strong className="label-value block truncate text-base font-black">{label.expiry_date ?? "—"}</strong>
          </div>
        </div>
      </article>)}
    </section>
    {confirm && <ConfirmDialog title="Konfirmasi hasil cetak" description="Gunakan aksi ini hanya setelah printer fisik berhasil mencetak label. Status job dan pack plan akan diubah oleh server." confirmLabel="Ya, semua berhasil dicetak" onClose={() => setConfirm(false)} onConfirm={() => void markPrinted()} pending={pending}/>} 
  </>;
}
