import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Barcode, FileText, Tags } from "lucide-react";

export const metadata: Metadata = { title: "Session PO dan RFID", alternates: { canonical: "/" } };

const features = [
  [FileText, "Session PO", "Kelola banyak item dalam satu session aktif sampai selesai manual."],
  [Barcode, "Scan RFID", "Pasangkan UID secara bertahap ke paket rencana dari server."],
  [Tags, "Label terverifikasi", "Preview snapshot label lalu konfirmasi hasil cetak fisik."],
] as const;

export default function HomePage() {
  return <main className="min-h-screen px-5 py-6 md:px-12"><nav className="mx-auto flex max-w-6xl items-center justify-between"><Link className="font-black tracking-[.24em] text-teal-300" href="/">KOMAR</Link><Link className="rounded-md border border-teal-300/50 px-3 py-1.5 text-sm text-teal-200" href="/app/admin/dashboard">Buka dashboard</Link></nav><section className="mx-auto grid max-w-6xl gap-10 py-24 lg:grid-cols-[1.25fr_.75fr] lg:py-36"><div><p className="mb-4 text-sm font-bold tracking-[.18em] text-teal-300">PO & RFID MANAGEMENT</p><h1 className="max-w-3xl text-5xl font-black leading-[1.04] text-slate-100 md:text-7xl">Siapkan paket, RFID, dan label dalam satu alur.</h1><p className="mt-7 max-w-xl text-lg leading-8 text-slate-300">Dashboard admin untuk membuat session PO, memasukkan barang, memindai RFID, dan mencetak label dari data API.</p><Link href="/app/admin/dashboard" className="mt-9 inline-flex items-center gap-2 rounded-lg bg-teal-300 px-5 py-3 font-bold text-slate-950">Buka dashboard <ArrowRight size={18}/></Link></div><div className="rounded-2xl border border-teal-200/15 bg-slate-900/70 p-6 shadow-2xl shadow-teal-950/20"><p className="text-sm text-slate-400">Alur operasional</p><p className="mt-3 text-2xl font-bold">Produk → Session → RFID → Label</p><div className="my-5 h-px bg-slate-700"/><p className="text-sm leading-6 text-slate-300">Server adalah sumber kebenaran untuk status session, assignment RFID, dan hasil cetak label.</p></div></section><section className="mx-auto grid max-w-6xl gap-4 pb-20 md:grid-cols-3">{features.map(([Icon, title, text]) => <article key={title} className="rounded-xl border border-slate-700 bg-slate-900/60 p-5"><Icon className="text-teal-300"/><h2 className="mt-4 font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></article>)}</section></main>;
}
