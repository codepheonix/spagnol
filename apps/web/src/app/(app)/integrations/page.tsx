import Link from "next/link";
import { getAiConfig, getSetting, getZernioConfig, providerAppStatus, formatInZone } from "@sm/core";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [apps, ai, zernio, lastTick] = await Promise.all([providerAppStatus(), getAiConfig(), getZernioConfig(), getSetting<string>("jobs.lastTick")]);
  const meta = Boolean(apps.META_APP_ID && apps.META_APP_SECRET);
  const ig = Boolean(apps.INSTAGRAM_APP_ID && apps.INSTAGRAM_APP_SECRET);
  const rows: Array<{ name: string; what: string; cost: string; state: string; badge: string; href?: string; action?: string }> = [
    { name: "Meta app (Facebook + Instagram)", what: "Lets Facebook and Instagram open their sign-in page for this installation. Direct, official API.", cost: "Free", state: meta ? "Registered" : "Not registered", badge: meta ? "ok" : "warn", href: "/accounts/setup/meta", action: meta ? "Review" : "Register" },
    { name: "Instagram sign-in app", what: "Optional: sign in on Instagram directly, without a Facebook Page.", cost: "Free", state: ig ? "Registered" : "Not registered", badge: ig ? "ok" : "", href: "/accounts/setup/meta", action: "Open setup" },
    { name: "OpenRouter", what: "The AI model gateway used for drafts.", cost: "Pay per use, to OpenRouter", state: ai ? `Connected — ${ai.model}` : "No key saved", badge: ai ? "ok" : "", href: "/settings", action: ai ? "Change" : "Add key" },
    { name: "Zernio", what: "Optional managed gateway for platforms and ad accounts. Never required.", cost: "Paid subscription, billed by Zernio", state: zernio ? "Key saved" : "Off", badge: zernio ? "ok" : "", href: "/settings", action: zernio ? "Change" : "Add key" },
    { name: "Postiz", what: "Optional self-hosted publishing engine for more networks. It runs on its own server.", cost: "Free software; needs a server you pay for", state: "Connector not built yet", badge: "" },
    { name: "Scheduler", what: "Runs scheduled posts and replies every minute, with no browser open.", cost: "Included", state: lastTick ? `Last run ${formatInZone(new Date(lastTick), user.timezone)}` : "No run recorded here", badge: lastTick ? "ok" : "warn", href: "/health", action: "System health" },
  ];
  return (
    <div>
      <h1>Integrations</h1>
      <p className="lead">The services iGerald talks to, what each costs, and whether it is set up. Secrets are stored encrypted and are never shown again after saving.</p>
      <div className="scroll-x">
        <table>
          <thead><tr><th>Service</th><th>What it is for</th><th>Cost</th><th>State</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}><td><b>{r.name}</b></td><td>{r.what}</td><td className="small">{r.cost}</td><td><span className={`badge ${r.badge}`}>{r.state}</span></td><td>{r.href ? <Link className="btn small" href={r.href}>{r.action}</Link> : null}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>Connecting individual social accounts happens in <Link href="/connections">Social connections</Link>.</p>
    </div>
  );
}
