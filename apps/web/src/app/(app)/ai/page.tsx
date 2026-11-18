import Link from "next/link";
import { prisma } from "@sm/db";
import { formatInZone, getAiConfig, listWorkspaces } from "@sm/core";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { DraftBox, KnowledgeForm } from "@/components/AiPanels";
import { PLATFORMS } from "@/lib/platforms";

export const metadata = { title: "AI command center" };

/** What the AI can and cannot do in this build — stated plainly so nothing looks more capable than it is. */
const AGENTS: Array<{ name: string; does: string; built: boolean }> = [
  { name: "Caption writer", does: "Writes a post draft from your brief and the workspace's knowledge. You review every draft.", built: true },
  { name: "Content planner", does: "Proposes a publishing plan and topics.", built: false },
  { name: "Reply assistant", does: "Suggests answers to comments and messages.", built: false },
  { name: "Lead qualifier", does: "Sorts conversations into leads.", built: false },
  { name: "Ads optimiser", does: "Recommends budget and creative changes; never spends without approval.", built: false },
  { name: "Performance analyst", does: "Explains what worked, from stored results.", built: false },
];

export default async function AiPage() {
  const user = await requireUser();
  const brand = await getActiveBrand(user);
  const ai = await getAiConfig();
  const workspaces = await listWorkspaces(user.id);
  const ids = workspaces.map((w) => w.id);
  const since = new Date(Date.now() - 30 * 864e5);
  const [recent, perWs] = await Promise.all([
    prisma.auditLog.findMany({ where: { action: "ai.draft", brandId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 12 }),
    prisma.auditLog.groupBy({ by: ["brandId"], where: { action: "ai.draft", brandId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const name = new Map(workspaces.map((w) => [w.id, w.name]));
  const host = ai ? new URL(ai.baseUrl).host : null;

  return (
    <div>
      <div className="head">
        <div>
          <h1>AI command center</h1>
          <p className="lead">iGerald sends AI requests through OpenRouter with your own key. The AI only sees the workspace you are in, and it only writes drafts — it never publishes, messages or spends on its own.</p>
        </div>
        <Link className="btn" href="/settings">Model and key</Link>
      </div>

      <div className="grid">
        <div className="card"><div className="kpi" style={{ fontSize: 20, letterSpacing: "-0.02em" }}>{ai ? ai.model : "Not set up"}</div><div className="kpi-label">{ai ? `active model, through ${host}` : "no API key saved"}</div></div>
        <div className="card"><div className="kpi">{perWs.reduce((n, r) => n + r._count._all, 0)}</div><div className="kpi-label">drafts written, last 30 days</div></div>
        <div className="card"><div className="kpi">—</div><div className="kpi-label">cost — not tracked here yet; see your OpenRouter account</div></div>
        <div className="card"><div className="kpi">1<span className="muted" style={{ fontSize: 16 }}> / {AGENTS.length}</span></div><div className="kpi-label">agents built</div></div>
      </div>
      {!ai && <div className="msg info"><b>AI is off.</b> Add an OpenRouter API key under <Link href="/settings">Settings</Link> to turn drafts on. You pay OpenRouter for what you use; nothing else here charges for AI.</div>}

      <h2>Agents</h2>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Agent</th><th>What it does</th><th>State</th></tr></thead>
          <tbody>{AGENTS.map((a) => (<tr key={a.name}><td><b>{a.name}</b></td><td>{a.does}</td><td>{a.built ? <span className={`badge ${ai ? "ok" : "warn"}`}>{ai ? "Ready" : "Needs a key"}</span> : <span className="badge">Not built yet</span>}</td></tr>))}</tbody>
        </table>
      </div>

      {brand ? (
        <>
          <h2>Working in {brand.name}</h2>
          <DraftBox workspaceId={brand.id} enabled={Boolean(ai)} platforms={PLATFORMS.filter((p) => p.built).map((p) => ({ id: p.id, name: p.name }))} />
          <KnowledgeForm workspace={{ id: brand.id, name: brand.name, industry: brand.industry, description: brand.description, brandVoice: brand.brandVoice, targetAudience: brand.targetAudience }} />
        </>
      ) : (
        <div className="empty"><h3>No workspace selected</h3><p>Create a workspace to give the AI something to work for.</p><Link className="btn primary" href="/organizations?first=1">Create a workspace</Link></div>
      )}

      <h2>Recent AI activity</h2>
      {recent.length === 0 ? <p className="muted">No draft has been requested yet.</p> : (
        <div className="scroll-x">
          <table>
            <thead><tr><th>When</th><th>Workspace</th><th>Task</th><th>Model</th></tr></thead>
            <tbody>{recent.map((r) => { const d = (r.details ?? {}) as { model?: string; platform?: string }; return (<tr key={r.id}><td>{formatInZone(r.createdAt, user.timezone)}</td><td>{name.get(r.brandId ?? "") ?? "—"}</td><td>Caption draft{d.platform ? ` for ${d.platform}` : ""}</td><td className="mono">{d.model ?? "—"}</td></tr>); })}</tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 14, maxWidth: "80ch" }}>Failed requests show their error where you asked for the draft; they are not stored yet. Results are kept as records the AI can be given later — the underlying models are not retrained on your data by this app.</p>
    </div>
  );
}
