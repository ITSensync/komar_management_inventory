"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Barcode, FileText, LayoutDashboard, Tags } from "lucide-react";
import type { ReactNode } from "react";

const navigation = [
  { href: "/app/admin/dashboard", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/app/admin/katalog", label: "Katalog produk", icon: Tags },
  { href: "/app/admin/purchase-orders", label: "Session PO", icon: FileText },
  { href: "/app/admin/tags", label: "Inventaris RFID", icon: Barcode },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]"><aside className="no-print border-b border-slate-700 bg-slate-950/75 p-4 lg:min-h-screen lg:border-b-0 lg:border-r"><Link href="/app/admin/dashboard" className="mb-8 flex items-center gap-3 px-2"><span className="grid size-9 place-items-center rounded-lg bg-teal-300 font-black text-slate-950">K</span><div><p className="font-black tracking-[.16em] text-teal-200">KOMAR</p><p className="text-xs text-slate-500">PO & RFID Console</p></div></Link><nav className="grid grid-cols-2 gap-1 lg:grid-cols-1">{navigation.map((item) => { const Icon = item.icon; const active = pathname === item.href || (item.href === "/app/admin/purchase-orders" && pathname.startsWith(`${item.href}/`)); return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${active ? "bg-teal-300 font-bold text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}><Icon size={17}/>{item.label}</Link>; })}</nav><div className="mt-8 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs leading-5 text-slate-400"><p className="font-semibold text-slate-200">Terhubung ke API</p><p className="mt-1">Data dan status selalu berasal dari server. Perbarui halaman bila kondisi diubah pengguna lain.</p></div></aside><main className="min-w-0 p-5 md:p-8"><div className="mx-auto max-w-7xl">{children}</div></main></div>;
}
