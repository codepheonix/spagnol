import Link from "next/link";
import { prisma } from "@sm/db";
import { listDescriptors } from "@sm/integrations";
import { getZernioConfig, formatInZone, providerAppStatus, missingScopes } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { Action } from "@/components/Action";
import { ConnectButton, CredentialsConnect } from "@/components/Connections";
import { CONNECTION_LABEL, PROVIDER_NAME } from "@/lib/labels";

type Field = { name: string; label: string; secret?: boolean; placeholder?: string; help?: string };

/** What each platform row offers. `planned` rows say so plainly instead of showing a dead button. */
const CATALOG: Array<{ id: string; name: string; tags: string[]; planned?: string }> = [
  { id: "facebook", name: "Facebook Page", tags: ["Posting", "Comments", "Analytics"] },
  { id: "instagram", name: "Instagram", tags: ["Posting", "Comments", "Analytics"] },
  { id: "meta_ads", name: "Meta Ads", tags: ["Ads"], planned: "Next step, after posting is verified with real accounts. Not built yet." },
  { id: "tiktok", name: "TikTok", tags: ["Posting"], planned: "Not built yet. Starts as: prepare video + caption for manual posting." },
  { id: "telegram", name: "Telegram", tags: ["Posting"] },
  { id: "bluesky", name: "Bluesky", tags: ["Posting"] },
  { id: "discord", name: "Discord", tags: ["Posting"] },
  { id: "slack", name: "Slack", tags: ["Posting"] },
  { id: "threads", name: "Threads", tags: ["Posting"], planned: "Not built yet." },
  { id: "youtube", name: "YouTube", tags: ["Posting"], planned: "Not built yet." },
  { id: "linkedin", name: "LinkedIn", tags: ["Posting"], planned: "Not built yet." },
  { id: "pinterest", name: "Pinterest", tags: ["Posting"], planned: "Not built yet." },
  { id: "googlebusiness", name: "Google Business", tags: ["Posting", "Reviews"], planned: "Not built yet." },
  { id: "x", name: "X (Twitter)", tags: ["Posting"], planned: "Not built yet." },
];

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const sp = await searchParams;
  const zernio = Boolean(await getZernioConfig());
  const apps = await providerAppStatus();
  const metaReady = apps.META_APP_ID && apps.META_APP_SECRET;
  const igLoginReady = apps.INSTAGRAM_APP_ID && apps.INSTAGRAM_APP_SECRET;
  const descriptors = listDescriptors();
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id }, orderBy: [{ status: "asc" }, { provider: "asc" }, { createdAt: "asc" }] });
  const live = accounts.filter((a) => a.status !== "disconnected");
  const setupHref = "/accounts/setup/meta";
  const capKeys = ["publish_image", "publish_video", "publish_carousel", "publish_story", "read_comments", "reply_comment", "read_analytics", "read_dm", "ads_read"];

  return (
    <div>
      <h1>Connections — {brand.name}</h1>
      <p className="muted" style={{ marginTop: -6 }}>Accounts connected here belong to <b>{brand.name}</b> only. Switch brand in the sidebar to connect another brand&apos;s accounts.</p>
      {sp.connected && <div className="msg ok">Connected {sp.connected} account{sp.connected === "1" ? "" : "s"} to {brand.name}.</div>}
      {sp.reconnected && <div className="msg ok">Permission renewed. Scheduled posts and history for this account are kept.</div>}
      {sp.error && <div className="msg err">Connection not completed{sp.provider ? ` (${PROVIDER_NAME[sp.provider] ?? sp.provider})` : ""}: {sp.error}</div>}
      {!metaReady && (
        <div className="msg info">
          <b>One step before Facebook and Instagram can open their sign-in page:</b> this app has to be registered with Meta once (free, about 10 minutes). After that, every brand connects with a normal Facebook sign-in. <Link href={setupHref}><b>Open the Meta setup →</b></Link>
        </div>
      )}

      <h2>Connected accounts</h2>
      <table>
        <thead><tr><th>Account</th><th>Platform</th><th>Status</th><th>Last check</th><th></th></tr></thead>
        <tbody>
          {accounts.map((a) => {
            const md = (a.metadata ?? {}) as { capabilities?: Record<string, string>; loginMethod?: string; pageName?: string };
            const caps = md.capabilities ?? {};
            const missing = a.status === "connected" ? missingScopes(a) : [];
            const oauthNative = a.backend === "native" && (a.provider === "facebook" || a.provider === "instagram");
            return (
              <tr key={a.id} style={a.status === "disconnected" ? { opacity: 0.6 } : undefined}>
                <td>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {a.avatarUrl && <img src={a.avatarUrl} alt="" width={32} height={32} style={{ borderRadius: 999 }} referrerPolicy="no-referrer" />}
                    <div>
                      {a.profileUrl ? <a href={a.profileUrl} target="_blank" rel="noreferrer"><b>{a.displayName}</b></a> : <b>{a.displayName}</b>}
                      <div className="small muted">{a.username ? "@" + a.username : `ID ${a.externalAccountId}`}{md.pageName ? ` · via Page “${md.pageName}”` : ""}</div>
                    </div>
                  </div>
                  {missing.length > 0 && <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>Not granted at sign-in: <span className="mono">{missing.join(", ")}</span>. Publishing may be refused — press Reconnect and allow everything Meta lists.</div>}
                  {a.status !== "disconnected" && <details><summary className="small">What this connection can do</summary><div className="row" style={{ marginTop: 4 }}>{capKeys.map((k) => <span key={k} className={`badge ${caps[k] ?? "not_tested"}`}>{k.replace(/_/g, " ")}: {(caps[k] ?? "not checked yet").replace(/_/g, " ")}</span>)}</div></details>}
                </td>
                <td>{PROVIDER_NAME[a.provider] ?? a.provider}<div className="small muted">{a.backend === "zernio" ? "via Zernio" : md.loginMethod === "instagram_login" ? "Instagram login" : md.loginMethod === "facebook_login" ? "Facebook login" : "direct"}</div></td>
                <td>
                  <span className={`badge ${a.status}`}>{CONNECTION_LABEL[a.status] ?? a.status}</span>
                  {a.lastError && a.status !== "disconnected" && <div className="small" style={{ color: "var(--err)", maxWidth: 320 }}>{a.lastError.slice(0, 200)}</div>}
                </td>
                <td className="small muted">{a.lastCheckedAt ? formatInZone(a.lastCheckedAt, brand.timezone) : "—"}{a.tokenExpiresAt && <div>permission renews before {formatInZone(a.tokenExpiresAt, brand.timezone)}</div>}</td>
                <td>
                  <div className="row">
                    {oauthNative && <ConnectButton brandId={brand.id} provider={a.provider} reconnectAccountId={a.id} label={a.status === "disconnected" ? "Connect again" : "Reconnect"} className={a.status === "needs_reconnect" ? "primary small" : "small"} setupHref={setupHref} />}
                    {a.status !== "disconnected" && <Action className="small" path={`/api/connections/${a.id}/refresh`} label="Check now" />}
                    {a.status !== "disconnected" && <Action className="danger small" path={`/api/connections/${a.id}`} method="DELETE" label="Disconnect" confirm={`Disconnect ${a.displayName} from ${brand.name}? Posts still scheduled for it are canceled and the saved permission is deleted.`} />}
                  </div>
                </td>
              </tr>
            );
          })}
          {accounts.length === 0 && <tr><td colSpan={5} className="muted">Nothing connected to {brand.name} yet. Pick a platform below.</td></tr>}
        </tbody>
      </table>

      <h2>Connect a platform</h2>
      <table>
        <thead><tr><th>Platform</th><th>What it covers</th><th>For {brand.name}</th><th style={{ textAlign: "right" }}>Connect</th></tr></thead>
        <tbody>
          {CATALOG.map((c) => {
            const native = descriptors.find((d) => d.id === c.id && d.backend === "native");
            const viaZernio = zernio && descriptors.some((d) => d.id === c.id && d.backend === "zernio");
            const mine = live.filter((a) => a.provider === c.id);
            return (
              <tr key={c.id}>
                <td><b>{c.name}</b></td>
                <td><div className="row">{c.tags.map((t) => <span key={t} className="badge">{t}</span>)}</div></td>
                <td className="small">{mine.length ? mine.map((a) => a.displayName).join(", ") : <span className="muted">—</span>}</td>
                <td style={{ textAlign: "right" }}>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    {c.planned && <span className="small muted" style={{ maxWidth: 320, textAlign: "right" }}>{c.planned}</span>}
                    {c.id === "facebook" && (metaReady ? <ConnectButton brandId={brand.id} provider="facebook" label="Connect with Facebook" setupHref={setupHref} /> : <Link href={setupHref} className="btn small">Set up, then connect</Link>)}
                    {c.id === "instagram" && (
                      <>
                        {metaReady ? <ConnectButton brandId={brand.id} provider="instagram" loginMethod="facebook_login" label="Connect with Facebook login" setupHref={setupHref} /> : <Link href={setupHref} className="btn small">Set up, then connect</Link>}
                        {igLoginReady ? <ConnectButton brandId={brand.id} provider="instagram" loginMethod="instagram_login" label="Instagram login" className="small" setupHref={setupHref} /> : null}
                      </>
                    )}
                    {!c.planned && native?.connect.kind === "credentials" && <CredentialsConnect brandId={brand.id} provider={c.id} fields={(native.connect.fields ?? []) as Field[]} notes={native.connect.notes} />}
                    {viaZernio && <ConnectButton brandId={brand.id} provider={c.id} backend="zernio" label="via Zernio" className="ghost small" />}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">
        Instagram: “Connect with Facebook login” is for an Instagram professional account linked to a Facebook Page — one sign-in can connect the Page and its Instagram account together.
        {igLoginReady ? " “Instagram login” signs in on Instagram directly, no Page needed." : " Signing in on Instagram directly (no Page) needs a second Meta app — see the optional settings in the Meta setup."}
        {" "}Nothing here is marked live-verified until a real post has been published and checked on the real account.
      </p>
    </div>
  );
}
