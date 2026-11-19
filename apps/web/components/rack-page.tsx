"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, type FormEvent } from "react";
import { Pencil, RefreshCcw, Warehouse } from "lucide-react";
import { api, type ApiEnvelope, type Rack, messageFromError } from "@/lib/api";
import { ErrorList, Field, PageState, StatusBadge } from "@/components/ui";

const card = "rounded-xl border border-slate-700 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/10";
const input = "mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 outline-none focus:border-teal-300";

type RackForm = { code: string; name: string; description: string };
const emptyForm = (): RackForm => ({ code: "", name: "", description: "" });

export function RackPage() {
  const [racks, setRacks] = useState<Rack[]>([]);
  const [form, setForm] = useState<RackForm>(emptyForm());
  const [editing, setEditing] = useState<Rack | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setRacks((await api<ApiEnvelope<Rack[]>>("/api/racks")).data);
    } catch (loadError) {
      setError(messageFromError(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const reset = () => {
    setEditing(null);
    setForm(emptyForm());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
    };
    try {
      await api<ApiEnvelope<Rack>>(editing ? `/api/racks/${editing.id}` : "/api/racks", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      reset();
      await load();
    } catch (saveError) {
      setError(messageFromError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const edit = (rack: Rack) => {
    setEditing(rack);
    setForm({ code: rack.code, name: rack.name, description: rack.description || "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleStatus = async (rack: Rack) => {
    setSaving(true);
    setError("");
    try {
      await api(`/api/racks/${rack.id}`, { method: "PATCH", body: JSON.stringify({ status: rack.status === "active" ? "inactive" : "active" }) });
      await load();
    } catch (statusError) {
      setError(messageFromError(statusError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black md:text-3xl">Master rak</h1>
          <p className="mt-2 text-sm text-slate-400">Buat rak dari Admin. Site employee hanya dapat memilih rak yang active dari mobile.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold hover:border-teal-300">
          <RefreshCcw size={16} /> Perbarui
        </button>
      </header>

      <ErrorList messages={error ? [error] : []} />
      <div className="mt-5 grid gap-5 xl:grid-cols-[.72fr_1.28fr]">
        <section className={card}>
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-teal-300/10 text-teal-200"><Warehouse size={19} /></span>
            <div><h2 className="font-bold">{editing ? "Ubah rak" : "Tambah rak"}</h2><p className="text-xs text-slate-500">Kode harus unik.</p></div>
          </div>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Kode rak" required hint="Kode singkat yang mudah dibaca petugas, misalnya RAK-01.">
              <input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Contoh: RAK-01" className={input} />
            </Field>
            <Field label="Nama rak" required hint="Nama yang tampil pada Admin dan mobile, misalnya Rak Susu.">
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Contoh: Rak Susu" className={input} />
            </Field>
            <Field label="Deskripsi" hint="Keterangan opsional untuk lokasi atau isi rak.">
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Contoh: Area gudang A" className={`${input} min-h-24`} />
            </Field>
            <div className="flex gap-3">
              <button disabled={saving} className="rounded-lg bg-teal-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">{saving ? "Menyimpan…" : editing ? "Simpan perubahan" : "Buat rak"}</button>
              {editing && <button type="button" onClick={reset} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold">Batal</button>}
            </div>
          </form>
        </section>

        <section className={`${card} p-0`}>
          <div className="border-b border-slate-700 p-5"><h2 className="font-bold">Daftar rak</h2><p className="mt-1 text-sm text-slate-400">Rak inactive tidak muncul pada pilihan mobile.</p></div>
          {loading ? <PageState>Memuat rak…</PageState> : racks.length === 0 ? <p className="p-5 text-sm text-slate-500">Belum ada rak. Buat rak pertama di form sebelah.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-slate-700 bg-slate-800/60 text-xs uppercase text-slate-400"><tr><th className="p-4">Kode</th><th className="p-4">Nama</th><th className="p-4">Status</th><th className="p-4 text-right">Aksi</th></tr></thead><tbody>{racks.map((rack) => <tr key={rack.id} className="border-b border-slate-800"><td className="p-4 font-mono text-xs text-teal-100">{rack.code}</td><td className="p-4"><p className="font-semibold">{rack.name}</p>{rack.description && <p className="mt-1 text-xs text-slate-500">{rack.description}</p>}</td><td className="p-4"><StatusBadge value={rack.status} /></td><td className="p-4"><div className="flex justify-end gap-2"><button type="button" onClick={() => edit(rack)} className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold hover:border-teal-300"><Pencil size={13} /> Edit</button><button type="button" disabled={saving} onClick={() => void toggleStatus(rack)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold hover:border-teal-300 disabled:opacity-50">{rack.status === "active" ? "Nonaktifkan" : "Aktifkan"}</button></div></td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </>
  );
}
