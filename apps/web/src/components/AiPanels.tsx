"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

/** What the AI is told about the current workspace. Saved on the workspace; used for that workspace only. */
export function KnowledgeForm({ workspace }: { workspace: { id: string; name: string; industry: string | null; description: string | null; brandVoice: string | null; targetAudience: string | null } }) {
  const [f, setF] = useState({ industry: workspace.industry ?? "", description: workspace.description ?? "", brandVoice: workspace.brandVoice ?? "", targetAudience: workspace.targetAudience ?? "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); setMsg(null); setErr(null); try { await api(`/api/brands/${workspace.id}`, { method: "PATCH", json: f }); setMsg("Saved. New drafts for this workspace use it."); router.refresh(); } catch (e2) { setErr((e2 as Error).message); } }}>
      <h3 style={{ marginTop: 0 }}>What the AI knows about {workspace.name}</h3>
      <p className="small muted">Only this text and your brief are sent with a draft request. Other workspaces never see it.</p>
      <div className="fields">
        <div className="wide"><label htmlFor="k-ind">Industry</label><input id="k-ind" type="text" value={f.industry} onChange={set("industry")} maxLength={80} /></div>
        <div className="wide"><label htmlFor="k-desc">Description</label><textarea id="k-desc" value={f.description} onChange={set("description")} maxLength={1000} /></div>
        <div><label htmlFor="k-voice">Brand voice</label><textarea id="k-voice" value={f.brandVoice} onChange={set("brandVoice")} maxLength={1000} /></div>
        <div><label htmlFor="k-aud">Target audience</label><textarea id="k-aud" value={f.targetAudience} onChange={set("targetAudience")} maxLength={1000} /></div>
      </div>
      {msg && <div className="msg ok" role="status">{msg}</div>}
      {err && <div className="msg err" role="alert">{err}</div>}
      <div style={{ marginTop: 12 }}><button type="submit">Save knowledge</button></div>
    </form>
  );
}

/** Asks the configured model for one draft. Nothing is published: the text is yours to copy or discard. */
export function DraftBox({ workspaceId, enabled, platforms }: { workspaceId: string; enabled: boolean; platforms: Array<{ id: string; name: string }> }) {
  const [f, setF] = useState({ brief: "", platform: platforms[0]?.id ?? "instagram", language: "en", hashtags: true });
  const [out, setOut] = useState<{ text: string; model: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); setErr(null); setOut(null); setBusy(true); try { setOut(await api<{ text: string; model: string }>("/api/ai/draft", { method: "POST", json: { ...f, brandId: workspaceId } })); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); } }}>
      <h3 style={{ marginTop: 0 }}>Draft a caption</h3>
      <label htmlFor="d-brief">What is the post about?</label>
      <textarea id="d-brief" value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} required minLength={3} maxLength={4000} style={{ minHeight: 90 }} />
      <div className="row" style={{ marginTop: 8 }}>
        <div><label htmlFor="d-pl">Platform</label><select id="d-pl" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><label htmlFor="d-lang">Language</label><select id="d-lang" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="it">Italiano</option></select></div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "18px 0 0" }}><input type="checkbox" checked={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.checked })} /> Add hashtags</label>
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      {out && <div className="msg info" role="status" style={{ whiteSpace: "pre-wrap" }}>{out.text}<div className="small muted" style={{ marginTop: 8 }}>Draft from {out.model}. Review it before using it.</div></div>}
      <div style={{ marginTop: 12 }}><button className="primary" type="submit" disabled={busy || !enabled}>{busy ? "Writing…" : "Write draft"}</button>{!enabled && <span className="small muted" style={{ marginLeft: 10 }}>Add an OpenRouter key in Settings first.</span>}</div>
    </form>
  );
}
