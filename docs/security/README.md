# Security controls and how they are checked

What protects the application, where it lives, and which automated check proves it. Open risks and
audit findings are kept with the owner, not in this repository.

| Control | Where | Check |
|---|---|---|
| Database not reachable around the application: row level security on every table, no privilege for the platform's public roles | `packages/db/prisma/migrations/20261118160000_lock_data_api`, every later migration | `packages/core/src/security.test.ts` (fails if any table lacks it; an outside role with privileges still sees and changes nothing) |
| Workspace isolation between users | owner checks in `packages/core/src/workspaces.ts`, `apps/web/src/lib/api.ts` (`apiBrand`), each route | `workspaces.test.ts`, `architecture/status.test.ts` |
| Sign-in throttle shared by all server instances | `packages/core/src/auth-throttle.ts`, `apps/web/src/app/api/auth/login/route.ts` | `security.test.ts`, `scripts/security-smoke.mjs` |
| Cross-site request refusal (Origin / Sec-Fetch-Site), including sign-in | `apps/web/src/middleware.ts` | `scripts/security-smoke.mjs` |
| Content Security Policy with a per-response nonce; deny-all policy on API answers; other headers | `apps/web/src/middleware.ts`, `apps/web/next.config.ts` | `scripts/security-smoke.mjs` |
| Platform sign-in return bound to the browser session and the workspace | `completeOAuthCallback` in `packages/core/src/connections.ts` | `meta-flow.test.ts` |
| Zernio webhook: closed without a secret, signed deliveries only (lowercase hex HMAC-SHA256 of the raw body, `X-Zernio-Signature`), replays stopped by event id | `packages/core/src/webhooks.ts` | `security.test.ts`, `scripts/security-smoke.mjs` |
| Meta webhook: verify token + `X-Hub-Signature-256` | `packages/core/src/private-replies.ts` | `private-replies.test.ts`, `scripts/security-smoke.mjs` |
| Provider tokens encrypted at rest (AES-256-GCM); passwords hashed with scrypt | `packages/security` | `crypto.test.ts` |
| Known-vulnerability scan of dependencies | `pnpm audit --prod` | run before every release |

## Rules for changes
- **Every new table** gets `ALTER TABLE … ENABLE ROW LEVEL SECURITY` in the same migration and no grant to `anon` / `authenticated`. On Supabase, a migration applied through the dashboard or API runs as the admin role: check `information_schema.role_table_grants` afterwards.
- **Every migration** has a written rollback (`packages/db/prisma/rollback/` or a comment in the migration).
- **Every webhook** refuses unsigned requests; with no secret configured the endpoint is closed.
- **Every state-changing route** goes through the session and owner checks; machine endpoints authenticate themselves and are listed in `MACHINE` in `middleware.ts`.
- New script or connection origins must be added to the policy in `middleware.ts`, never by loosening it to `unsafe-inline` / `*`.

## Running the outside-in check
```
node scripts/security-smoke.mjs https://<host>
SMOKE_EMAIL=… SMOKE_PASSWORD=… node scripts/security-smoke.mjs https://<host>   # adds session checks
```
It uses a made-up e-mail address for the throttle test, so no real account is locked.
