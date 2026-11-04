import { prisma } from "@sm/db";
import { audit } from "@sm/core";
import { apiUser, handle, json, HttpError } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const rule = await prisma.automationRule.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!rule) throw new HttpError(404, "Rule not found.", "not_found");
  await prisma.automationRule.update({ where: { id }, data: { enabled: false } });
  await audit({ actorUserId: user.id, brandId: rule.brandId, action: "automation.disable", targetId: id });
  return json({ ok: true });
});
