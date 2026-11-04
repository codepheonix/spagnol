import Link from "next/link";
import { prisma } from "@sm/db";
import { formatInZone } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { ReplyBox } from "@/components/ReplyBox";

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const sp = await searchParams;
  const tab = sp.tab ?? "messages";
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id, status: "connected" } });
  const caps = (a: (typeof accounts)[number]) => ((a.metadata as { capabilities?: Record<string, string> }).capabilities ?? {});
  return (
    <div>
      <h1>Inbox — {brand.name}</h1>
      <div className="row"><Link href="/inbox?tab=messages" className={tab === "messages" ? "btn" : ""}>Messages</Link><Link href="/inbox?tab=comments" className={tab === "comments" ? "btn" : ""}>Comments</Link><Link href="/inbox?tab=reviews" className={tab === "reviews" ? "btn" : ""}>Reviews</Link></div>
      <p className="small muted">Limits per account: {accounts.map((a) => <span key={a.id} style={{ marginRight: 8 }}>{a.displayName}: DMs <b>{caps(a).read_dm ?? "?"}</b>, comments <b>{caps(a).read_comments ?? "?"}</b></span>)}{accounts.length === 0 && "no connected accounts"}</p>
      {tab === "messages" && <Messages brandId={brand.id} tz={brand.timezone} thread={sp.thread} />}
      {tab === "comments" && <Comments brandId={brand.id} tz={brand.timezone} />}
      {tab === "reviews" && <Reviews brandId={brand.id} tz={brand.timezone} />}
    </div>
  );
}

async function Messages({ brandId, tz, thread }: { brandId: string; tz: string; thread?: string }) {
  const threads = await prisma.inboxThread.findMany({ where: { brandId, status: "open" }, orderBy: { lastMessageAt: "desc" }, take: 100, include: { socialAccount: { select: { provider: true, displayName: true } } } });
  const open = thread ? await prisma.inboxThread.findFirst({ where: { id: thread, brandId }, include: { messages: { orderBy: { sentAt: "asc" } }, socialAccount: true } }) : null;
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <table style={{ width: 420 }}><tbody>{threads.map((t) => <tr key={t.id} style={{ fontWeight: t.unreadCount ? 600 : 400 }}><td><Link href={`/inbox?tab=messages&thread=${t.id}`}>{t.participantName ?? t.participantId ?? t.externalThreadId}</Link><div className="small muted">{t.socialAccount.provider} · {t.lastMessageText?.slice(0, 50)}</div></td><td className="small muted">{t.lastMessageAt ? formatInZone(t.lastMessageAt, tz) : ""}</td></tr>)}{threads.length === 0 && <tr><td className="muted">No conversations synced yet. They arrive via webhooks/periodic sync for accounts whose API exposes DMs.</td></tr>}</tbody></table>
      {open && (<div className="card" style={{ flex: 1 }}><h3 style={{ marginTop: 0 }}>{open.participantName ?? open.externalThreadId} <span className="badge">{open.socialAccount.provider}</span></h3>
        {open.messages.map((m) => <div key={m.id} style={{ textAlign: m.direction === "outbound" ? "right" : "left", margin: "4px 0" }}><span className="badge" style={{ background: m.direction === "outbound" ? "#e0e7ff" : "#f1f1f1" }}>{m.body ?? "(attachment)"}</span><div className="small muted">{formatInZone(m.sentAt, tz)} {m.deliveryStatus ?? ""}</div></div>)}
        <ReplyBox path={`/api/inbox/threads/${open.id}/replies`} /></div>)}
    </div>
  );
}

async function Comments({ brandId, tz }: { brandId: string; tz: string }) {
  const comments = await prisma.comment.findMany({ where: { brandId, isOwner: false }, orderBy: { remoteCreatedAt: "desc" }, take: 100, include: { socialAccount: { select: { provider: true, displayName: true } } } });
  return (<table><thead><tr><th>When</th><th>Account</th><th>Author</th><th>Comment</th><th>Reply</th></tr></thead><tbody>
    {comments.map((c) => <tr key={c.id}><td className="small muted">{formatInZone(c.remoteCreatedAt, tz)}</td><td className="small">{c.socialAccount.displayName}</td><td>{c.authorName}</td><td>{c.body}{c.repliedAt && <span className="badge ok" style={{ marginLeft: 6 }}>replied</span>}{(c.metadata as { url?: string }).url && <a className="small" href={(c.metadata as { url: string }).url} target="_blank" rel="noreferrer"> ↗</a>}</td><td><ReplyBox path={`/api/comments/${c.id}/reply`} /></td></tr>)}
    {comments.length === 0 && <tr><td colSpan={5} className="muted">No comments synced yet.</td></tr>}
  </tbody></table>);
}

async function Reviews({ brandId, tz }: { brandId: string; tz: string }) {
  const reviews = await prisma.review.findMany({ where: { brandId }, orderBy: { remoteCreatedAt: "desc" }, take: 100 });
  return (<table><thead><tr><th>When</th><th>Rating</th><th>Author</th><th>Review</th><th>Reply</th></tr></thead><tbody>
    {reviews.map((r) => <tr key={r.id}><td className="small muted">{formatInZone(r.remoteCreatedAt, tz)}</td><td>{r.rating ?? "—"}</td><td>{r.authorName}</td><td>{r.body}</td><td className="small">{r.replyBody ?? "—"}</td></tr>)}
    {reviews.length === 0 && <tr><td colSpan={5} className="muted">Reviews come from Google Business Profile (via Zernio). None synced.</td></tr>}
  </tbody></table>);
}
