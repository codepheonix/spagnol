import { prisma } from "@sm/db";
import { requireUser } from "@/lib/auth";
import { BrandForm } from "@/components/BrandForm";
import { Action } from "@/components/Action";

export default async function BrandsPage() {
  const user = await requireUser();
  const brands = await prisma.brand.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { socialAccounts: true, posts: true, mediaAssets: true } } } });
  return (
    <div>
      <h1>Brands</h1>
      <p className="muted small">Each brand has its own accounts, media, posts, inbox, analytics and ad accounts. Data never crosses brands.</p>
      <table><thead><tr><th>Name</th><th>Slug</th><th>Timezone</th><th>Accounts</th><th>Posts</th><th>Media</th><th></th></tr></thead><tbody>
        {brands.map((b) => (<tr key={b.id} style={{ opacity: b.archivedAt ? 0.5 : 1 }}><td>{b.name}{b.archivedAt ? " (archived)" : ""}</td><td className="mono">{b.slug}</td><td>{b.timezone}</td><td>{b._count.socialAccounts}</td><td>{b._count.posts}</td><td>{b._count.mediaAssets}</td><td className="row"><Action path={`/api/brands/${b.id}/select`} label="Use" />{b.archivedAt ? <Action path={`/api/brands/${b.id}`} method="PATCH" json={{ archived: false }} label="Restore" /> : <Action path={`/api/brands/${b.id}`} method="PATCH" json={{ archived: true }} label="Archive" confirm="Archive this brand? Its data is kept." />}</td></tr>))}
      </tbody></table>
      <BrandForm />
    </div>
  );
}
