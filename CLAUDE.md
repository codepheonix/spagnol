# Social Manager — persistent project rules

Personal-use social media manager for the Spagnol Mobili group (one owner, several brands).
Reproduces Zernio's *functional categories* with lawful official APIs. Not a clone of its UI or server.

## Architecture (do not drift)
- pnpm monorepo. `apps/web` = Next.js 15 App Router (UI + `/api/*` routes). `apps/worker` = always-on job runner.
- `packages/db` Prisma/PostgreSQL schema. `packages/core` domain services + Postgres job queue. `packages/integrations` provider adapters.
  `packages/security` AES-256-GCM credential encryption, scrypt passwords, JWT sessions, OAuth/PKCE, webhook HMAC. `packages/media` storage drivers (local, supabase-edge, S3-compatible, vercel-blob) + content sniffing. Browser-direct uploads via `/api/media/presign` → signed PUT → `/api/media/:id/finalize`.
- Queue: Postgres table `Job` claimed with `FOR UPDATE SKIP LOCKED`; retries with backoff + `Retry-After`; dead-letter; orphan-lock reaping.
  Runs via `apps/worker` (always-on) or `POST /api/jobs/tick` (serverless). In production the tick is called **every minute by Supabase `pg_cron` + `pg_net`** (job `sm-job-tick`; see `supabase/scheduler.sql`), so scheduled posts go out with no browser open; Vercel's daily cron is only a fallback. Time-bucketed jobs use `enqueue(..., { once: true })` so a minute tick cannot re-run them. Decision: no Redis — one fewer paid service, same guarantees at this scale.
- Adapter contract: `packages/integrations/src/contract.ts`. Two backends per provider: `native` (official APIs) and `zernio` (optional gateway, isolated in `src/zernio/`, replaceable, never silently mandatory).
- Every account/media/post/inbox/analytics/ads row is brand-scoped; every query goes through owner → brand checks (`getPost(userId, …)`, `apiBrand(user, …)`).

## Security rules
- Secrets only in `.env.local` / hosting env / encrypted `SystemSetting`. Never in source, logs, or the browser. The pino logger redacts token fields.
- Provider tokens are stored in `SocialAccountToken` encrypted with `TOKEN_ENCRYPTION_KEY`. Rotate by bumping `TOKEN_ENCRYPTION_KEY_VERSION`.
- OAuth: random `state` (single-use, 15 min), PKCE when supported, exact redirect URI, server-side exchange. The state binds the brand; when a sign-in grants several assets nothing is saved until the owner picks them on `/accounts/choose` (granted tokens wait encrypted in the state row). Reconnect only refreshes the same identity.
- Provider app credentials (Meta app id/secret) are entered at `/accounts/setup/meta`, verified with the provider, and stored encrypted in `SystemSetting app.<NAME>`; env vars of the same name are a fallback. Never returned to the browser.
- Webhooks: verify HMAC when a secret exists; dedupe on provider event id (`WebhookEvent` unique).
- Mutating `/api` calls require same-origin (`middleware.ts`) and a valid session.

## Truthfulness rules (acceptance)
- No invented success: a target is `published` only after the provider returns a remote id (and, where the provider is async, after reconciliation).
- Never re-send blindly: after a timeout or an interrupted worker (`PublishAttempt` left `started`/`unknown`) the publish job first asks the provider (`adapter.findRecentPost`) whether the post exists. Networks with no lookup stop for the owner's review. One scheduling authority: this app's queue (provider-side scheduling is not used).
- A stand-in provider server proves our logic, not the provider's acceptance — it never earns `LIVE_VERIFIED`.
- Unsupported operations show capability states (`unsupported`, `needs_approval`, …), never silent no-ops or fake buttons.
- Analytics: absent metric = `null`/dash, never 0. Every metric carries its `source`.
- Ads: read-only by default; activation needs a fresh confirmation token minted by a user action; the write path stays disabled until read sync is LIVE_VERIFIED.
- Implementation status per provider lives in `docs/integrations/provider-capabilities.md`. `LIVE_VERIFIED` only with evidence in `docs/test-evidence/`.

## No-design-loop rule
UI is deliberately minimal (plain CSS). Do not spend time on visual polish unless usability is blocked. Once a feature passes its objective test, move on.

## Commands
`pnpm infra:up` (Postgres + MinIO via Docker) · `pnpm db:migrate:dev` · `pnpm db:seed` · `pnpm dev` · `pnpm dev:worker` · `pnpm test` · `pnpm typecheck` · `pnpm smoke` (needs a running web with `TELEGRAM_API_BASE=http://127.0.0.1:8089`) · `pnpm backup`.

## Architecture diagrams (single source — keep in sync)
- The five diagrams live in `packages/core/src/architecture/diagrams.ts`. The `/architecture` page (React Flow) and `docs/architecture/*.mmd` are generated from it: run `pnpm diagrams` after editing; a test fails when the files are stale.
- Each node declares its `state` (implemented, partial, planned, optional, external, candidate). Planned/candidate nodes carry no probe and always show as Disabled. When a service interface changes, update its node in the same commit.
- Live status (`architecture/status.ts`) reads real records only — never add simulated or random health. Run traces (`architecture/runs.ts`) mark stages the system does not have as `skipped`.
- Unified-platform work happens on branch `unified-platform`; the audit and the open decisions are in `docs/audit/phase-0-audit.md`.
