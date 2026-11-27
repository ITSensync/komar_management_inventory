"use client";

import { Info, X } from "lucide-react";
import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";

export function StatusBadge({ value }: { value: string }) {
  const tone = value === "active" || value === "printed" || value === "completed" || value === "label_printed" || value === "eligible" || value === "placed" || value === "stored"
    ? "border-teal-300/30 bg-teal-300/10 text-teal-100"
    : value === "pending_tags" || value === "ready_to_print" || value === "generated"
      ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
      : value === "cancelled" || value === "failed" || value === "rejected" || value === "error"
        ? "border-red-300/30 bg-red-300/10 text-red-100"
        : "border-slate-600 bg-slate-800 text-slate-200";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

export function ErrorList({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return <div role="alert" className="rounded-lg border border-red-300/30 bg-red-300/10 p-3 text-sm text-red-100"><ul className="list-inside list-disc space-y-1">{messages.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul></div>;
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose, pending = false, children }: { title: string; description: string; confirmLabel: string; onConfirm: () => void; onClose: () => void; pending?: boolean; children?: ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"><section className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 id="confirm-dialog-title" className="text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p></div><button type="button" aria-label="Tutup" onClick={onClose} className="text-slate-400 hover:text-white"><X size={18}/></button></div>{children}<div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold hover:border-slate-400 disabled:opacity-50">Batal</button><button type="button" onClick={onConfirm} disabled={pending} className="rounded-lg bg-red-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">{pending ? "Memproses…" : confirmLabel}</button></div></section></div>;
}

export function PageState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-400">{children}</div>;
}

/**
 * Tombol ikon info kecil. Klik untuk menampilkan penjelasan dalam bahasa simpel;
 * arahkan kursor untuk melihat tooltip bawaan browser sebagai fallback.
 */
export function InfoHint({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        aria-label={`Penjelasan: ${text}`}
        aria-expanded={open}
        aria-controls={id}
        title={text}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-5 items-center justify-center rounded-full border border-slate-600 text-slate-400 transition hover:border-teal-300 hover:text-teal-200 focus:border-teal-300 focus:text-teal-200 focus:outline-none"
      >
        <Info size={12} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-7 z-40 block w-64 max-w-[calc(100vw-2.5rem)] rounded-lg border border-teal-300/30 bg-slate-950 p-2.5 text-left text-xs font-normal leading-5 text-slate-200 shadow-xl`}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/**
 * Field form dengan label, ikon info, dan penjelasan yang bisa dibuka.
 * `children` harus berupa satu elemen input/select/textarea agar `id` dapat
 * dihubungkan ke label untuk aksesibilitas.
 */
export function Field({ label, hint, required = false, className = "", children }: {
  label: string;
  hint: string;
  required?: boolean;
  className?: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  const control = children.props.id ? children : cloneElement(children, { id });
  return (
    <div className={className || "block text-sm font-semibold"}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
          {required && <span className="ml-0.5 text-red-300" aria-hidden="true">*</span>}
        </label>
        <InfoHint text={hint} />
      </div>
      {control}
    </div>
  );
}
