import { prisma } from "@sm/db";
import { requireUser, requireBrand } from "@/lib/auth";
import { Action } from "@/components/Action";
import { AutomationForm } from "@/components/AutomationForm";
import { PrivateReplyRules } from "@/components/PrivateReplyRules";
import { PRIVATE_REPLY_ACTION } from "@sm/core";

export default async function AutomationsPage() {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const all = await prisma.automationRule.findMany({ where: { brandId: brand.id }, include: { _count: { select: { runs: true } } }, orderBy: { createdAt: "desc" } });
  // Comment → DM rules have their own editor below; the generic table shows the other rules.
  const rules = all.filter((r) => !((r.actions as Array<{ type?: string }>) ?? []).some((a) => a.type === PRIVATE_REPLY_ACTION));
  return (
    <div>
      <h1>Automations — {brand.name}</h1>
      <PrivateReplyRules brandId={brand.id} brandName={brand.name} />
      <h2 style={{ marginTop: 32 }}>Other rules</h2>
      <p className="small muted">Bounded rules: a trigger (event) → actions, with cooldown and per-contact caps.</p>
      <table><thead><tr><th>Name</th><th>Trigger</th><th>Actions</th><th>Enabled</th><th>Runs</th><th></th></tr></thead><tbody>
        {rules.map((r) => <tr key={r.id}><td>{r.name}</td><td className="mono small">{(r.trigger as { type: string }).type}</td><td className="mono small">{(r.actions as Array<{ type: string }>).map((a) => a.type).join(", ")}</td><td><span className={`badge ${r.enabled ? "ok" : ""}`}>{r.enabled ? "on" : "off"}</span></td><td>{r._count.runs}</td><td>{r.enabled && <Action path={`/api/automations/${r.id}/disable`} label="Disable" />}</td></tr>)}
        {rules.length === 0 && <tr><td colSpan={6} className="muted">No rules.</td></tr>}
      </tbody></table>
      <AutomationForm brandId={brand.id} />
    </div>
  );
}
