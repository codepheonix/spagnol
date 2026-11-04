import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brand = await apiBrand(user, url.searchParams.get("brandId"));
  const q = url.searchParams.get("q");
  const threads = await prisma.inboxThread.findMany({ where: { brandId: brand.id, status: url.searchParams.get("status") ?? "open", ...(q ? { OR: [{ participantName: { contains: q, mode: "insensitive" } }, { lastMessageText: { contains: q, mode: "insensitive" } }] } : {}) }, orderBy: { lastMessageAt: "desc" }, take: 100, include: { socialAccount: { select: { provider: true, displayName: true } } } });
  return json({ threads });
});
