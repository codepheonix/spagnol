import { prisma } from "@sm/db";
import { apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  const logs = await prisma.auditLog.findMany({ where: { OR: [{ actorUserId: user.id }, { brand: { ownerId: user.id } }], brandId: brandId ?? undefined }, orderBy: { createdAt: "desc" }, take: 200 });
  return json({ activity: logs });
});
