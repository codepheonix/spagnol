import { prisma } from "@sm/db";
import { apiUser, handle, json, HttpError } from "@/lib/api";

/** Local validation only (provider dry-run is enabled with the write path). */
export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const draft = await prisma.adCampaignDraft.findFirst({ where: { id, brand: { ownerId: user.id } }, include: { adAccount: true } });
  if (!draft) throw new HttpError(404, "Draft not found.", "not_found");
  const spec = draft.spec as { budget?: { amount?: number; type?: string }; objective?: string; creative?: Record<string, unknown> };
  const issues: string[] = [];
  if (!spec.objective) issues.push("objective missing");
  if (!spec.budget?.amount || spec.budget.amount <= 0) issues.push("budget must be positive");
  if (draft.adAccount.spendCapMinor !== null && spec.budget?.amount && Math.round(spec.budget.amount * 100) > draft.adAccount.spendCapMinor) issues.push("budget exceeds the ad account spend ceiling");
  if (!spec.creative || !Object.keys(spec.creative).length) issues.push("creative missing");
  if (draft.adAccount.readOnly) issues.push("ad account is read-only (writes disabled)");
  const validation = { ok: issues.length === 0, issues, checkedAt: new Date().toISOString(), providerDryRun: "not_run" };
  await prisma.adCampaignDraft.update({ where: { id }, data: { validation, status: validation.ok ? "validated" : "draft" } });
  return json({ validation });
});
