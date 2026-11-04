import { prisma } from "@sm/db";
import { requireUser, requireBrand } from "@/lib/auth";
import { Action } from "@/components/Action";
import { AutomationForm } from "@/components/AutomationForm";

export default async function AutomationsPage() {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const rules = await prisma.automationRule.findMany({ where: { brandId: brand.id }, include: { _count: { select: { runs: true } } }, orderBy: { createdAt: "desc" } });
  return (
    <div>
      <h1>Automations — {brand.name}</h1>
      <p className="small muted">Bounded rules: a trigger (event) → actions, with cooldown and per-contact caps. Messaging actions (auto-DM / auto-reply) are intentionally not offered until live provider policy checks are verified; comment→DM runs inside Zernio workflows where allowed.</p>
      <table><thead><tr><th>Name</th><th>Trigger</th><th>Actions</th><th>Enabled</th><th>Runs</th><th></th></tr></thead><tbody>
        {rules.map((r) => <tr key={r.id}><td>{r.name}</td><td className="mono small">{(r.trigger as { type: string }).type}</td><td className="mono small">{(r.actions as Array<{ type: string }>).map((a) => a.type).join(", ")}</td><td><span className={`badge ${r.enabled ? "ok" : ""}`}>{r.enabled ? "on" : "off"}</span></td><td>{r._count.runs}</td><td>{r.enabled && <Action path={`/api/automations/${r.id}/disable`} label="Disable" />}</td></tr>)}
        {rules.length === 0 && <tr><td colSpan={6} className="muted">No rules.</td></tr>}
      </tbody></table>
      <AutomationForm brandId={brand.id} />
    </div>
  );
}
