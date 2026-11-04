import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brand = await apiBrand(user, url.searchParams.get("brandId"));
  const from = new Date(url.searchParams.get("from") ?? Date.now() - 7 * 86_400_000);
  const to = new Date(url.searchParams.get("to") ?? Date.now() + 60 * 86_400_000);
  const posts = await prisma.post.findMany({ where: { brandId: brand.id, OR: [{ scheduledAt: { gte: from, lte: to } }, { publishedAt: { gte: from, lte: to } }, { status: "draft", createdAt: { gte: from, lte: to } }] }, include: { targets: { include: { socialAccount: { select: { provider: true, displayName: true } } } } }, orderBy: { scheduledAt: "asc" } });
  return json({ from, to, events: posts.map((p) => ({ id: p.id, at: p.scheduledAt ?? p.publishedAt ?? p.createdAt, timezone: p.scheduleTimezone, status: p.status, excerpt: (p.title ?? p.body).slice(0, 80), targets: p.targets.map((t) => ({ id: t.id, status: t.status, provider: t.socialAccount.provider, account: t.socialAccount.displayName, url: t.remoteUrl })) })) });
});
