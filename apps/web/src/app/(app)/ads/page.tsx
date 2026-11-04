import { prisma } from "@sm/db";
import { getZernioConfig, formatInZone } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { Action } from "@/components/Action";

export default async function AdsPage() {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const zernio = Boolean(await getZernioConfig());
  const accounts = await prisma.adAccount.findMany({ where: { brandId: brand.id }, include: { campaigns: { orderBy: { syncedAt: "desc" } } } });
  const drafts = await prisma.adCampaignDraft.findMany({ where: { brandId: brand.id }, orderBy: { updatedAt: "desc" } });
  const money = (minor: number | null, cur?: string | null) => (minor === null ? "—" : `${(minor / 100).toFixed(2)} ${cur ?? ""}`);
  return (
    <div>
      <h1>Ads — {brand.name}</h1>
      <div className="msg info small">Safety: ad accounts start <b>read-only</b>. Reporting and pause work; campaign creation/activation is disabled until the read-only sync is live-verified and you enable writes per ad account. Activation always needs a fresh confirmation showing the exact budget. Ad money stays on the Meta ad account; this app keeps a ledger only.</div>
      {!zernio && <div className="msg err">Add your Zernio API key in Settings, then connect the Meta ad account (Accounts → Facebook via Zernio with Facebook Login) to sync ads.</div>}
      <div className="row"><Action path={`/api/ads/sync?brandId=${brand.id}`} label="Sync ad accounts & campaigns" /></div>
      {accounts.map((a) => (
        <div key={a.id} className="card">
          <h3 style={{ marginTop: 0 }}>{a.name} <span className="badge">{a.provider}</span> <span className={`badge ${a.status}`}>{a.status}</span> {a.readOnly ? <span className="badge ok">read-only</span> : <span className="badge warn">writes enabled</span>}</h3>
          <div className="small muted">Currency {a.currency ?? "?"} · timezone {a.timezone ?? "?"} · synced {a.syncedAt ? formatInZone(a.syncedAt, brand.timezone) : "never"} · spend ceiling {a.spendCapMinor === null ? "none" : money(a.spendCapMinor, a.currency)}</div>
          <table><thead><tr><th>Campaign</th><th>Objective</th><th>Status</th><th>Budget</th><th>Spend</th><th>Impr.</th><th>Clicks</th><th>CTR</th><th>CPC</th><th></th></tr></thead><tbody>
            {a.campaigns.map((c) => { const m = c.metrics as Record<string, number | null>; return <tr key={c.id}><td>{c.name}<div className="small mono muted">{c.externalId}</div></td><td className="small">{c.objective ?? "—"}</td><td><span className={`badge ${c.status === "active" ? "ok" : "warn"}`}>{c.status}</span></td><td className="small">{c.dailyBudgetMinor !== null ? `${money(c.dailyBudgetMinor, c.currency)}/day` : c.lifetimeBudgetMinor !== null ? `${money(c.lifetimeBudgetMinor, c.currency)} lifetime` : "—"}</td><td>{m.spend ?? "—"}</td><td>{m.impressions ?? "—"}</td><td>{m.clicks ?? "—"}</td><td>{m.ctr ?? "—"}</td><td>{m.cpc ?? "—"}</td><td>{c.status === "active" ? <Action className="danger" path={`/api/ads/campaigns/${c.id}/status`} method="PATCH" json={{ status: "paused" }} label="Pause" confirm="Pause this campaign on the platform?" /> : <Action path={`/api/ads/campaigns/${c.id}/status`} method="PATCH" json={{ status: "active" }} label="Resume" confirm="Resume spending on this campaign?" />}</td></tr>; })}
            {a.campaigns.length === 0 && <tr><td colSpan={10} className="muted">No campaigns synced.</td></tr>}
          </tbody></table>
        </div>
      ))}
      {accounts.length === 0 && <p className="muted">No ad accounts connected.</p>}
      <h2>Campaign drafts</h2>
      <table><thead><tr><th>Name</th><th>Status</th><th>Validation</th><th>Updated</th></tr></thead><tbody>
        {drafts.map((d) => <tr key={d.id}><td>{d.name}</td><td><span className="badge">{d.status}</span></td><td className="small">{d.validation ? JSON.stringify(d.validation).slice(0, 120) : "—"}</td><td className="small muted">{formatInZone(d.updatedAt, brand.timezone)}</td></tr>)}
        {drafts.length === 0 && <tr><td colSpan={4} className="muted">No drafts (create via POST /api/ads/campaign-drafts).</td></tr>}
      </tbody></table>
    </div>
  );
}
