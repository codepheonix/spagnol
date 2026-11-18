"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

interface Account { id: string; provider: string; displayName: string; username: string | null; metadata: Record<string, unknown> }
interface Rule { id: string; name: string; enabled: boolean; socialAccountId: string; externalPostId: string; postLabel: string | null; postUrl: string | null; keyword: string; replyText: string; createdAt: string }
interface Ev { id: string; provider: string; externalPostId: string; externalCommentId: string; commentText: string | null; authorName: string | null; source: string; keyword: string | null; status: string; error: string | null; errorCategory: string | null; providerMessageId: string | null; attempts: number; createdAt: string; sentAt: string | null; socialAccount: { displayName: string; provider: string } }
interface PostRow { externalPostId: string; label: string; url: string | null; createdAt: string | null; mediaType: string | null }

const STATUS_CLASS: Record<string, string> = { sent: "ok", failed: "err", uncertain: "err", skipped: "", queued: "", sending: "", matched: "" };

/** Comment → DM rules: pick the account and the post, type the keyword and the private reply, switch on. */
export function PrivateReplyRules({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [accountId, setAccountId] = useState("");
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [postsErr, setPostsErr] = useState<string | null>(null);
  const [postId, setPostId] = useState("");
  const [keyword, setKeyword] = useState("CATALOGO");
  const [reply, setReply] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<{ rules: Rule[]; events: Ev[]; accounts: Account[] }>(`/api/automations/private-replies?brandId=${brandId}`);
    setRules(d.rules);
    setEvents(d.events);
    setAccounts(d.accounts);
    if (!accountId && d.accounts[0]) setAccountId(d.accounts[0].id);
  }, [brandId, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accountId) return;
    setPosts([]);
    setPostId("");
    setPostsErr(null);
    api<{ posts: PostRow[]; unsupported?: boolean }>(`/api/connections/${accountId}/posts`)
      .then((d) => {
        setPosts(d.posts);
        if (d.posts[0]) setPostId(d.posts[0].externalPostId);
      })
      .catch((e: Error) => setPostsErr(e.message));
  }, [accountId]);

  const account = accounts.find((a) => a.id === accountId);
  const post = posts.find((p) => p.externalPostId === postId);

  async function create() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api("/api/automations/private-replies", { method: "POST", json: { brandId, socialAccountId: accountId, externalPostId: postId, postLabel: post?.label ?? null, postUrl: post?.url ?? null, keyword, replyText: reply, enabled } });
      setReply("");
      setMsg("Rule saved. Comments on that post containing the keyword will get the private reply.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(r: Rule) {
    setErr(null);
    try {
      await api(`/api/automations/private-replies/${r.id}`, { method: "PATCH", json: { enabled: !r.enabled } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function remove(r: Rule) {
    if (!window.confirm("Delete this rule?")) return;
    await api(`/api/automations/private-replies/${r.id}`, { method: "DELETE" });
    await load();
  }
  async function subscribe(id: string) {
    setErr(null);
    setMsg(null);
    try {
      const r = await api<{ subscribedFields: string[] }>(`/api/connections/${id}/webhooks`, { method: "POST" });
      setMsg(`Meta confirmed the webhook subscription (${r.subscribedFields.join(", ")}).`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function retry(ev: Ev) {
    if (ev.status === "uncertain" && !window.confirm("Meta may already have delivered this reply. Only retry if the inbox shows nothing was sent. Continue?")) return;
    setErr(null);
    try {
      await api(`/api/automations/private-replies/events/${ev.id}/retry`, { method: "POST" });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.provider === "instagram" ? "Instagram" : "Facebook"} · ${a.displayName}` : id;
  };

  return (
    <div>
      <h2 style={{ marginTop: 28 }}>Comment → DM (private reply) — {brandName}</h2>
      <p className="small muted">When someone comments the keyword on the chosen post, Meta&apos;s Private Replies API sends them one message (Meta allows exactly one per comment, within 7 days). Works on Instagram and on Facebook Pages. Unrelated comments get nothing.</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>New rule</h3>
        {accounts.length === 0 && <div className="msg err">No Instagram or Facebook account connected natively for this brand yet — connect one on Connections first.</div>}
        <div className="row">
          <div>
            <label>Account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.provider === "instagram" ? "Instagram" : "Facebook"} · {a.displayName}{a.username ? ` (@${a.username})` : ""}</option>
              ))}
            </select>
            {account && (
              <div className="small muted" style={{ marginTop: 4 }}>
                Webhook: {account.metadata.webhookSubscribedAt ? <span className="badge ok">subscribed {String((account.metadata.webhookFields as string[] | undefined)?.join(", ") ?? "")}</span> : <span className="badge">not subscribed</span>}{" "}
                <button className="small" type="button" onClick={() => void subscribe(account.id)}>Subscribe at Meta</button>
                {account.metadata.webhookError ? <div style={{ color: "var(--err)" }}>{String(account.metadata.webhookError)}</div> : null}
                <div>Until Meta approves live comment webhooks, this app also reads the chosen posts&apos; comments every minute with the account&apos;s own token (same rule, same one-reply guarantee).</div>
              </div>
            )}
          </div>
          <div>
            <label>Post</label>
            <select value={postId} onChange={(e) => setPostId(e.target.value)} disabled={posts.length === 0}>
              {posts.map((p) => (
                <option key={p.externalPostId} value={p.externalPostId}>{p.createdAt ? p.createdAt.slice(0, 10) + " · " : ""}{p.mediaType ? p.mediaType.toLowerCase() + " · " : ""}{p.label || p.externalPostId}</option>
              ))}
            </select>
            {postsErr && <div className="small" style={{ color: "var(--err)" }}>Could not list posts: {postsErr}</div>}
            {post?.url && <div className="small"><a href={post.url} target="_blank" rel="noreferrer">Open the post ↗</a></div>}
          </div>
        </div>
        <div className="row">
          <div>
            <label>Keyword (whole word, any capitalisation)</label>
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="CATALOGO" />
          </div>
          <div>
            <label>Enabled</label>
            <select value={enabled ? "on" : "off"} onChange={(e) => setEnabled(e.target.value === "on")}><option value="on">on</option><option value="off">off</option></select>
          </div>
        </div>
        <label>Private reply (sent once to the commenter)</label>
        <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={"Hi! Here is the link you asked for: https://example.com/catalog — reply here if you have any question."} />
        {err && <div className="msg err">{err}</div>}
        {msg && <div className="msg ok">{msg}</div>}
        <div style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy || !accountId || !postId || !keyword.trim() || !reply.trim()} onClick={() => void create()}>{busy ? "…" : "Save rule"}</button>
        </div>
      </div>

      <h3>Rules</h3>
      <div className="scroll-x"><table><thead><tr><th>Account</th><th>Post</th><th>Keyword</th><th>Reply</th><th>Enabled</th><th></th></tr></thead><tbody>
        {rules.map((r) => (
          <tr key={r.id}>
            <td className="small">{accountName(r.socialAccountId)}</td>
            <td className="small">{r.postUrl ? <a href={r.postUrl} target="_blank" rel="noreferrer">{r.postLabel || r.externalPostId}</a> : r.postLabel || r.externalPostId}</td>
            <td className="mono">{r.keyword}</td>
            <td className="small">{r.replyText.slice(0, 90)}{r.replyText.length > 90 ? "…" : ""}</td>
            <td><span className={`badge ${r.enabled ? "ok" : ""}`}>{r.enabled ? "on" : "off"}</span></td>
            <td><button type="button" onClick={() => void toggle(r)}>{r.enabled ? "Turn off" : "Turn on"}</button> <button type="button" onClick={() => void remove(r)}>Delete</button></td>
          </tr>
        ))}
        {rules.length === 0 && <tr><td colSpan={6} className="muted">No Comment → DM rules yet.</td></tr>}
      </tbody></table></div>

      <h3>Comments seen on watched posts (newest first)</h3>
      <div className="scroll-x"><table><thead><tr><th>When</th><th>Account</th><th>From</th><th>Comment</th><th>Via</th><th>Outcome</th><th>Detail</th><th></th></tr></thead><tbody>
        {events.map((ev) => (
          <tr key={ev.id}>
            <td className="small muted">{ev.createdAt.replace("T", " ").slice(0, 16)}</td>
            <td className="small">{ev.socialAccount.provider} · {ev.socialAccount.displayName}</td>
            <td className="small">{ev.authorName ?? "—"}</td>
            <td className="small">{(ev.commentText ?? "").slice(0, 80)}</td>
            <td className="small mono">{ev.source}</td>
            <td><span className={`badge ${STATUS_CLASS[ev.status] ?? ""}`}>{ev.status === "sent" ? "DM sent" : ev.status === "skipped" ? "no DM" : ev.status}</span></td>
            <td className="small muted">{ev.status === "sent" ? `message ${ev.providerMessageId ?? ""}` : ev.error ?? ""}</td>
            <td>{(ev.status === "failed" || ev.status === "uncertain") && <button type="button" onClick={() => void retry(ev)}>Retry</button>}</td>
          </tr>
        ))}
        {events.length === 0 && <tr><td colSpan={8} className="muted">Nothing yet. Comment the keyword on the watched post from another account to test.</td></tr>}
      </tbody></table></div>
    </div>
  );
}
