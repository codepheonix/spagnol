import { getSecretSetting, getSetting, appUrl } from "@sm/core";
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
  return (
    <div>
      <h1>Settings</h1>
      <SettingsForm current={current} />
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Endpoints to register with providers</h3>
        <table><tbody>
          <tr><td>Zernio webhook URL</td><td className="mono">{base}/api/webhooks/zernio</td></tr>
          <tr><td>OAuth redirect (native Meta)</td><td className="mono">{base}/api/oauth/facebook/callback · {base}/api/oauth/instagram/callback</td></tr>
          <tr><td>Job tick (cron)</td><td className="mono">POST {base}/api/jobs/tick — header Authorization: Bearer $CRON_SECRET</td></tr>
        </tbody></table>
        <p className="small muted">Environment: storage driver <b>{process.env.STORAGE_DRIVER ?? "local"}</b>; native Meta app {process.env.META_APP_ID ? "configured" : "not configured"}; Zernio env key {process.env.ZERNIO_API_KEY ? "present" : "absent"}.</p>
      </div>
    </div>
  );
}
