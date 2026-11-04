import Link from "next/link";
import { prisma } from "@sm/db";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { getLocale, t } from "@/lib/i18n";
import { BrandSwitcher, LocaleToggle, LogoutButton } from "@/components/BrandSwitcher";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brand = await getActiveBrand(user);
  const brands = await prisma.brand.findMany({ where: { ownerId: user.id, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  const unread = await prisma.notification.count({ where: { readAt: null, OR: [{ brandId: { in: brands.map((b) => b.id) } }, { brandId: null }] } });
  const tr = await t();
  const locale = await getLocale();
  const items: Array<[string, string]> = [["/", tr("dashboard")], ["/posts", tr("posts")], ["/calendar", tr("calendar")], ["/media", tr("media")], ["/accounts", tr("accounts")], ["/inbox", tr("inbox")], ["/analytics", tr("analytics")], ["/ads", tr("ads")], ["/automations", tr("automations")], ["/brands", tr("brands")], ["/health", tr("health")], ["/activity", tr("activity")], ["/settings", tr("settings")]];
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Social Manager</div>
        <div className="small muted">{tr("activeBrand")}</div>
        <BrandSwitcher brands={brands} activeId={brand?.id ?? null} />
        <div style={{ height: 8 }} />
        {items.map(([href, label]) => (
          <Link key={href} href={href}>{label}{href === "/" && unread ? <span className="badge warn" style={{ marginLeft: 6 }}>{unread}</span> : null}</Link>
        ))}
        <div style={{ flex: 1 }} />
        <div className="row small muted">
          <span>{user.email}</span>
        </div>
        <div className="row">
          <LocaleToggle locale={locale} />
          <LogoutButton label={tr("logout")} />
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
