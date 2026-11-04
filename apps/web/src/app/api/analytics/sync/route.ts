import { prisma } from "@sm/db";
import { enqueue } from "@sm/core";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id, status: "connected" } });
  const jobs = [];
  for (const a of accounts) jobs.push(await enqueue("sync_analytics", { socialAccountId: a.id }, { dedupeKey: `analytics:manual:${a.id}:${Math.floor(Date.now() / 60_000)}`, brandId: brand.id, priority: 5 }));
  return json({ queued: jobs.length });
});
