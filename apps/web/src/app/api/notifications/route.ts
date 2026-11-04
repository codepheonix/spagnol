import { z } from "zod";
import { prisma } from "@sm/db";
import { apiUser, handle, json, parseJson } from "@/lib/api";

export const GET = handle(async () => {
  const user = await apiUser();
  const brandIds = (await prisma.brand.findMany({ where: { ownerId: user.id }, select: { id: true } })).map((b) => b.id);
  return json({ notifications: await prisma.notification.findMany({ where: { OR: [{ brandId: { in: brandIds } }, { brandId: null }] }, orderBy: { createdAt: "desc" }, take: 50 }) });
});

export const POST = handle(async (req) => {
  await apiUser();
  const { ids } = await parseJson(req, z.object({ ids: z.array(z.string()).max(100) }));
  await prisma.notification.updateMany({ where: { id: { in: ids } }, data: { readAt: new Date() } });
  return json({ ok: true });
});
