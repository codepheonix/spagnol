import Link from "next/link";
import { redirect } from "next/navigation";
import { accountGate, passwordChangeOwed, listSessions, mailConfigured, mfaEnabled, recoveryCodesLeft } from "@sm/core";
import { getSession } from "@/lib/auth";
import { SessionsPanel, TwoFactorPanel, type SessionRow } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

const day = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(d);
const when = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(d);

/** A short, honest description of a browser from its user-agent string; unknown stays unknown. */
function device(ua: string | null): string {
  if (!ua) return "Unknown browser";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  return browser || os ? [browser ?? "Browser", os].filter(Boolean).join(" on ") : ua.slice(0, 40);
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { user, session } = s;
  if (passwordChangeOwed(user)) redirect("/account/password");
  const tz = user.timezone || "UTC";
  const enabled = mfaEnabled(user);
  const sessions: SessionRow[] = (await listSessions(user.id, session.id)).map((x) => ({ id: x.id, current: x.current, device: device(x.userAgent), ip: x.ip, started: when(x.createdAt, tz), lastSeen: when(x.lastSeenAt, tz), expires: when(x.expiresAt, tz), secondFactor: x.secondFactor, waiting: enabled && !x.secondFactor }));
  const { changed } = await searchParams;
  return (
    <div>
      <h1>Account security</h1>
      <p className="muted">{user.email}</p>
      {changed && <div className="msg ok" role="status">Your password was changed and every other browser was signed out.</div>}
      <TwoFactorPanel enabled={enabled} enabledAt={user.totpEnabledAt ? day(user.totpEnabledAt, tz) : null} codesLeft={enabled ? await recoveryCodesLeft(user.id) : 0} deadline={!enabled && user.mfaGraceUntil ? day(user.mfaGraceUntil, tz) : null} overdue={accountGate(user) === "mfa"} />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Password</h2>
        <p>{user.passwordChangedAt ? `Last changed ${day(user.passwordChangedAt, tz)}.` : "No change has been recorded yet."}</p>
        <Link className="btn" href="/account/password">Change password</Link>
        <p className="small muted" style={{ marginBottom: 0 }}>{mailConfigured() ? "If you forget it, the sign-in page can e-mail you a reset link." : "No e-mail service is connected, so a forgotten password cannot be reset by e-mail yet. Keep your recovery codes; the owner recovery procedure is in docs/security/authentication.md."}</p>
      </div>
      <SessionsPanel sessions={sessions} />
    </div>
  );
}
