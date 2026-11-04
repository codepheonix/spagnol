import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brand = await apiBrand(user, url.searchParams.get("brandId"));
  const metric = url.searchParams.get("metric") ?? "followers";
  const from = new Date(url.searchParams.get("from") ?? Date.now() - 90 * 86_400_000);
  const rows = await prisma.analyticsMetric.findMany({ where: { brandId: brand.id, scope: "account", metric, bucketTime: { gte: from } }, orderBy: { bucketTime: "asc" }, select: { socialAccountId: true, bucketTime: true, value: true, source: true, granularity: true } });
  return json({ metric, series: rows });
});
