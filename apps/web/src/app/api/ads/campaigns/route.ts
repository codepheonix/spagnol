import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  return json({ campaigns: await prisma.adCampaign.findMany({ where: { adAccount: { brandId: brand.id } }, include: { adAccount: { select: { name: true, provider: true, currency: true, readOnly: true } } }, orderBy: { syncedAt: "desc" } }) });
});
