import Link from "next/link";
import { prisma } from "@sm/db";
import { getAiConfig } from "@sm/core";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { BrandSwitcher, LocaleToggle, LogoutButton } from "@/components/BrandSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NavLink, NavScrim, NavToggle } from "@/components/NavLink";
import { Wordmark } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brand = await getActiveBrand(user);
  const brands = await prisma.brand.findMany({ where: { ownerId: user.id, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, kind: true } });
  const unread = await prisma.notification.count({ where: { readAt: null, OR: [{ brandId: { in: brands.map((b) => b.id) } }, { brandId: null }] } });
  const ai = await getAiConfig();
  const locale = await getLocale();
  const L = (en: string, it: string) => (locale === "it" ? it : en);
  const groups: Array<[string, Array<[string, string]>]> = [
    [L("Accounts", "Account"), [["/", L("Overview", "Panoramica")], ["/organizations", L("Organizations", "Organizzazioni")], ["/accounts", L("All accounts", "Tutti gli account")], ["/connections", L("Social connections", "Collegamenti social")]]],
    [L("Create", "Crea"), [["/ai", L("AI command center", "Centro AI")], ["/posts", L("Content studio", "Contenuti")], ["/media", L("Media library", "Libreria media")], ["/calendar", L("Publishing calendar", "Calendario")]]],
    [L("Respond and grow", "Rispondi e cresci"), [["/inbox", L("Unified inbox", "Messaggi")], ["/ads", L("Ads manager", "Inserzioni")], ["/analytics", L("Analytics", "Statistiche")], ["/automations", L("Automation flows", "Automazioni")]]],
    [L("System", "Sistema"), [["/architecture", L("Workflow diagrams", "Diagrammi di flusso")], ["/health", L("System health", "Stato del sistema")], ["/integrations", L("Integrations", "Integrazioni")], ["/activity", L("Activity", "Attività")], ["/settings", L("Settings", "Impostazioni")]]],
  ];
  return (
    <div className="shell">
      <nav className="nav" aria-label={L("Main", "Principale")}>
        <Wordmark href="/" />
        {groups.map(([title, items]) => (
          <div key={title} style={{ display: "contents" }}>
            <div className="section">{title}</div>
            {items.map(([href, label]) => <NavLink key={href} href={href} label={label} badge={href === "/" ? unread : undefined} />)}
          </div>
        ))}
      </nav>
      <NavScrim label={L("Close the menu", "Chiudi il menu")} />
      <div className="col">
        <header className="topbar">
          <NavToggle label={L("Show or hide the menu", "Mostra o nascondi il menu")} />
          <BrandSwitcher brands={brands} activeId={brand?.id ?? null} />
          <form className="search" action="/accounts" role="search">
            <label className="sr-only" htmlFor="q">{L("Search accounts", "Cerca account")}</label>
            <input id="q" name="q" type="search" placeholder={L("Search accounts", "Cerca account")} />
          </form>
          <span className="spacer" />
          <Link className="chip hide-s" href="/ai" title={ai ? L("AI is configured", "AI configurata") : L("AI is not configured", "AI non configurata")}>
            <span className={`dot ${ai ? "on" : ""}`} />
            {ai ? ai.model : L("AI not set up", "AI da configurare")}
          </Link>
          <Link className="chip" href="/#notifications" aria-label={L(`${unread} unread notifications`, `${unread} notifiche non lette`)}>
            <span className={`dot ${unread ? "alert" : ""}`} />
            {unread}
          </Link>
          <details className="menu">
            <summary className="chip" title={user.email}>{(user.name || user.email).slice(0, 18)}</summary>
            <div className="pop">
              <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
              <ThemeToggle labels={{ dark: L("Dark", "Scuro"), light: L("Light", "Chiaro") }} />
              <div className="row">
                <LocaleToggle locale={locale} />
                <Link className="btn small" href="/settings">{L("Settings", "Impostazioni")}</Link>
                <LogoutButton label={L("Sign out", "Esci")} />
              </div>
            </div>
          </details>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
