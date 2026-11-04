"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function SettingsForm({ current }: { current: { zernioApiKey: boolean; zernioWebhookSecret: boolean; aiApiKey: boolean; aiModel: string; locale: string; timezone: string } }) {
  const [f, setF] = useState({ zernioApiKey: "", zernioWebhookSecret: "", aiApiKey: "", aiModel: current.aiModel, locale: current.locale, timezone: current.timezone });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const save = async (json: Record<string, unknown>) => { setMsg(null); setErr(null); try { await api("/api/settings", { method: "POST", json }); setMsg("Saved."); setF({ ...f, zernioApiKey: "", zernioWebhookSecret: "", aiApiKey: "" }); router.refresh(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Zernio gateway (optional)</h3>
        <p className="small muted">The key is verified with one API call, then stored encrypted (AES-256-GCM). It never appears in the browser again. Status: {current.zernioApiKey ? <span className="badge ok">configured</span> : <span className="badge">not set</span>}</p>
        <label>API key</label><input type="password" value={f.zernioApiKey} onChange={(e) => setF({ ...f, zernioApiKey: e.target.value })} autoComplete="off" placeholder={current.zernioApiKey ? "•••••• (leave empty to keep)" : "zk_…"} />
        <label>Webhook secret (set the same value in Zernio → Webhooks) {current.zernioWebhookSecret && <span className="badge ok">configured</span>}</label><input type="password" value={f.zernioWebhookSecret} onChange={(e) => setF({ ...f, zernioWebhookSecret: e.target.value })} autoComplete="off" />
        <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={() => save({ zernioApiKey: f.zernioApiKey || undefined, zernioWebhookSecret: f.zernioWebhookSecret || undefined })}>Save Zernio</button>{current.zernioApiKey && <button className="danger" onClick={() => { if (window.confirm("Remove the Zernio key?")) void save({ zernioApiKey: "" }); }}>Remove key</button>}</div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>AI drafts (optional, OpenRouter-compatible)</h3>
        <p className="small muted">Status: {current.aiApiKey ? <span className="badge ok">configured</span> : <span className="badge">not set</span>}. Drafts are always reviewed by you before publishing.</p>
        <label>API key</label><input type="password" value={f.aiApiKey} onChange={(e) => setF({ ...f, aiApiKey: e.target.value })} autoComplete="off" />
        <label>Model</label><input type="text" value={f.aiModel} onChange={(e) => setF({ ...f, aiModel: e.target.value })} />
        <div style={{ marginTop: 8 }}><button className="primary" onClick={() => save({ aiApiKey: f.aiApiKey || undefined, aiModel: f.aiModel })}>Save AI</button></div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Owner</h3>
        <div className="row"><div><label>Language</label><select value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })}><option value="it">Italiano</option><option value="en">English</option></select></div><div><label>Timezone</label><input type="text" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></div></div>
        <div style={{ marginTop: 8 }}><button onClick={() => save({ locale: f.locale, timezone: f.timezone })}>Save owner settings</button></div>
        <h3>Change password</h3>
        <label>Current</label><input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
        <label>New (min 10)</label><input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />
        <div style={{ marginTop: 8 }}><button onClick={async () => { setErr(null); setMsg(null); try { await api("/api/auth/password", { method: "POST", json: pw }); setMsg("Password changed."); setPw({ currentPassword: "", newPassword: "" }); } catch (e) { setErr((e as Error).message); } }}>Change password</button></div>
      </div>
      {msg && <div className="msg ok">{msg}</div>}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}
