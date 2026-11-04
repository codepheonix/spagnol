import { prisma } from "@sm/db";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { getLocale, t } from "@/lib/i18n";
import { BrandSwitcher, LocaleToggle, LogoutButton } from "@/components/BrandSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NavLink } from "@/components/NavLink";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brand = await getActiveBrand(user);
  const brands = await prisma.brand.findMany({ where: { ownerId: user.id, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  const unread = await prisma.notification.count({ where: { readAt: null, OR: [{ brandId: { in: brands.map((b) => b.id) } }, { brandId: null }] } });
  const tr = await t();
  const locale = await getLocale();
  const work: Array<[string, string]> = [["/", tr("dashboard")], ["/posts", tr("posts")], ["/calendar", tr("calendar")], ["/media", tr("media")], ["/inbox", tr("inbox")], ["/analytics", tr("analytics")], ["/ads", tr("ads")], ["/automations", tr("automations")]];
  const manage: Array<[string, string]> = [["/accounts", tr("accounts")], ["/brands", tr("brands")], ["/health", tr("health")], ["/activity", tr("activity")], ["/settings", tr("settings")]];
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand"><span className="mark" aria-hidden />Social Manager</div>
        <div className="section">{tr("activeBrand")}</div>
        <BrandSwitcher brands={brands} activeId={brand?.id ?? null} />
        <div className="section">{locale === "it" ? "Lavoro" : "Work"}</div>
        {work.map(([href, label]) => <NavLink key={href} href={href} label={label} badge={href === "/" ? unread : undefined} />)}
        <div className="section">{locale === "it" ? "Gestione" : "Manage"}</div>
        {manage.map(([href, label]) => <NavLink key={href} href={href} label={label} />)}
        <div className="foot">
          <div className="who" title={user.email}>{user.email}</div>
          <div className="row">
            <ThemeToggle labels={{ dark: locale === "it" ? "Scuro" : "Dark", light: locale === "it" ? "Chiaro" : "Light" }} />
            <LocaleToggle locale={locale} />
            <LogoutButton label={tr("logout")} />
          </div>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
