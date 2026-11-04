import { prisma } from "@sm/db";
import type { MetricResult } from "@sm/integrations";
import { adapterFor, buildAccountContext } from "./connections";

export async function syncAccountAnalytics(socialAccountId: string, days = 30): Promise<{ stored: number; unsupported?: boolean }> {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId } });
  if (account.status !== "connected") return { stored: 0 };
  const adapter = adapterFor(account);
  if (!adapter.fetchMetrics) return { stored: 0, unsupported: true };
  const ctx = await buildAccountContext(account);
  const metrics = await adapter.fetchMetrics(ctx, { from: new Date(Date.now() - days * 86_400_000), to: new Date() });
  return { stored: await storeMetrics(account.brandId, account.id, account.provider, metrics) };
}

export async function storeMetrics(brandId: string, socialAccountId: string, provider: string, metrics: MetricResult[]): Promise<number> {
  let n = 0;
  for (const m of metrics) {
    const bucketTime = m.granularity === "lifetime" ? new Date(Math.floor(m.bucketTime.getTime() / 3_600_000) * 3_600_000) : m.bucketTime; // hourly buckets for lifetime snapshots
    await prisma.analyticsMetric.upsert({
      where: { socialAccountId_scope_subjectId_metric_granularity_bucketTime_breakdown: { socialAccountId, scope: m.scope, subjectId: m.subjectId, metric: m.metric, granularity: m.granularity, bucketTime, breakdown: m.breakdown ?? "" } },
      create: { brandId, socialAccountId, provider, scope: m.scope, subjectId: m.subjectId, metric: m.metric, granularity: m.granularity, bucketTime, breakdown: m.breakdown ?? "", value: m.value, source: m.source, providerUpdatedAt: m.providerUpdatedAt ?? null },
      update: { value: m.value, source: m.source, fetchedAt: new Date(), providerUpdatedAt: m.providerUpdatedAt ?? null },
    });
    n++;
  }
  return n;
}

export interface OverviewRow {
  socialAccountId: string;
  provider: string;
  displayName: string;
  metrics: Record<string, { value: number | null; fetchedAt: Date; source: string }>;
}

/** Latest lifetime account metrics per connected account; absent metric = unsupported (never 0). */
export async function analyticsOverview(brandId: string): Promise<OverviewRow[]> {
  const accounts = await prisma.socialAccount.findMany({ where: { brandId, status: { not: "disconnected" } } });
  const rows: OverviewRow[] = [];
  for (const a of accounts) {
    const latest = await prisma.analyticsMetric.findMany({ where: { socialAccountId: a.id, scope: "account" }, orderBy: { fetchedAt: "desc" }, take: 200 });
    const metrics: OverviewRow["metrics"] = {};
    for (const m of latest) if (!metrics[m.metric]) metrics[m.metric] = { value: m.value, fetchedAt: m.fetchedAt, source: m.source };
    rows.push({ socialAccountId: a.id, provider: a.provider, displayName: a.displayName, metrics });
  }
  return rows;
}

export async function postAnalytics(brandId: string, opts: { from: Date; to: Date; socialAccountId?: string }) {
  const targets = await prisma.postTarget.findMany({ where: { status: "published", post: { brandId }, socialAccountId: opts.socialAccountId, publishedAt: { gte: opts.from, lte: opts.to } }, include: { post: { select: { id: true, body: true, title: true } }, socialAccount: { select: { displayName: true, provider: true, id: true } } }, orderBy: { publishedAt: "desc" } });
  const out = [];
  for (const t of targets) {
    const subjectIds = [t.remotePostId ?? ""];
    const att = await prisma.publishAttempt.findFirst({ where: { postTargetId: t.id, remotePostId: { not: null } }, orderBy: { startedAt: "desc" } });
    const platformPostId = (att?.responseSummary as { raw?: { platformPostId?: string } } | null)?.raw?.platformPostId;
    if (platformPostId) subjectIds.push(platformPostId);
    const rows = await prisma.analyticsMetric.findMany({ where: { socialAccountId: t.socialAccountId, scope: "post", subjectId: { in: subjectIds } }, orderBy: { fetchedAt: "desc" } });
    const metrics: Record<string, { value: number | null; fetchedAt: Date; source: string }> = {};
    for (const m of rows) if (!metrics[m.metric]) metrics[m.metric] = { value: m.value, fetchedAt: m.fetchedAt, source: m.source };
    const impressions = metrics.impressions?.value ?? metrics.reach?.value ?? null;
    const engagements = ["likes", "comments", "shares", "saves", "reposts", "replies"].map((k) => metrics[k]?.value).filter((v): v is number => typeof v === "number");
    const engagementTotal = engagements.length ? engagements.reduce((a, b) => a + b, 0) : null;
    out.push({ postId: t.post.id, targetId: t.id, account: t.socialAccount, publishedAt: t.publishedAt, remoteUrl: t.remoteUrl, excerpt: (t.post.title ?? t.post.body).slice(0, 80), metrics, engagementTotal, engagementRate: impressions && engagementTotal !== null ? { value: engagementTotal / impressions, denominator: metrics.impressions ? "impressions" : "reach" } : null });
  }
  return out;
}

export function metricsToCsv(rows: Array<{ postId: string; account: { displayName: string; provider: string }; publishedAt: Date | null; remoteUrl: string | null; excerpt: string; metrics: Record<string, { value: number | null }> }>): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.metrics)))].sort();
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["post_id", "account", "provider", "published_at", "url", "excerpt", ...keys].map(esc).join(",");
  const body = rows.map((r) => [r.postId, r.account.displayName, r.account.provider, r.publishedAt?.toISOString() ?? "", r.remoteUrl ?? "", r.excerpt, ...keys.map((k) => (r.metrics[k]?.value ?? "") as string | number)].map(esc).join(","));
  return [head, ...body].join("\n");
}
