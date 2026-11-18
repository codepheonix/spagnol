import Link from "next/link";
import { getSecretSetting, getSetting, appUrl, providerAppStatus } from "@sm/core";
import { requireUser } from "@/lib/auth";
import { SettingsForm } from "@/components/SettingsForm";

export default async function SettingsPage() {
  const user = await requireUser();
  const current = {
    zernioApiKey: Boolean((await getSecretSetting("zernio.apiKey")) ?? process.env.ZERNIO_API_KEY),
    zernioWebhookSecret: Boolean((await getSecretSetting("zernio.webhookSecret")) ?? process.env.ZERNIO_WEBHOOK_SECRET),
    aiApiKey: Boolean((await getSecretSetting("ai.apiKey")) ?? process.env.AI_API_KEY),
    aiModel: ((await getSetting<string>("ai.model")) ?? process.env.AI_MODEL ?? "anthropic/claude-sonnet-4.5") as string,
    locale: user.locale,
    timezone: user.timezone,
  };
  const base = appUrl();
  const apps = await providerAppStatus();
  const lastTick = await getSetting<{ at?: string; processed?: number }>("jobs.lastTick");
  return (
    <div>
      <h1>Settings</h1>
      <SettingsForm current={current} />
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Endpoints to register with providers</h3>
        <div className="scroll-x"><table><tbody>
          <tr><td>Zernio webhook URL</td><td className="mono">{base}/api/webhooks/zernio</td></tr>
          <tr><td>Meta sign-in redirect URLs</td><td className="mono">{base}/api/oauth/facebook/callback · {base}/api/oauth/instagram/callback <Link href="/accounts/setup/meta">(Meta setup)</Link></td></tr>
          <tr><td>Job tick (cron)</td><td className="mono">POST {base}/api/jobs/tick — header Authorization: Bearer $CRON_SECRET</td></tr>
        </tbody></table></div>
        <p className="small muted">Storage driver <b>{process.env.STORAGE_DRIVER ?? "local"}</b>; Meta app {apps.META_APP_ID && apps.META_APP_SECRET ? "configured" : "not configured"}; scheduler last ran {lastTick?.at ? new Date(lastTick.at).toLocaleString("it-IT", { timeZone: user.timezone }) : "never"}.</p>
      </div>
    </div>
  );
}
