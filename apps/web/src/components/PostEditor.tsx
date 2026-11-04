"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type Account = { id: string; provider: string; displayName: string; backend: string; status: string };
type Media = { id: string; originalName: string; mimeType: string };
type Issue = { level: string; code: string; message: string };
type Report = Record<string, { ok: boolean; issues: Issue[]; format?: string }>;

export interface EditorInitial { id?: string; title?: string | null; body: string; link?: string | null; tags: string[]; mediaIds: string[]; targets: Array<{ socialAccountId: string; overrides: Record<string, unknown> }>; scheduledAt?: string | null; scheduleTimezone?: string | null; status?: string }

export function PostEditor({ brandId, accounts, media, initial, timezone, aiEnabled }: { brandId: string; accounts: Account[]; media: Media[]; initial?: EditorInitial; timezone: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<EditorInitial>(initial ?? { body: "", title: "", link: "", tags: [], mediaIds: [], targets: [] });
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [tz, setTz] = useState(initial?.scheduleTimezone ?? timezone);
  const [reports, setReports] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const locked = initial?.status && !["draft", "validated", "failed", "partial", "canceled"].includes(initial.status);

  const toggleTarget = (id: string) => setF({ ...f, targets: f.targets.some((t) => t.socialAccountId === id) ? f.targets.filter((t) => t.socialAccountId !== id) : [...f.targets, { socialAccountId: id, overrides: {} }] });
  const setOverride = (id: string, key: string, value: unknown) => setF({ ...f, targets: f.targets.map((t) => (t.socialAccountId === id ? { ...t, overrides: { ...t.overrides, [key]: value === "" ? undefined : value } } : t)) });
  const toggleMedia = (id: string) => setF({ ...f, mediaIds: f.mediaIds.includes(id) ? f.mediaIds.filter((m) => m !== id) : [...f.mediaIds, id] });

  async function save(): Promise<string> {
    const payload = { brandId, title: f.title || null, body: f.body, link: f.link || null, tags: f.tags, mediaIds: f.mediaIds, targets: f.targets, scheduleTimezone: tz };
    if (f.id) {
      await api(`/api/posts/${f.id}`, { method: "PATCH", json: payload });
      return f.id;
    }
    const r = await api<{ post: { id: string } }>("/api/posts", { method: "POST", json: payload });
    setF({ ...f, id: r.post.id });
    return r.post.id;
  }
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  return (
    <div>
      {locked && <div className="msg info">This post is {initial?.status}. Cancel it to edit.</div>}
      <div className="card">
        <label>Title (YouTube / Pinterest / Reddit)</label><input type="text" value={f.title ?? ""} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={!!locked} />
        <label>Text</label><textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} disabled={!!locked} /><div className="small muted">{f.body.length} characters</div>
        <label>Link (optional)</label><input type="url" value={f.link ?? ""} onChange={(e) => setF({ ...f, link: e.target.value })} disabled={!!locked} />
        <label>Tags (comma separated)</label><input type="text" value={f.tags.join(", ")} onChange={(e) => setF({ ...f, tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} disabled={!!locked} />
        {aiEnabled && !locked && (
          <details style={{ marginTop: 10 }}><summary className="small">AI draft (review before use)</summary>
            <label>Brief</label><input type="text" value={aiBrief} onChange={(e) => setAiBrief(e.target.value)} placeholder="e.g. new Jump sofa, modular, soft fabric — invite to find a dealer" />
            <div style={{ marginTop: 6 }}><button disabled={busy || !aiBrief} onClick={() => run(async () => { const r = await api<{ text: string }>("/api/ai/draft", { method: "POST", json: { brandId, brief: aiBrief, platform: accounts.find((a) => f.targets.some((t) => t.socialAccountId === a.id))?.provider ?? "instagram", language: "it" } }); setF({ ...f, body: r.text }); })}>Generate draft</button></div>
          </details>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Media</h3>
        {media.length === 0 ? <p className="muted small">No ready media. Upload in Media first.</p> : (
          <div className="row">{media.map((m) => (<label key={m.id} className="row" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 4 }}><input type="checkbox" checked={f.mediaIds.includes(m.id)} onChange={() => toggleMedia(m.id)} disabled={!!locked} />{m.mimeType.startsWith("image/") ? <img className="thumb" src={`/api/media/${m.id}`} alt="" /> : <span className="badge">{m.mimeType}</span>}<span className="small">{m.originalName}</span></label>))}</div>
        )}
        {f.mediaIds.length > 1 && <div className="small muted">Order: {f.mediaIds.map((id, i) => `${i + 1}. ${media.find((m) => m.id === id)?.originalName}`).join(" · ")}</div>}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Targets</h3>
        {accounts.length === 0 && <p className="muted small">Connect an account first.</p>}
        {accounts.map((a) => {
          const sel = f.targets.find((t) => t.socialAccountId === a.id);
          const rep = sel && reports?.[`acct:${a.id}`];
          return (
            <div key={a.id} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
              <label className="row" style={{ margin: 0 }}><input type="checkbox" checked={!!sel} onChange={() => toggleTarget(a.id)} disabled={!!locked || a.status !== "connected"} /> <b>{a.displayName}</b> <span className="badge">{a.provider}/{a.backend}</span>{a.status !== "connected" && <span className="badge err">{a.status}</span>}</label>
              {sel && (
                <div className="row small" style={{ marginLeft: 24, marginTop: 4 }}>
                  <span>Caption override: <input type="text" style={{ width: 260 }} value={(sel.overrides.customContent as string) ?? ""} onChange={(e) => setOverride(a.id, "customContent", e.target.value)} disabled={!!locked} /></span>
                  {(a.provider === "instagram" || a.provider === "facebook") && <span>Type: <select value={(sel.overrides.contentType as string) ?? ""} onChange={(e) => setOverride(a.id, "contentType", e.target.value)} disabled={!!locked}><option value="">feed</option><option value="reel">reel</option><option value="story">story</option></select></span>}
                  {["instagram", "facebook", "linkedin", "youtube", "threads"].includes(a.provider) && <span>First comment: <input type="text" style={{ width: 200 }} value={(sel.overrides.firstComment as string) ?? ""} onChange={(e) => setOverride(a.id, "firstComment", e.target.value)} disabled={!!locked} /></span>}
                  {a.provider === "youtube" && <span>Visibility: <select value={(sel.overrides.visibility as string) ?? "public"} onChange={(e) => setOverride(a.id, "visibility", e.target.value)}><option>public</option><option>unlisted</option><option>private</option></select></span>}
                  {a.provider === "pinterest" && <span>Board id: <input type="text" value={(sel.overrides.boardId as string) ?? ""} onChange={(e) => setOverride(a.id, "boardId", e.target.value)} /></span>}
                  {a.provider === "reddit" && <span>Subreddit: <input type="text" value={(sel.overrides.subreddit as string) ?? ""} onChange={(e) => setOverride(a.id, "subreddit", e.target.value)} /></span>}
                  {a.provider === "tiktok" && <span>Privacy: <select value={(sel.overrides.privacyLevel as string) ?? "PUBLIC_TO_EVERYONE"} onChange={(e) => setOverride(a.id, "privacyLevel", e.target.value)}><option>PUBLIC_TO_EVERYONE</option><option>MUTUAL_FOLLOW_FRIENDS</option><option>SELF_ONLY</option></select></span>}
                </div>
              )}
              {rep && <div style={{ marginLeft: 24 }}>{rep.ok ? <span className="badge ok">valid ({rep.format})</span> : rep.issues.map((i, k) => <div key={k} className={`small`} style={{ color: i.level === "error" ? "var(--err)" : "var(--warn)" }}>{i.level}: {i.message}</div>)}</div>}
            </div>
          );
        })}
      </div>
      {!locked && (
        <div className="card">
          <div className="row">
            <button disabled={busy} onClick={() => run(async () => { const id = await save(); router.push(`/posts/${id}`); router.refresh(); })}>Save draft</button>
            <button disabled={busy} onClick={() => run(async () => { const id = await save(); const r = await api<{ reports: Record<string, { ok: boolean; issues: Issue[]; format?: string }>; post: { targets: Array<{ id: string; socialAccountId: string }> } }>(`/api/posts/${id}/validate`, { method: "POST" }); const byAcct: Report = {}; for (const t of r.post.targets) if (r.reports[t.id]) byAcct[`acct:${t.socialAccountId}`] = r.reports[t.id]!; if (r.reports.__post) byAcct.__post = r.reports.__post; setReports(byAcct); })}>Validate</button>
            <button className="primary" disabled={busy || !f.targets.length} onClick={() => run(async () => { if (!window.confirm("Publish now to the selected accounts?")) return; const id = await save(); await api(`/api/posts/${id}/publish`, { method: "POST" }); router.push(`/posts/${id}`); router.refresh(); })}>Publish now</button>
            <span>| <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} /> <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 100 }} /> <input type="text" value={tz} onChange={(e) => setTz(e.target.value)} style={{ width: 130 }} /></span>
            <button disabled={busy || !date || !f.targets.length} onClick={() => run(async () => { const id = await save(); await api(`/api/posts/${id}/schedule`, { method: "POST", json: { localDate: date, localTime: time, timezone: tz } }); router.push(`/posts/${id}`); router.refresh(); })}>Schedule</button>
          </div>
          {reports?.__post && !reports.__post.ok && <div className="msg err">{reports.__post.issues.map((i) => i.message).join(" ")}</div>}
          {err && <div className="msg err">{err}</div>}
        </div>
      )}
    </div>
  );
}
