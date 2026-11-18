import Link from "next/link";
import { getSecurityOverview, type Control, type ControlState } from "@sm/core";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

const STATE: Record<ControlState, { label: string; badge: string }> = {
  ok: { label: "In place", badge: "ok" },
  attention: { label: "Needs attention", badge: "warn" },
  action: { label: "Act now", badge: "err" },
  not_built: { label: "Not built yet", badge: "" },
  unknown: { label: "Not readable from here", badge: "" },
};
const SECTIONS: Array<[Control["section"], string, string]> = [
  ["authentication", "Your account", "Password, two-factor sign-in, sessions and recovery."],
  ["connections", "Connected accounts", "How platform credentials are stored and renewed."],
  ["infrastructure", "API and infrastructure", "Database, environments, keys, webhooks and scans."],
  ["ai", "AI and automation", "What the model and the automatic replies are allowed to do."],
  ["advertising", "Advertising", "What stands between the app and spending money."],
  ["recovery", "Recovery and incidents", "Backups and the record of what happened."],
];

export default async function SecurityPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const { user, session } = s;
  const o = await getSecurityOverview(user.id, session.id);
  const tz = user.timezone || "UTC";
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));
  const todo = o.controls.filter((c) => c.state === "action" || c.state === "attention");
  const ext = (href: string) => href.startsWith("http");
  return (
    <div className="sec">
      <h1>Security</h1>
      <p className="lead">Read from this installation's records at {when(o.at)}. A control that does not exist yet is listed as not built — it is never counted as safe.</p>

      <div className="sec-tally" role="list" aria-label="Controls by state">
        <div role="listitem"><b>{o.counts.ok}</b><span>in place</span></div>
        <div role="listitem" className={o.counts.attention ? "warn" : ""}><b>{o.counts.attention}</b><span>need attention</span></div>
        <div role="listitem" className={o.counts.action ? "err" : ""}><b>{o.counts.action}</b><span>need action now</span></div>
        <div role="listitem"><b>{o.counts.notBuilt}</b><span>not built yet</span></div>
        <div role="listitem"><b>{o.counts.unknown}</b><span>not readable from here</span></div>
      </div>

      {todo.length > 0 && (
        <div className="card">
          <h2>What needs you</h2>
          <ul className="sec-list">
            {todo.map((c) => (
              <li key={c.id}>
                <span className={`badge ${STATE[c.state].badge}`}>{STATE[c.state].label}</span>
                <div><b>{c.title}.</b> {c.detail}</div>
                {c.href && c.action && (ext(c.href) ? <a className="btn small" href={c.href} rel="noreferrer noopener" target="_blank">{c.action}</a> : <Link className="btn small" href={c.href}>{c.action}</Link>)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>Sign-in activity</h2>
        <dl className="sec-facts">
          <div><dt>Refused attempts, last 24 hours</dt><dd>{o.signIn.failed24h}</dd></div>
          <div><dt>Refused attempts, last 7 days</dt><dd>{o.signIn.failed7d}</dd></div>
          <div><dt>Sources blocked right now</dt><dd>{o.signIn.blockedNow}</dd></div>
          <div><dt>Browsers signed in</dt><dd>{o.signIn.liveSessions}</dd></div>
          <div><dt>Your last successful sign-in</dt><dd>{o.signIn.lastSuccessAt ? when(o.signIn.lastSuccessAt) : "—"}</dd></div>
        </dl>
        <p className="small muted">Counted from the audit log and the sign-in limiter. A refused attempt is a wrong password or code, yours included.</p>
      </div>

      {SECTIONS.map(([key, title, lead]) => (
        <section className="card" key={key} aria-labelledby={`sec-${key}`}>
          <h2 id={`sec-${key}`}>{title}</h2>
          <p className="muted small">{lead}</p>
          <ul className="sec-list">
            {o.controls.filter((c) => c.section === key).map((c) => (
              <li key={c.id}>
                <span className={`badge ${STATE[c.state].badge}`}>{STATE[c.state].label}</span>
                <div>
                  <b>{c.title}.</b> {c.detail}
                  <div className="small muted mono">{c.source}</div>
                </div>
                {c.href && (ext(c.href) ? <a className="btn small" href={c.href} rel="noreferrer noopener" target="_blank">{c.action ?? "Open"}</a> : <Link className="btn small" href={c.href}>{c.action ?? "Open"}</Link>)}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="card">
        <h2>What you can stop right now</h2>
        <ul className="sec-list plain">
          <li><div><b>A browser that should not be signed in.</b> End one session or all others.</div><Link className="btn small" href="/account/security">Sessions</Link></li>
          <li><div><b>A connected account you no longer trust.</b> Disconnecting deletes its stored credential.</div><Link className="btn small" href="/accounts">All accounts</Link></li>
          <li><div><b>An automatic reply.</b> Each rule has its own off switch.</div><Link className="btn small" href="/automations">Automations</Link></li>
          <li><div><b>A campaign.</b> Pausing is immediate and needs no confirmation; resuming asks for your password.</div><Link className="btn small" href="/ads">Ads manager</Link></li>
        </ul>
        <p className="small muted">A single stop-everything switch is not built yet.</p>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h2>Recent security events</h2>
          <Link className="small" href="/architecture">Security path diagram</Link>
        </div>
        {o.events.length === 0 ? <p className="muted">Nothing is recorded yet.</p> : (
          <div className="scroll-x"><table>
            <thead><tr><th>When</th><th>What</th><th>Result</th><th>Network address</th><th>Note</th></tr></thead>
            <tbody>
              {o.events.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(e.at)}</td>
                  <td>{e.label}</td>
                  <td><span className={`badge ${e.outcome === "ok" ? "ok" : e.outcome === "denied" ? "warn" : "err"}`}>{e.outcome === "ok" ? "Allowed" : e.outcome === "denied" ? "Refused" : "Error"}</span></td>
                  <td className="mono">{e.ip ?? "—"}</td>
                  <td className="small muted">{e.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="small muted">The last 40 entries from the audit log: sign-ins, account changes, key changes and every refused action.</p>
      </div>
    </div>
  );
}
