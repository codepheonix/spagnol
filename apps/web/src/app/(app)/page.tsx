import Link from "next/link";
import { prisma } from "@sm/db";
import { queueStats, formatInZone, getAiConfig, listAllAccounts, listWorkspaces } from "@sm/core";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { Action } from "@/components/Action";
import { Constellation } from "@/components/Constellation";
import { PLATFORMS } from "@/lib/platforms";

export const metadata = { title: "Overview" };

const dash = (v: number | null) => (v === null ? "—" : Math.round(v).toLocaleString("en"));

export default async function Overview() {
  const user = await requireUser();
  const brand = await getActiveBrand(user);
  const [workspaces, accounts, ai, stats] = await Promise.all([listWorkspaces(user.id), listAllAccounts(user.id), getAiConfig(), queueStats()]);
  const ids = workspaces.map((w) => w.id);
  const since = new Date(Date.now() - 30 * 864e5);
  const [activeCampaigns, leads, dmSent, dmSeen, aiDrafts, notifications, upcoming] = await Promise.all([
    prisma.adCampaign.count({ where: { adAccount: { brandId: { in: ids } }, status: { in: ["active", "ACTIVE"] } } }),
    prisma.contactRecord.count({ where: { brandId: { in: ids } } }),
    prisma.privateReply.count({ where: { brandId: { in: ids }, status: "sent", createdAt: { gte: since } } }),
    prisma.privateReply.count({ where: { brandId: { in: ids }, createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: "ai.draft", actorUserId: user.id, createdAt: { gte: since } } }),
    prisma.notification.findMany({ where: { readAt: null, OR: [{ brandId: { in: ids } }, { brandId: null }] }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.post.findMany({ where: { brandId: { in: ids }, status: { in: ["scheduled", "publishing"] } }, orderBy: { scheduledAt: "asc" }, take: 8, include: { brand: { select: { name: true, timezone: true } }, targets: { include: { socialAccount: { select: { provider: true } } } } } }),
  ]);
  const sum = (k: "scheduledPosts" | "publishedPosts" | "failedPosts") => workspaces.reduce((n, w) => n + w[k], 0);
  const known = accounts.filter((a) => a.followers !== null);
  const followers = known.length ? known.reduce((n, a) => n + (a.followers ?? 0), 0) : null;
  const nodes = PLATFORMS.map((p) => {
    const mine = accounts.filter((a) => a.provider === p.id);
    return { id: p.id, connected: mine.length > 0, count: mine.length, href: mine.length > 0 ? `/accounts?provider=${p.id}` : `/connections?connect=${p.id}` };
  });
  const first = workspaces.length === 0;

  return (
    <div>
      <section className="hero">
        <div>
          <h1>{first ? "Connect your first account." : accounts.length === 0 ? "Your workspace is ready. Nothing is connected yet." : `${accounts.length} account${accounts.length === 1 ? "" : "s"} in ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}.`}</h1>
          <p className="lead">{first ? "Create a workspace for yourself or a company, then sign in on each platform's own page. Every number on this page comes from what is really connected." : brand ? `You are working in ${brand.name}. Lit platforms have at least one connected account; pick one to open it, or a dim one to connect it.` : ""}</p>
          <div className="row">
            {first ? <Link className="btn primary" href="/organizations?first=1">Create a workspace</Link> : <Link className="btn primary" href="/connections">+ Connect social account</Link>}
            <Link className="btn" href="/organizations?add=1">+ Add company</Link>
            {!first && <Link className="btn ghost" href="/posts/new">New post</Link>}
          </div>
        </div>
        <Constellation nodes={nodes} />
      </section>

      <div className="grid">
        <div className="card"><div className="kpi">{accounts.length}</div><div className="kpi-label">connected social accounts</div></div>
        <div className="card"><div className="kpi">{workspaces.filter((w) => w.kind !== "personal").length}</div><div className="kpi-label">companies</div></div>
        <div className="card"><div className="kpi">{workspaces.filter((w) => w.kind === "personal").length}</div><div className="kpi-label">personal workspaces</div></div>
        <div className="card"><div className="kpi">{sum("scheduledPosts")}</div><div className="kpi-label">scheduled posts</div></div>
        <div className="card"><div className="kpi">{sum("publishedPosts")}</div><div className="kpi-label">published posts</div></div>
        <div className="card"><div className="kpi" style={{ color: sum("failedPosts") ? "var(--err)" : undefined }}>{sum("failedPosts")}</div><div className="kpi-label">failed or partly published</div></div>
        <div className="card"><div className="kpi">{dash(followers)}</div><div className="kpi-label">followers{followers === null ? " — not reported yet" : ` across ${known.length} account${known.length === 1 ? "" : "s"}`}</div></div>
        <div className="card"><div className="kpi">{activeCampaigns}</div><div className="kpi-label">active ad campaigns (synced)</div></div>
        <div className="card"><div className="kpi">—</div><div className="kpi-label">ad spend — not read from the ad platforms yet</div></div>
        <div className="card"><div className="kpi">{leads}</div><div className="kpi-label">contacts saved</div></div>
        <div className="card"><div className="kpi">{dmSent}<span className="muted" style={{ fontSize: 16 }}> / {dmSeen}</span></div><div className="kpi-label">comment replies sent / comments seen, 30 days</div></div>
        <div className="card"><div className="kpi">{ai ? aiDrafts : "—"}</div><div className="kpi-label">{ai ? "AI drafts, 30 days (cost not tracked yet)" : "AI is not set up"}</div></div>
      </div>
      {stats.lagSeconds > 300 && <div className="msg err" role="alert">Background jobs are {Math.round(stats.lagSeconds / 60)} minutes behind. Scheduled posts may be late — see <Link href="/health">System health</Link>.</div>}

      <h2 id="notifications">Notifications</h2>
      {notifications.length === 0 ? <p className="muted">Nothing needs your attention.</p> : (
        <div className="card">
          <table><tbody>{notifications.map((n) => (<tr key={n.id}><td><span className={`badge ${n.level}`}>{n.level}</span></td><td>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}<div className="small muted">{n.body}</div></td><td className="small muted">{formatInZone(n.createdAt, user.timezone)}</td></tr>))}</tbody></table>
          <div style={{ marginTop: 8 }}><Action path="/api/notifications" json={{ ids: notifications.map((n) => n.id) }} label="Mark all read" /></div>
        </div>
      )}

      <h2>Going out next</h2>
      {upcoming.length === 0 ? <p className="muted">Nothing is scheduled in any workspace.</p> : (
        <div className="scroll-x">
          <table><thead><tr><th>When</th><th>Workspace</th><th>Post</th><th>Destinations</th></tr></thead><tbody>
            {upcoming.map((p) => (<tr key={p.id}><td>{p.scheduledAt ? formatInZone(p.scheduledAt, p.scheduleTimezone ?? p.brand.timezone) : "—"}</td><td>{p.brand.name}</td><td><Link href={`/posts/${p.id}`}>{(p.title ?? p.body).slice(0, 70) || "(no text)"}</Link></td><td>{p.targets.map((t) => <span key={t.id} className={`badge ${t.status}`} style={{ marginRight: 4 }}>{t.socialAccount.provider}: {t.status}</span>)}</td></tr>))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
