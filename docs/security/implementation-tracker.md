# Security implementation tracker

One row per task. Updated in the same commit as the work. Status is one of: Not started ·
In progress · Implemented (code and tests exist) · Tests passed (run and green) · Production
verified (checked against the live deployment) · Blocked (needs someone or something named in
the row) · Failed.

Evidence lives in `docs/test-evidence/`. Commits are on `main` and `unified-platform`.
Last updated: 18 Nov 2026.

## Baseline (before this plan)

| Task | Status | Evidence |
|---|---|---|
| Database closed to the public data API (row level security on every table, no public grants) | Production verified | `docs/security/README.md`; `security.test.ts` |
| Webhook signatures, closed without a secret, deduplicated | Production verified | `scripts/security-smoke.mjs` §4 |
| Platform sign-in return bound to the signed-in user and workspace | Production verified | `security.test.ts`, smoke §5 |
| Database-backed sign-in limits | Production verified | smoke §6 |
| Nonce-based script policy, security headers, cross-site request refusal | Production verified | smoke §1–3 |

## Phase 1 — Containment

| # | Task | Component / files | Commit | Tests | Status | Production verification | Known issues |
|---|---|---|---|---|---|---|---|
| 1.1 | Exposed owner password: account held at "choose a new password" until changed in the app; exposed and earlier passwords cannot be chosen again; other sessions end on change | `packages/core/src/account-security.ts` (`passwordChangeOwed`, `accountGate`, `changePassword`), `apps/web/src/lib/{auth,api}.ts`, `/account/password` | `c539614`, `0cf0ac1`, `883c04d` | `account-security.test.ts`; browser journey (47 checks) | **Blocked on the owner for the last step** — everything else Production verified | 18 Nov: owner sign-in lands on `/account/password`; every other page redirects there; API answers 403 `password_change_required`; re-choosing the exposed password answers 422; sign-out kills the session (15/15) | The owner must choose the new password in the app; nobody else may. A temporary password issued on 18 Nov could not be added to the reuse list because its text is no longer available; it is not valid on the account. |
| 1.2 | Production / preview isolation | `packages/core/src/environment.ts` (database marker, 503 on mismatch), `apps/web/src/lib/{api,auth,setup}.ts`, Vercel environment variables | `bf4d04e`, `883c04d` | `environment.test.ts` (3) | Production verified for isolation; **staging database not created** | 18 Nov: all production secrets are scoped to the Production target only; the preview build of `883c04d` answers 503 "DATABASE_URL not found" — it has no way to reach production data. Preview URLs are also behind Vercel sign-in. | Previews have no database, so they do not run. A separate staging database (second free Supabase project, or a separate schema and role) is an owner decision — see "Needs the owner". Preview deployments built before 18 Nov still carry the old settings; they sit behind Vercel sign-in and should be deleted in the Vercel dashboard. |
| 1.2b | Environments: local (developer Postgres), automated tests (CI Postgres service, `APP_ENV=test`), preview, production | `.github/workflows/security.yml`, `environment.ts` | this commit | CI run | Implemented | — | CI result to be confirmed after the first run |
| 1.3 | Repository exposure: secret scan of the working tree and all history | detect-secrets (working tree), pattern scan over every commit on every branch; gitleaks in CI | `8bf6d36` (stop tracking a build cache) | scan output | Tests passed | n/a | No real secret found. The repository is public: source, commit history and one commit's author e-mail are visible to anyone. Making it private is an owner decision (it also changes how deployments are triggered). |
| 1.4 | Last vulnerable dependency (zod < 4.6.6 via the Bluesky SDK, GHSA-mrhx-c7xc-m3w5; upstream has no fixed release) | SDK removed; `packages/integrations/src/bluesky/index.ts` rewritten on plain HTTPS calls; `packages/integrations/src/net.ts` (public-address guard, size cap) | `a7051ec` | `bluesky.test.ts` (10) | Production verified (dependency); adapter itself unverified against Bluesky | `pnpm audit --prod`: no known vulnerabilities, on the commit that is live | The rewritten adapter has never talked to the real Bluesky service (no account connected); it keeps the status `CODE_COMPLETE_NEEDS_CREDENTIALS`. The upstream advisory is not "fixed" — the package is simply no longer used. |

## Phase 2 — Account security

| # | Task | Component / files | Commit | Tests | Status | Production verification | Known issues |
|---|---|---|---|---|---|---|---|
| 2.1 | Two-factor sign-in (TOTP), single use per time step, encrypted secret | `account-security.ts`; `/api/auth/mfa`; `/api/account/mfa/*`; `components/AccountForms.tsx` | `c539614`, `0cf0ac1` | unit + browser journey | Tests passed | Routes are live and refuse unauthenticated use (smoke §6b). **End-to-end enrolment in production waits for the owner's phone.** | Passkeys not built |
| 2.2 | Enrolment: QR as an image, manual key, first code required, ten recovery codes shown once and stored hashed; password alone cannot disable | same | same | same | Tests passed | as 2.1 | — |
| 2.3 | Password reset: single-use 30-minute link, same answer for unknown addresses, second factor required when enabled | `requestPasswordReset`, `resetPasswordWithToken`, `/forgot`, `/reset`, `mailer.ts` | `c539614`, `0cf0ac1`, `883c04d` | unit (in-memory mail) + browser journey | Tests passed; **e-mail delivery Blocked** (no mail service; owner decision) | Pages render; made-up links answer 400 and guessing is blocked after five (smoke §6b) | Until a mail service is connected, recovery is `docs/security/owner-recovery.sql` (tested end to end locally) |
| 2.4 | Sessions: 7 days at most, 12 hours idle, list, end one or all others, re-authentication for keys, provider credentials and ad activation | `account-security.ts`, `lib/auth.ts`, `/api/account/sessions*`, `/api/account/reauth`, `/account/confirm` | `c539614`, `0cf0ac1` | unit + browser journey | Tests passed | Own session list and sign-out verified in production (prod check) | Connecting an account with a bot token does not ask for re-authentication |
| 2.5 | Sign-in attack prevention: progressive blocks, known-browser exemption, second-factor failures counted, new-device and blocked-burst notices, no open redirect | `auth-throttle.ts`, `/api/auth/login`, `packages/security/src/redirect.ts` | `c539614`, `a7051ec`, `0cf0ac1` | unit; `redirect.test.ts` | Production verified (limits, redirect) | Smoke §6: five wrong passwords then blocked, wait time stated; `?next=//…` stays on site | No CAPTCHA; notices are in-app only |

## Phases 3–13

| Phase | Task | Status | Note |
|---|---|---|---|
| 3 | Several users per organization, invitations, roles, tenant isolation enforced in the database | Not started | Today every query is scoped owner → workspace in the service layer and tested; there is one user |
| 4 | Platform sign-in and webhook hardening | Not started | Baseline controls above are in place |
| 5 | API, browser, upload, infrastructure | In progress | Done: outbound-address guard for user-supplied server URLs (`net.ts`), health probe without error text. Rest not started |
| 6 | AI agent security | Not started | |
| 7 | Advertising and spending safeguards | In progress | Done: read-only by default; activation needs a fresh confirmation token and a recently confirmed password. Rest not started |
| 8 | Security Center at `/security` | Not started | `/account/security` covers the account's own controls |
| 9 | Automatic scanning | In progress | `.github/workflows/security.yml`: gitleaks over full history, `pnpm audit --prod`, typecheck + tests against a throwaway Postgres + build, Semgrep (report only until triaged) |
| 10 | Backups, restore test, incident response | Not started | The project is on a plan without automatic database backups; `pnpm backup` exists but no restore has been tested |
| 11 | Abuse-case tests, penetration-test readiness | In progress | Each control above has a test that tries the abuse first. No independent test has been done |
| 12 | Release verification, final report | Per release | Evidence: `docs/test-evidence/security-2026-11-18-phase-1-2.md` |
| 13 | Recurring maintenance | Not started | The nightly CI run is the first recurring check |

Documents not written yet (they will describe work that does not exist yet): tenant-isolation,
oauth-security, api-security, ai-agent-security, advertising-security, monitoring,
backup-recovery, penetration-test-readiness, production-readiness, final-security-report, and the
security architecture diagrams.

## Needs the owner

1. **Choose a new password** — sign in at the production address; the only screen that opens is
   the password screen. Do not send the new password to anyone, in any chat.
2. **Turn on two-factor sign-in** — Account security → Set up; scan the code with an authenticator
   app; store the ten recovery codes. Deadline: 7 days after the password change.
3. **Repository visibility** — decide whether the GitHub repository becomes private.
4. **Mail service** for password-reset e-mails — choose one (several have free tiers) or accept
   database-administrator recovery.
5. **Staging database** for preview builds — approve a second Supabase project or a separate
   schema in the existing one.
6. **Old preview deployments** — delete those created before 18 Nov in the Vercel dashboard.
