import Link from "next/link";
import { listAllAccounts, listWorkspaces, summarizeAccounts, isWorkspaceKind, formatInZone, type AccountFilters } from "@sm/core";
import { requireUser } from "@/lib/auth";
import { Action } from "@/components/Action";
import { ConnectButton } from "@/components/Connections";
import { PlatformMedal } from "@/components/PlatformMedal";
import { PLATFORMS, platformById } from "@/lib/platforms";
import { CONNECTION_LABEL, PROVIDER_NAME } from "@/lib/labels";

export const metadata = { title: "All accounts" };

const KIND: Record<string, string> = { personal: "Personal", business: "Company", client: "Client company" };
const yesNo = (v: boolean | null) => (v === null ? "Not checked yet" : v ? "Available" : "Not available");

export default async function AllAccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const workspaces = await listWorkspaces(user.id);
  const filters: AccountFilters = {
    workspaceId: sp.workspace || undefined,
    kind: isWorkspaceKind(sp.kind) ? sp.kind : undefined,
    provider: sp.provider || undefined,
    status: sp.status === "connected" || sp.status === "needs_reconnect" || sp.status === "error" ? sp.status : undefined,
    automation: sp.automation === "on" || sp.automation === "off" ? sp.automation : undefined,
    ads: sp.ads === "yes" || sp.ads === "no" ? sp.ads : undefined,
  };
  const everything = await listAllAccounts(user.id);
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = (await listAllAccounts(user.id, filters)).filter((r) => !q || `${r.displayName} ${r.username ?? ""} ${r.workspaceName} ${r.provider}`.toLowerCase().includes(q));
  const s = summarizeAccounts(everything);
  const filtered = Boolean(q || Object.values(filters).some(Boolean));
  const tz = user.timezone;

  return (
    <div>
      <div className="head">
        <div>
          <h1>All accounts</h1>
          <p className="lead">Every social account you are authorised to manage, across your own workspaces and your clients&apos;.</p>
        </div>
        <div className="row">
          <Link className="btn" href="/organizations?add=1">+ Add company</Link>
          <Link className="btn primary" href="/connections">+ Connect social account</Link>
        </div>
      </div>

      <div className="grid">
        <div className="card"><div className="kpi">{s.total}</div><div className="kpi-label">social accounts</div></div>
        <div className="card"><div className="kpi">{workspaces.filter((w) => w.kind !== "personal").length}</div><div className="kpi-label">companies</div></div>
        <div className="card"><div className="kpi">{s.personal}</div><div className="kpi-label">in personal workspaces</div></div>
        <div className="card"><div className="kpi">{s.business}</div><div className="kpi-label">in company workspaces</div></div>
        <div className="card"><div className="kpi" style={{ color: s.needReconnect ? "var(--warn)" : undefined }}>{s.needReconnect}</div><div className="kpi-label">need reconnecting</div></div>
        <div className="card"><div className="kpi">{s.withAutomation}</div><div className="kpi-label">with automation on</div></div>
        <div className="card"><div className="kpi">{s.adsEligible}</div><div className="kpi-label">with an ad account</div></div>
        <div className="card"><div className="kpi" style={{ color: s.withPublishErrors ? "var(--err)" : undefined }}>{s.withPublishErrors}</div><div className="kpi-label">with publishing errors</div></div>
      </div>

      <form className="filters" method="get" action="/accounts">
        <div><label htmlFor="f-q">Search</label><input id="f-q" type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Name or username" /></div>
        <div><label htmlFor="f-ws">Workspace</label><select id="f-ws" name="workspace" defaultValue={sp.workspace ?? ""}><option value="">All workspaces</option>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
        <div><label htmlFor="f-kind">Workspace type</label><select id="f-kind" name="kind" defaultValue={sp.kind ?? ""}><option value="">Any type</option><option value="personal">Personal</option><option value="business">Company</option><option value="client">Client company</option></select></div>
        <div><label htmlFor="f-pl">Platform</label><select id="f-pl" name="provider" defaultValue={sp.provider ?? ""}><option value="">All platforms</option>{PLATFORMS.filter((p) => p.built).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div><label htmlFor="f-st">Connection</label><select id="f-st" name="status" defaultValue={sp.status ?? ""}><option value="">Any status</option><option value="connected">Connected</option><option value="needs_reconnect">Reconnect needed</option><option value="error">Problem</option></select></div>
        <div><label htmlFor="f-au">Automation</label><select id="f-au" name="automation" defaultValue={sp.automation ?? ""}><option value="">Any</option><option value="on">On</option><option value="off">Off</option></select></div>
        <div><label htmlFor="f-ad">Ad account</label><select id="f-ad" name="ads" defaultValue={sp.ads ?? ""}><option value="">Any</option><option value="yes">Has one</option><option value="no">None</option></select></div>
        <div className="row" style={{ flex: "0 0 auto" }}><button type="submit">Apply filters</button>{filtered && <Link className="btn ghost" href="/accounts">Clear</Link>}</div>
      </form>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>{everything.length === 0 ? "No accounts connected yet" : "No account matches these filters"}</h3>
          <p>{everything.length === 0 ? "Connect a Facebook Page, an Instagram account or another platform and it appears here with its status, what it can do and its recent activity." : "Change or clear the filters to see the rest."}</p>
          {everything.length === 0 ? <Link className="btn primary" href="/connections">Connect social account</Link> : <Link className="btn" href="/accounts">Clear filters</Link>}
        </div>
      ) : (
        <div className="agrid">
          {rows.map((a) => {
            const select = `/api/brands/${a.workspaceId}/select`;
            const oauth = a.backend === "native" && (a.provider === "facebook" || a.provider === "instagram");
            return (
              <article key={a.id} className="card acard">
                <div className="who">
                  <PlatformMedal id={a.provider} size="sm" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.avatarUrl ? <img className="avatar" src={a.avatarUrl} alt="" referrerPolicy="no-referrer" /> : null}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="name">{a.displayName}</div>
                    <div className="small muted">{a.username ? "@" + a.username + " · " : ""}{platformById(a.provider)?.name ?? PROVIDER_NAME[a.provider] ?? a.provider}{a.backend === "zernio" ? " via Zernio" : ""}</div>
                  </div>
                  <span className={`badge ${a.status}`}>{CONNECTION_LABEL[a.status] ?? a.status}</span>
                </div>
                {a.lastError && a.status !== "connected" && <div className="small" style={{ color: "var(--err)" }}>{a.lastError.slice(0, 220)}</div>}
                <dl>
                  <div><dt>Workspace</dt><dd>{a.workspaceName}</dd></div>
                  <div><dt>Workspace type</dt><dd>{KIND[a.workspaceKind]}</dd></div>
                  <div><dt>Account type</dt><dd>{a.accountType ?? "—"}</dd></div>
                  <div><dt>Followers</dt><dd>{a.followers === null ? "—" : Math.round(a.followers).toLocaleString("en")}</dd></div>
                  <div><dt>Publishing</dt><dd>{a.publishErrors > 0 ? <span style={{ color: "var(--err)" }}>{a.publishErrors} failed</span> : yesNo(a.canPublish)}</dd></div>
                  <div><dt>Messaging</dt><dd>{yesNo(a.canMessage)}</dd></div>
                  <div><dt>Automation</dt><dd>{a.activeAutomations > 0 ? `${a.activeAutomations} on` : "Off"}</dd></div>
                  <div><dt>Advertising</dt><dd>{a.adsEligible ? "Ad account linked" : "No ad account"}</dd></div>
                  <div><dt>Last activity</dt><dd>{a.lastActivityAt ? formatInZone(a.lastActivityAt, tz) : "—"}</dd></div>
                </dl>
                <div className="acts">
                  {a.profileUrl && <a className="btn small" href={a.profileUrl} target="_blank" rel="noreferrer">Open account</a>}
                  <Action className="small" path={select} label="Manage content" redirect="/posts" />
                  <Action className="small" path={select} label="Open calendar" redirect="/calendar" />
                  <Action className="small" path={select} label="Manage automation" redirect="/automations" />
                  <Action className="small" path={select} label="View inbox" redirect="/inbox" />
                  <Action className="small" path={select} label="View analytics" redirect="/analytics" />
                  <Action className="small" path={select} label="Manage ads" redirect="/ads" />
                  {oauth ? <ConnectButton brandId={a.workspaceId} provider={a.provider} reconnectAccountId={a.id} label="Reconnect" className={a.status === "needs_reconnect" ? "primary small" : "small"} setupHref="/accounts/setup/meta" /> : <Link className="btn small" href={`/connections?connect=${a.provider}`}>Reconnect</Link>}
                  <Action className="danger small" path={`/api/connections/${a.id}`} method="DELETE" label="Disconnect" confirm={`Disconnect ${a.displayName} from ${a.workspaceName}? Posts still scheduled for it are canceled and the saved permission is deleted.`} />
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 18, maxWidth: "80ch" }}>“—” and “Not checked yet” mean the platform has not reported that value to iGerald; nothing here is estimated. Opening an account&apos;s content, calendar, inbox, analytics or ads switches to its workspace first.</p>
    </div>
  );
}
