import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

/** Ad reporting is kept separate from organic analytics: spend, impressions, clicks, CPM/CPC/CTR as synced. */
export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  const campaigns = await prisma.adCampaign.findMany({ where: { adAccount: { brandId: brand.id } }, include: { adAccount: { select: { name: true, provider: true, currency: true } } } });
  const rows = campaigns.map((c) => {
    const m = c.metrics as Record<string, number | null | undefined>;
    return { campaignId: c.id, name: c.name, status: c.status, adAccount: c.adAccount.name, provider: c.adAccount.provider, currency: c.currency ?? c.adAccount.currency, spend: m.spend ?? null, impressions: m.impressions ?? null, reach: m.reach ?? null, clicks: m.clicks ?? null, ctr: m.ctr ?? null, cpc: m.cpc ?? null, cpm: m.cpm ?? null, conversions: m.conversions ?? null, roas: m.roas ?? null, syncedAt: c.syncedAt };
  });
  const totalSpend = rows.reduce((a, r) => a + (r.spend ?? 0), 0);
  return json({ rows, totals: { spend: rows.some((r) => r.spend !== null) ? totalSpend : null }, source: "zernio:/v1/ads/campaigns" });
});
