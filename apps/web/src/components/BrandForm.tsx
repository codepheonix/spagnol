"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function BrandForm() {
  const [f, setF] = useState({ name: "", websiteUrl: "", timezone: "Europe/Rome", locale: "it" });
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { const r = await api<{ brand: { id: string } }>("/api/brands", { method: "POST", json: f }); await api(`/api/brands/${r.brand.id}/select`, { method: "POST" }); setF({ ...f, name: "", websiteUrl: "" }); router.refresh(); } catch (e2) { setErr((e2 as Error).message); } }}>
      <h3 style={{ marginTop: 0 }}>New brand</h3>
      <label>Name</label><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="Spagnol Salotti" />
      <label>Website</label><input type="url" value={f.websiteUrl} onChange={(e) => setF({ ...f, websiteUrl: e.target.value })} placeholder="https://" />
      <div className="row">
        <div style={{ flex: 1 }}><label>Timezone</label><input type="text" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></div>
        <div><label>Language</label><select value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })}><option value="it">Italiano</option><option value="en">English</option></select></div>
      </div>
      {err && <div className="msg err">{err}</div>}
      <div style={{ marginTop: 10 }}><button className="primary" type="submit">Create</button></div>
    </form>
  );
}
