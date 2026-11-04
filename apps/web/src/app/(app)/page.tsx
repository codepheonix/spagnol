import Link from "next/link";
import { prisma } from "@sm/db";
import { queueStats, formatInZone } from "@sm/core";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { Action } from "@/components/Action";

export default async function Dashboard() {
  const user = await requireUser();
  const brand = await getActiveBrand(user);
  if (!brand) return <div><h1>Welcome</h1><p>Create your first brand to begin. <Link href="/brands?first=1">Brands →</Link></p></div>;
  const [accounts, scheduled, published, failed, drafts, stats, notifications] = await Promise.all([
    prisma.socialAccount.findMany({ where: { brandId: brand.id } }),
    prisma.post.count({ where: { brandId: brand.id, status: "scheduled" } }),
    prisma.post.count({ where: { brandId: brand.id, status: "published" } }),
    prisma.post.count({ where: { brandId: brand.id, status: { in: ["failed", "partial"] } } }),
    prisma.post.count({ where: { brandId: brand.id, status: "draft" } }),
    queueStats(),
    prisma.notification.findMany({ where: { readAt: null, OR: [{ brandId: brand.id }, { brandId: null }] }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const upcoming = await prisma.post.findMany({ where: { brandId: brand.id, status: { in: ["scheduled", "publishing"] } }, orderBy: { scheduledAt: "asc" }, take: 8, include: { targets: { include: { socialAccount: { select: { provider: true, displayName: true } } } } } });
  return (
    <div>
      <h1>{brand.name}</h1>
      <div className="grid">
        <div className="card"><div className="kpi">{accounts.filter((a) => a.status === "connected").length}/{accounts.length}</div><div className="kpi-label">connected accounts</div></div>
        <div className="card"><div className="kpi">{scheduled}</div><div className="kpi-label">scheduled posts</div></div>
        <div className="card"><div className="kpi">{published}</div><div className="kpi-label">published</div></div>
        <div className="card"><div className="kpi" style={{ color: failed ? "var(--err)" : undefined }}>{failed}</div><div className="kpi-label">failed / partial</div></div>
        <div className="card"><div className="kpi">{drafts}</div><div className="kpi-label">drafts</div></div>
        <div className="card"><div className="kpi">{stats.queued}</div><div className="kpi-label">queued jobs {stats.lagSeconds > 300 ? <span className="badge err">lag {Math.round(stats.lagSeconds / 60)} min — is the worker/cron running?</span> : null}</div></div>
      </div>
      <div className="row"><Link href="/posts/new" className="btn">+ New post</Link><Link href="/accounts" className="btn">Connect an account</Link></div>
      {notifications.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Notifications</h2>
          <table><tbody>{notifications.map((n) => (<tr key={n.id}><td><span className={`badge ${n.level}`}>{n.level}</span></td><td>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}<div className="small muted">{n.body}</div></td><td className="small muted">{formatInZone(n.createdAt, brand.timezone)}</td></tr>))}</tbody></table>
          <div style={{ marginTop: 8 }}><Action path="/api/notifications" json={{ ids: notifications.map((n) => n.id) }} label="Mark all read" /></div>
        </div>
      )}
      <h2>Upcoming</h2>
      {upcoming.length === 0 ? <p className="muted">Nothing scheduled.</p> : (
        <table><thead><tr><th>When ({brand.timezone})</th><th>Post</th><th>Targets</th></tr></thead><tbody>
          {upcoming.map((p) => (<tr key={p.id}><td>{p.scheduledAt ? formatInZone(p.scheduledAt, p.scheduleTimezone ?? brand.timezone) : "—"}</td><td><Link href={`/posts/${p.id}`}>{(p.title ?? p.body).slice(0, 70) || "(no text)"}</Link></td><td>{p.targets.map((t) => <span key={t.id} className={`badge ${t.status}`} style={{ marginRight: 4 }}>{t.socialAccount.provider}: {t.status}</span>)}</td></tr>))}
        </tbody></table>
      )}
    </div>
  );
}
