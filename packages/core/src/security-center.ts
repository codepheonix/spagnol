/**
 * Security Center: one read-only report built from records. Every figure is counted from a table,
 * a catalog query or the process configuration at the moment of the call. A control that does not
 * exist yet is reported as `not_built` with no number — never as zero threats, never as healthy.
 */
import { prisma } from "@sm/db";
import { accountGate, listSessions, mfaEnabled, passwordChangeOwed, recoveryCodesLeft } from "./account-security";
import { checkEnvironment, deploymentEnv } from "./environment";
import { mailConfigured } from "./mailer";
import { getAiConfig, getZernioConfig, providerAppStatus } from "./settings";
import { getSecretSetting } from "./settings";

export type ControlState = "ok" | "attention" | "action" | "not_built" | "unknown";
export interface Control {
  id: string;
  section: "authentication" | "connections" | "infrastructure" | "ai" | "advertising" | "recovery";
  title: string;
  state: ControlState;
  /** What the records say, in plain words. */
  detail: string;
  /** Where the owner can act, when there is something to do. */
  href?: string;
  action?: string;
  /** Where the control lives in the code or the docs. */
  source: string;
}
export interface SecurityEvent { id: string; at: string; action: string; label: string; outcome: string; ip: string | null; note: string | null }
export interface SecurityOverview {
  at: string;
  controls: Control[];
  counts: { ok: number; attention: number; action: number; notBuilt: number; unknown: number };
  signIn: { failed24h: number; failed7d: number; blockedNow: number; lastSuccessAt: string | null; liveSessions: number };
  events: SecurityEvent[];
}

const DAY = 24 * 3600_000;
const EVENT_LABELS: Record<string, string> = {
  "auth.login": "Sign-in",
  "auth.login_password_ok": "Password accepted, waiting for the code",
  "auth.login_second_factor": "Two-factor code",
  "auth.password_change": "Password change",
  "auth.password_change_required": "Password marked as exposed",
  "auth.password_reset": "Password reset completed",
  "auth.password_reset_request": "Password reset requested",
  "auth.mfa_enabled": "Two-factor sign-in turned on",
  "auth.mfa_disabled": "Two-factor sign-in turned off",
  "auth.recovery_code_used": "A recovery code was used",
  "auth.recovery_codes_regenerated": "New recovery codes",
  "auth.reauth": "Password confirmed for a sensitive change",
  "auth.session_revoked": "A session was ended",
  "auth.sessions_revoked": "All other sessions were ended",
  "auth.setup": "Owner account created",
  "auth.claim": "Owner account claimed",
  "settings.update": "Keys or settings changed",
  "settings.provider_apps": "Platform app credentials changed",
  "ads.activate": "Campaign activation attempt",
  "oauth.callback": "Platform sign-in return",
  "connection.complete": "Account connection",
  "connection.disconnect": "Account disconnected",
  "webhook.rejected": "Webhook delivery refused",
};
const noteOf = (details: unknown): string | null => {
  const d = (details ?? {}) as Record<string, unknown>;
  if (typeof d.reason === "string") return d.reason.slice(0, 120);
  if (Array.isArray(d.changed)) return `changed: ${(d.changed as unknown[]).map(String).join(", ").slice(0, 100)}`;
  if (typeof d.secondFactor === "string") return `second factor: ${d.secondFactor}`;
  if (typeof d.count === "number") return `${d.count} ended`;
  return null;
};
const ago = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  return m < 1 ? "less than a minute ago" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const date = (d: Date) => d.toISOString().slice(0, 10);

/** Catalog facts about the application's tables. `null` when the catalog could not be read. */
async function databaseFacts(): Promise<{ tables: number; withoutRls: number; publicGrants: number } | null> {
  try {
    const [t] = await prisma.$queryRaw<Array<{ tables: bigint; without_rls: bigint }>>`
      SELECT count(*) AS tables, count(*) FILTER (WHERE NOT c.relrowsecurity) AS without_rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`;
    const [g] = await prisma.$queryRaw<Array<{ grants: bigint }>>`
      SELECT count(*) AS grants FROM information_schema.role_table_grants
      WHERE table_schema = current_schema() AND grantee IN ('anon', 'authenticated', 'PUBLIC')`;
    return { tables: Number(t?.tables ?? 0), withoutRls: Number(t?.without_rls ?? 0), publicGrants: Number(g?.grants ?? 0) };
  } catch {
    return null;
  }
}

export async function getSecurityOverview(userId: string, sessionId: string | null): Promise<SecurityOverview> {
  const now = new Date();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const brands = await prisma.brand.findMany({ where: { ownerId: userId }, select: { id: true } });
  const brandIds = brands.map((b) => b.id);
  const mine = { OR: [{ actorUserId: userId }, { actorUserId: null }] };
  const [sessions, codesLeft, failed24h, failed7d, blockedNow, lastOk, env, db, apps, ai, zernio, zernioSecret, accounts, expiring, hooks7d, hookFailed7d, lastTick, drafts, activeCampaigns, rules, events, deniedAds30d] = await Promise.all([
    listSessions(userId, sessionId),
    recoveryCodesLeft(userId),
    prisma.auditLog.count({ where: { action: { in: ["auth.login", "auth.login_second_factor"] }, outcome: "denied", createdAt: { gte: new Date(now.getTime() - DAY) } } }),
    prisma.auditLog.count({ where: { action: { in: ["auth.login", "auth.login_second_factor"] }, outcome: "denied", createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    prisma.authThrottle.count({ where: { blockedUntil: { gt: now } } }),
    prisma.auditLog.findFirst({ where: { action: "auth.login", outcome: "ok", actorUserId: userId }, orderBy: { createdAt: "desc" } }),
    checkEnvironment().catch(() => null),
    databaseFacts(),
    providerAppStatus().catch(() => null),
    getAiConfig().catch(() => null),
    getZernioConfig().catch(() => null),
    getSecretSetting("zernio.webhookSecret").then((v) => Boolean(v ?? process.env.ZERNIO_WEBHOOK_SECRET)).catch(() => false),
    prisma.socialAccount.groupBy({ by: ["status"], where: { brandId: { in: brandIds } }, _count: true }),
    prisma.socialAccount.count({ where: { brandId: { in: brandIds }, tokenExpiresAt: { gt: now, lt: new Date(now.getTime() + 7 * DAY) } } }),
    prisma.webhookEvent.count({ where: { receivedAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    prisma.webhookEvent.count({ where: { receivedAt: { gte: new Date(now.getTime() - 7 * DAY) }, OR: [{ signatureValid: false }, { status: "failed" }] } }),
    prisma.systemSetting.findUnique({ where: { key: "jobs.lastTick" } }),
    prisma.adCampaignDraft.count({ where: { brandId: { in: brandIds }, confirmedAt: null } }),
    prisma.adCampaign.count({ where: { adAccount: { brandId: { in: brandIds } }, status: { in: ["active", "ACTIVE"] } } }).catch(() => null),
    prisma.automationRule.count({ where: { brandId: { in: brandIds }, enabled: true } }),
    prisma.auditLog.findMany({ where: { AND: [mine, { OR: [{ action: { startsWith: "auth." } }, { action: { in: ["settings.update", "settings.provider_apps", "ads.activate"] } }, { outcome: "denied" }] }] }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.auditLog.count({ where: { action: "ads.activate", outcome: "denied", brandId: { in: brandIds }, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
  ]);

  const controls: Control[] = [];
  const add = (c: Control) => controls.push(c);
  const gate = accountGate(user, now);
  const mfa = mfaEnabled(user);
  const total = accounts.reduce((n, a) => n + a._count, 0);
  const broken = accounts.filter((a) => !["connected", "active"].includes(String(a.status))).reduce((n, a) => n + a._count, 0);
  const tickAt = (lastTick?.value as { at?: string } | null)?.at;
  const tickAge = tickAt && !Number.isNaN(Date.parse(tickAt)) ? Math.round((now.getTime() - Date.parse(tickAt)) / 1000) : null;

  // --- Authentication -------------------------------------------------------------------------
  add({ id: "password", section: "authentication", title: "Password", state: passwordChangeOwed(user) ? "action" : "ok", detail: passwordChangeOwed(user) ? "This password must be replaced before the account can be used." : `Last changed ${date(user.passwordChangedAt!)}. At least 12 characters, checked against reuse and known breaches.`, href: "/account/password", action: "Change password", source: "packages/core/src/account-security.ts" });
  add({ id: "mfa", section: "authentication", title: "Two-factor sign-in", state: mfa ? (codesLeft <= 2 ? "attention" : "ok") : gate === "mfa" ? "action" : "attention", detail: mfa ? `On since ${date(user.totpEnabledAt!)}. ${codesLeft} of 10 recovery codes unused.` : user.mfaGraceUntil ? `Off. It must be on by ${date(user.mfaGraceUntil)}.` : "Off. The account is protected by its password alone.", href: "/account/security", action: mfa ? "Manage" : "Set up", source: "docs/security/authentication.md" });
  add({ id: "sessions", section: "authentication", title: "Signed-in browsers", state: sessions.length > 3 ? "attention" : "ok", detail: `${sessions.length} live ${sessions.length === 1 ? "session" : "sessions"}. A session ends after 12 hours without use and after 7 days at most.`, href: "/account/security", action: "Review or end sessions", source: "packages/core/src/account-security.ts" });
  add({ id: "signin-limits", section: "authentication", title: "Sign-in attempt limits", state: blockedNow > 0 ? "attention" : "ok", detail: `${failed24h} refused ${failed24h === 1 ? "attempt" : "attempts"} in the last 24 hours, ${failed7d} in 7 days. ${blockedNow} ${blockedNow === 1 ? "source is" : "sources are"} blocked right now. Limits are counted in the database and each repeated block lasts longer.`, source: "packages/core/src/auth-throttle.ts" });
  add({ id: "recovery-mail", section: "authentication", title: "Password reset by e-mail", state: mailConfigured() ? "ok" : "attention", detail: mailConfigured() ? "A mail service is connected. Reset links work once, for 30 minutes." : "No mail service is connected, so reset links cannot be sent. Recovery is possible only with database administrator access (docs/security/owner-recovery.sql).", source: "packages/core/src/mailer.ts" });
  add({ id: "roles", section: "authentication", title: "Several users, roles and approvals", state: "not_built", detail: "One owner account exists. Invitations, roles and per-role permissions are not built yet.", source: "docs/security/implementation-tracker.md (phase 3)" });

  // --- Connected accounts ---------------------------------------------------------------------
  add({ id: "tokens", section: "connections", title: "Stored platform credentials", state: total === 0 ? "ok" : broken > 0 ? "attention" : "ok", detail: total === 0 ? "No social account is connected, so no platform credential is stored." : `${total} connected ${total === 1 ? "account" : "accounts"}; ${broken} need attention. Credentials are stored encrypted (AES-256-GCM) and are never sent to the browser.`, href: "/accounts", action: "Open all accounts", source: "packages/security/src/crypto.ts" });
  add({ id: "token-expiry", section: "connections", title: "Credentials about to expire", state: expiring > 0 ? "attention" : "ok", detail: expiring > 0 ? `${expiring} ${expiring === 1 ? "credential expires" : "credentials expire"} within 7 days. Reconnect the account to renew it.` : total === 0 ? "No account is connected, so nothing can expire." : "No credential expires within 7 days.", href: "/accounts", source: "packages/core/src/connections.ts" });
  add({ id: "oauth", section: "connections", title: "Platform sign-in protection", state: "ok", detail: "Each sign-in uses a single-use state valid for 15 minutes, bound to the user and workspace that started it. Nothing is saved until the owner picks which pages or profiles to add.", source: "packages/core/src/connections.ts" });
  add({ id: "meta-app", section: "connections", title: "Meta app credentials", state: apps?.META_APP_ID && apps?.META_APP_SECRET ? "ok" : "unknown", detail: apps?.META_APP_ID && apps?.META_APP_SECRET ? "Configured and stored encrypted. Changing them needs a recently confirmed password." : "Not configured, so Facebook and Instagram cannot be connected yet and their webhook is closed.", href: "/accounts/setup/meta", action: "Meta setup", source: "apps/web/src/app/api/settings/provider-apps/route.ts" });

  // --- API and infrastructure -----------------------------------------------------------------
  add({ id: "db-lock", section: "infrastructure", title: "Database closed to the public data API", state: !db ? "unknown" : db.withoutRls === 0 && db.publicGrants === 0 ? "ok" : "action", detail: !db ? "The database catalog could not be read just now." : `${db.tables} tables checked now: ${db.withoutRls} without row level security, ${db.publicGrants} privileges held by public roles.`, source: "docs/security/README.md" });
  add({ id: "environment", section: "infrastructure", title: "Environment isolation", state: env?.ok ? "ok" : env ? "action" : "unknown", detail: env?.ok ? `This is the ${deploymentEnv()} deployment and the database is marked ${env.database}. A deployment of another environment is refused by this database.` : env ? env.reason : "Could not be checked just now.", source: "packages/core/src/environment.ts" });
  const keyNames = ["AUTH_SECRET", "TOKEN_ENCRYPTION_KEY", "CRON_SECRET"] as const;
  const missing = keyNames.filter((k) => !process.env[k]);
  add({ id: "server-keys", section: "infrastructure", title: "Server keys", state: missing.length ? "action" : "ok", detail: missing.length ? `Missing: ${missing.join(", ")}.` : `Session signing, credential encryption (key version ${process.env.TOKEN_ENCRYPTION_KEY_VERSION ?? "1"}) and scheduler keys are set. Their values exist only in the hosting configuration.`, source: "packages/security" });
  add({ id: "webhooks", section: "infrastructure", title: "Incoming webhooks", state: hookFailed7d > 0 ? "attention" : "ok", detail: `${hooks7d} received in 7 days, ${hookFailed7d} failed or carried a bad signature. Zernio endpoint: ${zernioSecret ? "accepts signed deliveries only" : "closed (no signing secret set)"}. Meta endpoint: ${apps?.META_APP_SECRET ? "accepts signed deliveries only" : "closed (no app secret set)"}.`, href: "/health", source: "packages/core/src/webhooks.ts" });
  add({ id: "browser", section: "infrastructure", title: "Browser protections", state: "ok", detail: "Scripts run only with a per-request nonce; pages cannot be framed; state-changing requests from other sites are refused. Checked on every release by scripts/security-smoke.mjs.", source: "apps/web/src/middleware.ts" });
  add({ id: "scheduler", section: "infrastructure", title: "Scheduler", state: tickAge === null ? "unknown" : tickAge < 300 ? "ok" : "attention", detail: tickAge === null ? "No run is recorded yet." : `Last ran ${ago(new Date(now.getTime() - tickAge * 1000))}.`, href: "/health", source: "supabase/scheduler.sql" });
  add({ id: "scans", section: "infrastructure", title: "Code and dependency scans", state: "unknown", detail: "Secret scan, dependency advisories, tests and static analysis run on GitHub for every push and every night. Their results are on GitHub and are not readable from here yet.", href: "https://github.com/codepheonix/spagnol/actions/workflows/security.yml", action: "Open the runs", source: ".github/workflows/security.yml" });
  add({ id: "rate-limits", section: "infrastructure", title: "Request limits beyond sign-in", state: "not_built", detail: "Sign-in, two-factor and reset attempts are limited. General per-user request limits are not built yet.", source: "docs/security/implementation-tracker.md (phase 5)" });

  // --- AI -------------------------------------------------------------------------------------
  add({ id: "ai-scope", section: "ai", title: "What the AI can do", state: "ok", detail: ai ? `Model ${ai.model} writes drafts that a person reviews. It cannot publish, send messages, change settings or spend money: no such tool is given to it.` : "No AI key is configured. Nothing is sent to a model.", href: "/ai", source: "packages/core/src/ai.ts" });
  add({ id: "ai-guard", section: "ai", title: "Prompt-injection and tool-permission guard", state: "not_built", detail: "No blocked-call or injection events are recorded because the guard and the agent tool layer do not exist yet.", source: "docs/security/implementation-tracker.md (phase 6)" });
  add({ id: "automations", section: "ai", title: "Automatic replies", state: "ok", detail: `${rules} automation ${rules === 1 ? "rule is" : "rules are"} switched on. Each has a cooldown and a per-contact cap, and can be switched off at once.`, href: "/automations", action: "Review automations", source: "packages/core/src/automations.ts" });

  // --- Advertising ----------------------------------------------------------------------------
  add({ id: "ads-write", section: "advertising", title: "Spending money", state: "ok", detail: `Campaign activation is switched off in the code: every attempt is refused and recorded (${deniedAds30d} in 30 days). ${drafts} ${drafts === 1 ? "draft is" : "drafts are"} waiting. ${activeCampaigns === null ? "" : `${activeCampaigns} synced ${activeCampaigns === 1 ? "campaign is" : "campaigns are"} active on the platform's side.`}`.trim(), href: "/ads", source: "packages/core/src/ads.ts" });
  add({ id: "ads-limits", section: "advertising", title: "Budget limits and emergency stop", state: "not_built", detail: "Per-workspace spending limits, approval rules and a stop-everything control are not built yet. They are required before activation can be switched on.", source: "docs/security/implementation-tracker.md (phase 7)" });

  // --- Recovery -------------------------------------------------------------------------------
  add({ id: "backups", section: "recovery", title: "Database backups", state: "attention", detail: "No backup run is recorded by the app. The hosting plan in use does not include automatic database backups; a manual backup script exists (pnpm backup) but no restore has been tested.", source: "docs/security/implementation-tracker.md (phase 10)" });
  add({ id: "incidents", section: "recovery", title: "Incident history", state: "not_built", detail: "There is no incident register yet. Security-relevant events are listed below from the audit log.", source: "docs/security/implementation-tracker.md (phase 10)" });

  const count = (s: ControlState) => controls.filter((c) => c.state === s).length;
  return {
    at: now.toISOString(),
    controls,
    counts: { ok: count("ok"), attention: count("attention"), action: count("action"), notBuilt: count("not_built"), unknown: count("unknown") },
    signIn: { failed24h, failed7d, blockedNow, lastSuccessAt: lastOk?.createdAt.toISOString() ?? null, liveSessions: sessions.length },
    events: events.map((e) => ({ id: e.id, at: e.createdAt.toISOString(), action: e.action, label: EVENT_LABELS[e.action] ?? e.action, outcome: e.outcome, ip: e.ip, note: noteOf(e.details) })),
  };
}
