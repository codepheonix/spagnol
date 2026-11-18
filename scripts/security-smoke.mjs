#!/usr/bin/env node
/**
 * Outside-in security check of a running iGerald (local or production). It changes nothing a
 * customer owns: probes use a made-up e-mail address and a random state; the only records it
 * creates are sign-in counters for that made-up address and audit entries.
 *
 *   node scripts/security-smoke.mjs https://your-host            # anonymous checks
 *   SMOKE_EMAIL=… SMOKE_PASSWORD=… node scripts/security-smoke.mjs https://your-host   # + session checks
 *
 * Exit code 1 when any check fails.
 */
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const https = base.startsWith("https://");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const req = (path, init = {}) => fetch(base + path, { redirect: "manual", ...init });
const json = (body, extra = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });

// 1. Headers on a page
const page = await req("/login");
const csp = page.headers.get("content-security-policy") ?? "";
const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
check("page has a Content-Security-Policy", csp.length > 0);
check("scripts need a per-response nonce (no 'unsafe-inline' for scripts)", Boolean(nonce) && !/script-src[^;]*'unsafe-inline'/.test(csp));
check("no 'unsafe-eval' in production policy", !https || !csp.includes("'unsafe-eval'"));
check("policy forbids framing, plugins and foreign form targets", ["frame-ancestors 'none'", "object-src 'none'", "form-action 'self'", "base-uri 'self'"].every((d) => csp.includes(d)));
const nonce2 = /'nonce-([^']+)'/.exec((await req("/login")).headers.get("content-security-policy") ?? "")?.[1];
check("nonce changes on every response", Boolean(nonce) && nonce !== nonce2);
const html = await page.text();
check("every inline script on the page carries the nonce", (html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? []).every((t) => t.includes(`nonce="${nonce}"`)), `${(html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? []).length} inline scripts`);
for (const [h, want] of [["x-frame-options", "DENY"], ["x-content-type-options", "nosniff"], ["referrer-policy", "strict-origin-when-cross-origin"], ["cross-origin-opener-policy", "same-origin"], ["permissions-policy", "camera=()"]]) check(`header ${h}`, (page.headers.get(h) ?? "").includes(want));
if (https) check("header strict-transport-security", /max-age=\d{7,}/.test(page.headers.get("strict-transport-security") ?? ""));

// 2. Nothing is served without a session
for (const p of ["/api/brands", "/api/connections", "/api/posts", "/api/media", "/api/settings", "/api/ads/accounts", "/api/architecture/status", "/api/health/jobs", "/api/notifications"]) check(`no session -> 401 ${p}`, (await req(p)).status === 401);
check("no session -> page redirects to sign-in", [302, 307].includes((await req("/accounts")).status));
check("API answers carry a deny-all policy", ((await req("/api/brands")).headers.get("content-security-policy") ?? "").includes("default-src 'none'"));
check("scheduler endpoint refuses without its secret", (await req("/api/jobs/tick", { method: "POST" })).status === 401);

// 3. Cross-site requests
const probe = `security-probe-${Date.now().toString(36)}@example.invalid`;
check("sign-in from another site is refused (Origin)", (await req("/api/auth/login", json({ email: probe, password: "x" }, { origin: "https://attacker.example" }))).status === 403);
check("sign-in from another site is refused (Sec-Fetch-Site)", (await req("/api/auth/login", json({ email: probe, password: "x" }, { "sec-fetch-site": "cross-site" }))).status === 403);
check("a sandboxed frame (Origin: null) is refused", (await req("/api/auth/login", json({ email: probe, password: "x" }, { origin: "null" }))).status === 403);

// 4. Webhooks
const z = await req("/api/webhooks/zernio", json({ id: "smoke-unsigned", type: "post.published" }));
check("Zernio webhook refuses an unsigned delivery", z.status === 503 || z.status === 401, `status ${z.status}`);
const zs = await req("/api/webhooks/zernio", json({ id: "smoke-badsig", type: "post.published" }, { "x-zernio-signature": "0".repeat(64), "x-zernio-event-id": "smoke-badsig" }));
check("Zernio webhook refuses a wrong signature", zs.status === 503 || zs.status === 401, `status ${zs.status}`);
check("Meta webhook refuses a wrong verify token", (await req("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status === 403);
const m = await req("/api/webhooks/meta", json({ object: "instagram", entry: [] }));
check("Meta webhook refuses an unsigned delivery", [401, 403, 503].includes(m.status), `status ${m.status}`);

// 5. Platform sign-in return without a matching session
const cb = await req("/api/oauth/facebook/callback?code=x&state=smoke-" + Date.now());
check("sign-in return with an unknown state attaches nothing", [302, 307].includes(cb.status) && (cb.headers.get("location") ?? "").includes("error="));

// 6. Sign-in throttle (made-up address, so no real account is affected). The rule is five wrong
// passwords per e-mail + network address. A tester whose requests leave from several addresses
// (a proxy pool) reaches five on each address in turn, so allow for a few addresses.
const statuses = [];
for (let i = 0; i < 26; i++) {
  statuses.push((await req("/api/auth/login", json({ email: probe, password: `wrong-${i}` }, { origin: base }))).status);
  if (statuses.length >= 8 && statuses.slice(-3).every((s) => s === 429)) break;
}
const answered = statuses.filter((s) => s === 401).length;
check("wrong passwords are answered at first, then every further attempt is blocked", answered >= 5 && statuses.slice(-3).every((s) => s === 429) && statuses.every((s) => s === 401 || s === 429), `${answered} answered, then blocked (${statuses.length} attempts)`);
const blocked = await req("/api/auth/login", json({ email: probe, password: "wrong" }, { origin: base }));
check("a blocked attempt says how long to wait", blocked.status === 429 && Number(blocked.headers.get("retry-after")) > 0, `retry-after ${blocked.headers.get("retry-after")}s`);

// 6a. Health probe: usable by a monitor, says nothing an attacker can use
const hp = await req("/api/health");
const hb = await hp.json().catch(() => ({}));
check("health probe answers without error text or secrets", ["ok", "error", "not_configured"].includes(hb.db) && !/prisma|postgres|password|schema\.|ECONN/i.test(JSON.stringify(hb)), JSON.stringify(hb).slice(0, 160));
check("deployment and database belong to the same environment", hb.environment === "ok", `env ${hb.env}, environment ${hb.environment}`);
if (https) check("the scheduler ran in the last five minutes", typeof hb.schedulerSecondsAgo === "number" && hb.schedulerSecondsAgo < 300, `${hb.schedulerSecondsAgo}s ago`);

// 6b. Account security surfaces that need no credentials
for (const p of ["/forgot", "/reset?token=" + "x".repeat(40)]) {
  const r = await req(p);
  check(`${p.split("?")[0]} is reachable signed out and carries a script policy`, r.status === 200 && (r.headers.get("content-security-policy") ?? "").includes("nonce-"), `status ${r.status}`);
}
const center = await req("/security");
check("Security Center needs a session", [302, 307].includes(center.status) && (center.headers.get("location") ?? "").includes("/login"), `status ${center.status}`);
const acct = await req("/account/security");
check("account security page needs a session", [302, 307].includes(acct.status) && (acct.headers.get("location") ?? "").includes("/login"), `status ${acct.status}`);
for (const [path, method] of [["/api/account/sessions", "GET"], ["/api/account/sessions", "DELETE"], ["/api/account/mfa/start", "POST"], ["/api/account/mfa/disable", "POST"], ["/api/account/reauth", "POST"], ["/api/auth/password", "POST"], ["/api/auth/mfa", "POST"]]) {
  const r = await req(path, { method, headers: { "content-type": "application/json", origin: base }, body: method === "GET" ? undefined : JSON.stringify({ code: "000000", password: "x", currentPassword: "x", newPassword: "x" }) });
  check(`${method} ${path} without a session is refused`, r.status === 401, `status ${r.status}`);
}
const unknownReset = await req("/api/auth/forgot", json({ email: `nobody-${Date.now()}@example.com` }, { origin: base }));
check("a reset request for an unknown address gets the ordinary answer", unknownReset.status === 200 && (await unknownReset.json()).ok === true, `status ${unknownReset.status}`);
check("a reset request from another site is refused", (await req("/api/auth/forgot", json({ email: probe }, { origin: "https://attacker.example" }))).status === 403);
const resets = [];
for (let i = 0; i < 26; i++) {
  resets.push((await req("/api/auth/reset", json({ token: `made-up-${Date.now()}-${i}-${"x".repeat(20)}`, newPassword: "A-long-enough-passphrase-1" }, { origin: base }))).status);
  if (resets.length >= 8 && resets.slice(-3).every((x) => x === 429)) break;
}
check("made-up reset links are refused, then guessing is blocked", resets.filter((x) => x === 400).length >= 5 && resets.slice(-3).every((x) => x === 429) && resets.every((x) => x === 400 || x === 429), resets.join(","));

// 7. Session handling (only with credentials)
if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  const li = await req("/api/auth/login", json({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }, { origin: base }));
  const set = li.headers.get("set-cookie") ?? "";
  check("legitimate sign-in still works", li.status === 200);
  const first = await li.clone().json().catch(() => ({}));
  if (first.secondFactor) {
    const c0 = (li.headers.get("set-cookie") ?? "").split(";")[0];
    check("with two-factor sign-in, the password alone opens no data", (await req("/api/brands", { headers: { cookie: c0 } })).status === 401);
    check("with two-factor sign-in, the password alone opens no page", [302, 307].includes((await req("/accounts", { headers: { cookie: c0 } })).status));
    console.log("SKIP  remaining session checks (this account needs a code from its authenticator app)");
    const failedEarly = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failedEarly} passed, ${failedEarly} failed`);
    process.exit(failedEarly ? 1 : 0);
  }
  check("session cookie is HttpOnly and SameSite=Lax" + (https ? " and Secure" : ""), /HttpOnly/i.test(set) && /SameSite=Lax/i.test(set) && (!https || /Secure/i.test(set)));
  const cookie = set.split(";")[0];
  const me = await req("/api/brands", { headers: { cookie } });
  check("signed-in request is served", me.status === 200);
  check("signed-in page is served with a policy", ((await req("/accounts", { headers: { cookie } })).headers.get("content-security-policy") ?? "").includes("nonce-"));
  check("a state-changing call from another site is refused even with the session", (await req("/api/notifications", { ...json({ ids: [] }, { origin: "https://attacker.example", cookie }) })).status === 403);
  check("sign-out works", (await req("/api/auth/logout", { method: "POST", headers: { cookie, origin: base } })).status === 200);
  check("the old session cookie is dead after sign-out", (await req("/api/brands", { headers: { cookie } })).status === 401);
} else console.log("SKIP  session checks (set SMOKE_EMAIL and SMOKE_PASSWORD)");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
