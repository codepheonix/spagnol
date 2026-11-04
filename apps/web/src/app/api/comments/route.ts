import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brand = await apiBrand(user, url.searchParams.get("brandId"));
  const comments = await prisma.comment.findMany({ where: { brandId: brand.id, isOwner: false }, orderBy: { remoteCreatedAt: "desc" }, take: 200, include: { socialAccount: { select: { provider: true, displayName: true } } } });
  return json({ comments });
});
