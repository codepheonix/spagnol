import Link from "next/link";
import { listWorkspaces, type WorkspaceOverview } from "@sm/core";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { Action } from "@/components/Action";
import { WorkspaceForm } from "@/components/WorkspaceForm";

export const metadata = { title: "Organizations" };

const SECTIONS: Array<{ kind: WorkspaceOverview["kind"]; title: string; empty: string }> = [
  { kind: "personal", title: "Personal", empty: "No personal workspace. Add one to manage your own accounts." },
  { kind: "business", title: "My companies", empty: "No company yet." },
  { kind: "client", title: "Client companies", empty: "No client company yet. Add one for each customer whose accounts you manage; each stays separate." },
];

function Card({ w, current }: { w: WorkspaceOverview; current: boolean }) {
  return (
    <article className={`card wcard${current ? " current" : ""}`}>
      <div className="top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <span className="logo" aria-hidden>{w.logoUrl ? <img src={w.logoUrl} alt="" referrerPolicy="no-referrer" /> : w.name.slice(0, 1).toUpperCase()}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="name">{w.name}</div>
          <div className="small muted">{[w.industry, w.country].filter(Boolean).join(", ") || (w.kind === "personal" ? "Personal workspace" : "No details added")}</div>
        </div>
        {current && <span className="badge ok">Current</span>}
      </div>
      <div className="nums">
        <span><b>{w.accounts}</b> accounts</span>
        <span><b>{w.scheduledPosts}</b> scheduled</span>
        <span><b>{w.publishedPosts}</b> published</span>
        {w.failedPosts > 0 && <span style={{ color: "var(--err)" }}><b style={{ color: "inherit" }}>{w.failedPosts}</b> failed</span>}
        {w.accountsNeedingAttention > 0 && <span style={{ color: "var(--warn)" }}><b style={{ color: "inherit" }}>{w.accountsNeedingAttention}</b> to reconnect</span>}
        <span><b>{w.adAccounts}</b> ad accounts</span>
      </div>
      <div className="row">
        {!current && <Action className="small" path={`/api/brands/${w.id}/select`} label="Switch to it" />}
        <Action className="small" path={`/api/brands/${w.id}/select`} label="Connect accounts" redirect="/connections" />
        <Link className="btn ghost small" href={`/accounts?workspace=${w.id}`}>Its accounts</Link>
        <Action className="ghost small" path={`/api/brands/${w.id}`} method="PATCH" json={{ archived: true }} label="Archive" confirm={`Archive ${w.name}? It disappears from the workspace list and its scheduled work stops being shown. Nothing is deleted and you can restore it below.`} />
      </div>
    </article>
  );
}

export default async function OrganizationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const active = await getActiveBrand(user);
  const all = await listWorkspaces(user.id, { includeArchived: true });
  const live = all.filter((w) => !w.archived);
  const archived = all.filter((w) => w.archived);
  const created = sp.created ? live.find((w) => w.id === sp.created) : undefined;
  const locale = await getLocale();

  return (
    <div>
      <div className="head">
        <div>
          <h1>Organizations</h1>
          <p className="lead">A workspace keeps one person&apos;s or one company&apos;s accounts, content, messages and ads together — and apart from every other workspace.</p>
        </div>
        <div className="row">
          <a className="btn primary" href="#add">+ Add company</a>
          <Link className="btn" href="/connections">+ Connect social account</Link>
        </div>
      </div>

      {created && (
        <div className="msg ok" role="status">
          <b>{created.name}</b> is ready and selected. Connect its social accounts now?
          <div className="row" style={{ marginTop: 8 }}><Link className="btn primary small" href="/connections">Connect social accounts</Link><Link className="btn ghost small" href="/organizations">Later</Link></div>
        </div>
      )}
      {live.length === 0 && (
        <div className="empty" style={{ marginBottom: 18 }}>
          <h3>Start with one workspace</h3>
          <p>Nothing is set up yet. Create a personal workspace for your own accounts, or add a company. You can add as many as you manage.</p>
          {archived.length > 0 && <p className="small muted">You also have {archived.length} archived workspace{archived.length === 1 ? "" : "s"} from before, listed at the bottom. They stay hidden unless you restore them.</p>}
        </div>
      )}

      {live.length > 0 && SECTIONS.map((s) => {
        const items = live.filter((w) => w.kind === s.kind);
        return (
          <section key={s.kind}>
            <h2>{s.title}</h2>
            {items.length === 0 ? <p className="muted small">{s.empty}</p> : <div className="wgrid">{items.map((w) => <Card key={w.id} w={w} current={active?.id === w.id} />)}</div>}
          </section>
        );
      })}

      <div style={{ marginTop: 26 }}>
        <WorkspaceForm defaultKind={live.length === 0 && !sp.add ? "personal" : "business"} defaultLocale={locale} />
      </div>

      {archived.length > 0 && (
        <section>
          <h2>Archived</h2>
          <p className="muted small">Kept exactly as they were, with their accounts and history. They are not shown anywhere else until you restore them.</p>
          <div className="scroll-x">
            <table>
              <thead><tr><th>Workspace</th><th>Accounts</th><th>Posts published</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {archived.map((w) => (
                  <tr key={w.id}><td><b>{w.name}</b></td><td>{w.accounts}</td><td>{w.publishedPosts}</td><td className="small muted">{w.createdAt.toISOString().slice(0, 10)}</td><td><Action className="small" path={`/api/brands/${w.id}`} method="PATCH" json={{ archived: false }} label="Restore" /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
