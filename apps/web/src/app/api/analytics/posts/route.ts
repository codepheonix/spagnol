import { metricsToCsv, postAnalytics } from "@sm/core";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const url = new URL(req.url);
  const brand = await apiBrand(user, url.searchParams.get("brandId"));
  const from = new Date(url.searchParams.get("from") ?? Date.now() - 30 * 86_400_000);
  const to = new Date(url.searchParams.get("to") ?? Date.now());
  const rows = await postAnalytics(brand.id, { from, to, socialAccountId: url.searchParams.get("socialAccountId") ?? undefined });
  if (url.searchParams.get("format") === "csv") return new Response(metricsToCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="post-analytics-${brand.slug}.csv"` } });
  return json({ from, to, rows });
});
