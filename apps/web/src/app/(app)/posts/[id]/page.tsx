import { notFound } from "next/navigation";
import { prisma } from "@sm/db";
import { getPost, getAiConfig, formatInZone, AppError } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { PostEditor } from "@/components/PostEditor";
import { Action } from "@/components/Action";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const { id } = await params;
  let post;
  try {
    post = await getPost(user.id, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: post.brandId, status: { not: "disconnected" } }, select: { id: true, provider: true, displayName: true, backend: true, status: true } });
  const media = await prisma.mediaAsset.findMany({ where: { brandId: post.brandId, status: "ready" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, originalName: true, mimeType: true } });
  const attempts = await prisma.publishAttempt.findMany({ where: { postTarget: { postId: id } }, orderBy: { startedAt: "desc" }, take: 30, include: { postTarget: { include: { socialAccount: { select: { displayName: true } } } } } });
  const editable = ["draft", "validated", "failed", "partial", "canceled"].includes(post.status);
  return (
    <div>
      <h1><span className={`badge ${post.status}`}>{post.status}</span> Post</h1>
      {post.scheduledAt && <p className="small muted">Scheduled for {formatInZone(post.scheduledAt, post.scheduleTimezone ?? brand.timezone)} ({post.scheduleTimezone}) — UTC {post.scheduledAt.toISOString()}</p>}
      <div className="row">
        {["scheduled", "publishing", "draft", "validated"].includes(post.status) && <Action className="danger" path={`/api/posts/${id}/cancel`} label="Cancel" confirm="Cancel this post and its queued jobs?" />}
        <Action path={`/api/posts/${id}/duplicate`} label="Duplicate" onDone={(d) => { window.location.href = `/posts/${(d as { post: { id: string } }).post.id}`; }} />
      </div>
      <h2>Targets</h2>
      <table><thead><tr><th>Account</th><th>Status</th><th>Remote</th><th>Attempts</th><th>Error</th><th></th></tr></thead><tbody>
        {post.targets.map((t) => (<tr key={t.id}><td>{t.socialAccount.displayName}<div className="small muted">{t.socialAccount.provider}/{t.socialAccount.backend}</div></td><td><span className={`badge ${t.status}`}>{t.status}</span></td><td className="small">{t.remoteUrl ? <a href={t.remoteUrl} target="_blank" rel="noreferrer">{t.remoteUrl.slice(0, 60)}</a> : t.remotePostId ? <span className="mono">{t.remotePostId}</span> : "—"}{t.publishedAt && <div className="muted">{formatInZone(t.publishedAt, brand.timezone)}</div>}</td><td>{t.attempts}</td><td className="small" style={{ color: "var(--err)" }}>{t.lastError}</td><td className="row">{["failed_retryable", "failed_permanent", "canceled", "needs_reconnect", "blocked"].includes(t.status) && <Action path={`/api/posts/${id}/retry/${t.id}`} label="Retry" />}{t.status === "published" && <Action className="danger" path={`/api/posts/${id}/targets/${t.id}/delete-remote`} label="Delete remotely" confirm="Delete this post on the network?" />}</td></tr>))}
      </tbody></table>
      {attempts.length > 0 && (<details><summary>Publish attempts ({attempts.length})</summary><table><thead><tr><th>Account</th><th>#</th><th>Status</th><th>Remote id</th><th>Request id</th><th>Error</th><th>When</th></tr></thead><tbody>{attempts.map((a) => <tr key={a.id}><td>{a.postTarget.socialAccount.displayName}</td><td>{a.attemptNumber}</td><td><span className={`badge ${a.status}`}>{a.status}</span></td><td className="mono">{a.remotePostId}</td><td className="mono">{a.providerRequestId}</td><td className="small">{a.error}</td><td className="small muted">{formatInZone(a.startedAt, brand.timezone)}</td></tr>)}</tbody></table></details>)}
      <h2>{editable ? "Edit" : "Content"}</h2>
      <PostEditor brandId={post.brandId} accounts={accounts} media={media} timezone={brand.timezone} aiEnabled={Boolean(await getAiConfig())} initial={{ id: post.id, title: post.title, body: post.body, link: post.link, tags: post.tags, mediaIds: post.media.map((m) => m.mediaId), targets: post.targets.map((t) => ({ socialAccountId: t.socialAccountId, overrides: t.overrides as Record<string, unknown> })), scheduledAt: post.scheduledAt?.toISOString() ?? null, scheduleTimezone: post.scheduleTimezone, status: post.status }} />
    </div>
  );
}
