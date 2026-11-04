import { prisma } from "@sm/db";
import { queueStats, formatInZone } from "@sm/core";
import { requireUser } from "@/lib/auth";
import { Action } from "@/components/Action";

export default async function HealthPage() {
  const user = await requireUser();
  const tz = user.timezone;
  const [stats, accounts, dead, recent, heartbeats, lastTick, webhooks] = await Promise.all([
    queueStats(),
    prisma.socialAccount.findMany({ where: { brand: { ownerId: user.id } }, include: { brand: { select: { name: true } } } }),
    prisma.job.findMany({ where: { status: "dead" }, orderBy: { updatedAt: "desc" }, take: 20 }),
    prisma.job.findMany({ orderBy: { updatedAt: "desc" }, take: 25 }),
    prisma.systemSetting.findMany({ where: { key: { startsWith: "worker.heartbeat." } } }),
    prisma.systemSetting.findUnique({ where: { key: "jobs.lastTick" } }),
    prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 15 }),
  ]);
  const lastTickAt = (lastTick?.value as { at?: string } | null)?.at;
  const freshWorker = heartbeats.some((h) => Date.now() - new Date((h.value as { at: string }).at).getTime() < 3 * 60_000);
  const freshTick = lastTickAt && Date.now() - new Date(lastTickAt).getTime() < 15 * 60_000;
  return (
    <div>
      <h1>Health</h1>
      <div className="grid">
        <div className="card"><div className="kpi">{stats.queued}</div><div className="kpi-label">queued · lag {stats.lagSeconds}s</div></div>
        <div className="card"><div className="kpi">{stats.running}</div><div className="kpi-label">running</div></div>
        <div className="card"><div className="kpi" style={{ color: stats.dead ? "var(--err)" : undefined }}>{stats.dead}</div><div className="kpi-label">dead-letter</div></div>
        <div className="card"><div className="kpi">{freshWorker || freshTick ? <span className="badge ok">alive</span> : <span className="badge err">no runner</span>}</div><div className="kpi-label">job runner — worker heartbeat: {heartbeats.length ? heartbeats.map((h) => formatInZone(new Date((h.value as { at: string }).at), tz)).join(", ") : "none"}; last cron tick: {lastTickAt ? formatInZone(new Date(lastTickAt), tz) : "never"}</div></div>
      </div>
      {!(freshWorker || freshTick) && <div className="msg err small">Nothing is processing jobs. Run <span className="mono">pnpm worker</span> on an always-on machine, or schedule <span className="mono">POST /api/jobs/tick</span> (Vercel Cron / cron-job.org) at least every few minutes. Posts scheduled through the Zernio backend still publish on time because Zernio stores the schedule itself.</div>}
      <h2>Connections</h2>
      <table><thead><tr><th>Brand</th><th>Account</th><th>Status</th><th>Health</th><th>Last check</th><th>Error</th></tr></thead><tbody>
        {accounts.map((a) => <tr key={a.id}><td>{a.brand.name}</td><td>{a.displayName} <span className="badge">{a.provider}/{a.backend}</span></td><td><span className={`badge ${a.status}`}>{a.status}</span></td><td><span className={`badge ${a.healthStatus}`}>{a.healthStatus}</span></td><td className="small muted">{a.lastCheckedAt ? formatInZone(a.lastCheckedAt, tz) : "—"}</td><td className="small" style={{ color: "var(--err)" }}>{a.lastError}</td></tr>)}
      </tbody></table>
      <h2>Dead-letter jobs</h2>
      <table><thead><tr><th>Type</th><th>Attempts</th><th>Error</th><th>When</th><th></th></tr></thead><tbody>
        {dead.map((j) => <tr key={j.id}><td className="mono">{j.type}</td><td>{j.attempts}</td><td className="small">{j.lastError}</td><td className="small muted">{formatInZone(j.updatedAt, tz)}</td><td><Action path={`/api/jobs/${j.id}/retry`} label="Retry" /></td></tr>)}
        {dead.length === 0 && <tr><td colSpan={5} className="muted">None.</td></tr>}
      </tbody></table>
      <h2>Recent jobs</h2>
      <table><thead><tr><th>Type</th><th>Status</th><th>Run at</th><th>Attempts</th><th>Locked by</th><th>Error</th></tr></thead><tbody>
        {recent.map((j) => <tr key={j.id}><td className="mono small">{j.type}</td><td><span className={`badge ${j.status}`}>{j.status}</span></td><td className="small muted">{formatInZone(j.runAt, tz)}</td><td>{j.attempts}/{j.maxAttempts}</td><td className="small mono">{j.lockedBy}</td><td className="small">{j.lastError?.slice(0, 100)}</td></tr>)}
      </tbody></table>
      <h2>Webhook events</h2>
      <table><thead><tr><th>Provider</th><th>Event</th><th>Signature</th><th>Status</th><th>Received</th></tr></thead><tbody>
        {webhooks.map((w) => <tr key={w.id}><td>{w.provider}</td><td className="mono small">{w.eventType}</td><td>{w.signatureValid ? <span className="badge ok">valid</span> : <span className="badge warn">unverified</span>}</td><td><span className={`badge ${w.status === "processed" ? "ok" : w.status === "failed" ? "err" : ""}`}>{w.status}</span></td><td className="small muted">{formatInZone(w.receivedAt, tz)}</td></tr>)}
        {webhooks.length === 0 && <tr><td colSpan={5} className="muted">None received.</td></tr>}
      </tbody></table>
    </div>
  );
}
