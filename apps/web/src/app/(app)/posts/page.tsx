import Link from "next/link";
import { prisma, type PostStatus } from "@sm/db";
import { formatInZone } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { BulkImport } from "@/components/BulkImport";

export default async function PostsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const sp = await searchParams;
  const status = sp.status as PostStatus | undefined;
  const posts = await prisma.post.findMany({ where: { brandId: brand.id, status }, orderBy: { updatedAt: "desc" }, take: 100, include: { targets: { include: { socialAccount: { select: { provider: true, displayName: true } } } } } });
  const statuses: PostStatus[] = ["draft", "validated", "scheduled", "publishing", "published", "partial", "failed", "canceled"];
  return (
    <div>
      <h1>Posts — {brand.name}</h1>
      <div className="row"><Link href="/posts/new" className="btn">+ New post</Link><Link href="/posts">all</Link>{statuses.map((s) => <Link key={s} href={`/posts?status=${s}`} className="small">{s}</Link>)}</div>
      <table><thead><tr><th>Status</th><th>Post</th><th>When ({brand.timezone})</th><th>Targets</th></tr></thead><tbody>
        {posts.map((p) => (<tr key={p.id}><td><span className={`badge ${p.status}`}>{p.status}</span></td><td><Link href={`/posts/${p.id}`}>{(p.title ?? p.body).slice(0, 80) || "(no text)"}</Link></td><td className="small">{p.scheduledAt ? formatInZone(p.scheduledAt, p.scheduleTimezone ?? brand.timezone) : p.publishedAt ? formatInZone(p.publishedAt, brand.timezone) : "—"}</td><td>{p.targets.map((t) => <span key={t.id} className={`badge ${t.status}`} style={{ marginRight: 4 }}>{t.socialAccount.provider}: {t.status}</span>)}</td></tr>))}
        {posts.length === 0 && <tr><td colSpan={4} className="muted">No posts.</td></tr>}
      </tbody></table>
      <BulkImport brandId={brand.id} timezone={brand.timezone} />
    </div>
  );
}
