import { analyticsOverview, postAnalytics, formatInZone } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { Action } from "@/components/Action";

const ACCOUNT_METRICS = ["followers", "followers_growth", "reach", "profile_views", "engagements", "posts"];
const POST_METRICS = ["impressions", "reach", "likes", "comments", "shares", "saves", "views", "clicks", "reposts", "replies", "engagementRate"];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const sp = await searchParams;
  const days = Number(sp.days ?? 30);
  const from = new Date(Date.now() - days * 86_400_000);
  const [overview, posts] = await Promise.all([analyticsOverview(brand.id), postAnalytics(brand.id, { from, to: new Date() })]);
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? <span className="muted">—</span> : Number.isInteger(v) ? v.toLocaleString("it-IT") : v.toFixed(3));
  return (
    <div>
      <h1>Analytics — {brand.name}</h1>
      <p className="small muted">Every number is traced to a provider response (hover the source). A dash means the network does not expose that metric — it is never shown as zero.</p>
      <div className="row"><Action path={`/api/analytics/sync?brandId=${brand.id}`} label="Sync now" /><a href={`/api/analytics/posts?brandId=${brand.id}&from=${from.toISOString()}&format=csv`} className="btn">Export CSV</a><span className="small">Range: {[7, 30, 90].map((d) => <a key={d} href={`/analytics?days=${d}`} style={{ marginLeft: 6, fontWeight: d === days ? 700 : 400 }}>{d}d</a>)}</span></div>
      <h2>Accounts</h2>
      <table><thead><tr><th>Account</th>{ACCOUNT_METRICS.map((m) => <th key={m}>{m}</th>)}<th>Fetched</th></tr></thead><tbody>
        {overview.map((r) => { const first = Object.values(r.metrics)[0]; return <tr key={r.socialAccountId}><td>{r.displayName}<div className="small muted">{r.provider}</div></td>{ACCOUNT_METRICS.map((m) => <td key={m} title={r.metrics[m]?.source}>{fmt(r.metrics[m]?.value)}</td>)}<td className="small muted">{first ? formatInZone(first.fetchedAt, brand.timezone) : "never"}</td></tr>; })}
        {overview.length === 0 && <tr><td colSpan={8} className="muted">No accounts.</td></tr>}
      </tbody></table>
      <h2>Posts (last {days} days)</h2>
      <table><thead><tr><th>Published</th><th>Account</th><th>Post</th>{POST_METRICS.map((m) => <th key={m}>{m}</th>)}<th>Eng. rate</th></tr></thead><tbody>
        {posts.map((p) => <tr key={p.targetId}><td className="small muted">{p.publishedAt ? formatInZone(p.publishedAt, brand.timezone) : ""}</td><td className="small">{p.account.displayName}</td><td className="small">{p.remoteUrl ? <a href={p.remoteUrl} target="_blank" rel="noreferrer">{p.excerpt}</a> : p.excerpt}</td>{POST_METRICS.map((m) => <td key={m} title={p.metrics[m]?.source}>{fmt(p.metrics[m]?.value)}</td>)}<td>{p.engagementRate ? `${(p.engagementRate.value * 100).toFixed(2)}% of ${p.engagementRate.denominator}` : <span className="muted">—</span>}</td></tr>)}
        {posts.length === 0 && <tr><td colSpan={15} className="muted">No published posts in range.</td></tr>}
      </tbody></table>
    </div>
  );
}
