import { prisma } from "@sm/db";
import { nextAvailableSlot } from "@sm/core";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brand = await apiBrand(user, url.searchParams.get("brandId"));
  const accountId = url.searchParams.get("socialAccountId");
  const slots = await prisma.scheduleSlot.findMany({ where: { brandId: brand.id, active: true, OR: [{ socialAccountId: null }, { socialAccountId: accountId ?? undefined }] } });
  const taken = await prisma.post.findMany({ where: { brandId: brand.id, status: { in: ["scheduled", "publishing"] }, scheduledAt: { gte: new Date() } }, select: { scheduledAt: true } });
  const next = nextAvailableSlot(slots, new Date(), new Set(taken.map((t) => t.scheduledAt!.getTime())));
  return json({ next, slots: slots.length });
});
