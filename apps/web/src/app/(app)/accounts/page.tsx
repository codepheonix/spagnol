import { prisma } from "@sm/db";
import { hasNativeAdapter, listDescriptors, nativeEnvMissing } from "@sm/integrations";
import { getZernioConfig, formatInZone } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { ConnectPanel, type Descriptor } from "@/components/ConnectPanel";
import { Action } from "@/components/Action";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const sp = await searchParams;
  const zernio = Boolean(await getZernioConfig());
  const providers: Descriptor[] = listDescriptors().map((d) => ({ id: d.id, backend: d.backend, displayName: d.displayName, connect: d.connect as Descriptor["connect"], implementationStatus: d.backend === "native" && !hasNativeAdapter(d.id) ? "NOT_IMPLEMENTED" : d.implementationStatus, missingEnv: d.backend === "native" ? nativeEnvMissing(d) : [], capabilities: d.capabilities as Record<string, string>, docsUrl: d.docsUrl }));
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id }, orderBy: [{ provider: "asc" }, { createdAt: "asc" }] });
  const capKeys = ["publish_text", "publish_image", "publish_video", "publish_carousel", "publish_story", "schedule_remote", "read_analytics", "read_comments", "reply_comment", "read_dm", "send_dm", "ads_read"];
  return (
    <div>
      <h1>Accounts — {brand.name}</h1>
      {sp.connected && <div className="msg ok">Connected {sp.connected} account(s) via {sp.provider}.</div>}
      {sp.error && <div className="msg err">Connection failed ({sp.provider}): {sp.error}</div>}
      <table><thead><tr><th>Account</th><th>Provider</th><th>Backend</th><th>Status</th><th>Health</th><th>Checked</th><th></th></tr></thead><tbody>
        {accounts.map((a) => {
          const caps = ((a.metadata as { capabilities?: Record<string, string> }).capabilities) ?? {};
          return (
            <tr key={a.id}>
              <td>{a.profileUrl ? <a href={a.profileUrl} target="_blank" rel="noreferrer">{a.displayName}</a> : a.displayName}<div className="small muted">{a.username ? "@" + a.username : a.externalAccountId}</div>
                <details><summary className="small">capabilities</summary><div className="row">{capKeys.map((k) => <span key={k} className={`badge ${caps[k] ?? "not_tested"}`}>{k}: {caps[k] ?? "?"}</span>)}</div></details></td>
              <td>{a.provider}</td><td>{a.backend}</td>
              <td><span className={`badge ${a.status}`}>{a.status}</span></td>
              <td><span className={`badge ${a.healthStatus}`}>{a.healthStatus}</span>{a.lastError && <div className="small" style={{ color: "var(--err)" }}>{a.lastError.slice(0, 160)}</div>}</td>
              <td className="small muted">{a.lastCheckedAt ? formatInZone(a.lastCheckedAt, brand.timezone) : "—"}{a.tokenExpiresAt && <div>token exp. {formatInZone(a.tokenExpiresAt, brand.timezone)}</div>}</td>
              <td className="row"><Action path={`/api/connections/${a.id}/refresh`} label="Check" />{a.status !== "disconnected" && <Action className="danger" path={`/api/connections/${a.id}`} method="DELETE" label="Disconnect" confirm={`Disconnect ${a.displayName}? Queued posts to it are canceled and local credentials deleted.`} />}</td>
            </tr>
          );
        })}
        {accounts.length === 0 && <tr><td colSpan={7} className="muted">No accounts yet.</td></tr>}
      </tbody></table>
      <ConnectPanel brandId={brand.id} providers={providers} zernioConfigured={zernio} />
      <h2>Provider catalogue (truthful status)</h2>
      <table><thead><tr><th>Provider</th><th>Backend</th><th>Implementation</th><th>Needs</th><th>Docs</th></tr></thead><tbody>
        {providers.map((p) => (<tr key={`${p.id}:${p.backend}`}><td>{p.displayName}</td><td>{p.backend}</td><td><span className={`badge ${p.implementationStatus === "LIVE_VERIFIED" ? "ok" : p.implementationStatus.startsWith("CODE_COMPLETE") ? "warn" : "err"}`}>{p.implementationStatus}</span></td><td className="small">{p.backend === "zernio" ? (zernio ? "Zernio key ✓" : "Zernio API key (Settings)") : p.missingEnv.join(", ") || "—"}</td><td>{p.docsUrl && <a href={p.docsUrl} target="_blank" rel="noreferrer" className="small">docs</a>}</td></tr>))}
      </tbody></table>
    </div>
  );
}
