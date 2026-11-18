# Self-hosting

## What exists today
- `docker-compose.yml` starts **PostgreSQL 16 and MinIO** for local development (`pnpm infra:up`).
- The app runs with `pnpm build && pnpm start` (web) and `pnpm worker` (always-on job runner — no
  external cron needed when the worker runs).
- Production currently runs on Vercel + Supabase with a database cron as the job runner.

## What is not written yet
A production Compose file (web, worker, Postgres, S3-compatible storage, Caddy for HTTPS, backups)
is **not in the repository yet**. It is the first item of the deployment phase and depends on the
publishing-engine decision in `docs/audit/phase-0-audit.md` §5, because Postiz would add Redis,
Temporal and Elasticsearch to the same file.

## Requirements for this app alone (estimate)
- 1 vCPU, 2 GB RAM, 20 GB disk + space for media (Reels grow quickly; plan object storage).
- A public HTTPS URL (Meta callbacks and webhooks require HTTPS) — Caddy or a tunnel.
- Outbound access to `graph.facebook.com`, `graph.instagram.com`, `openrouter.ai`.
- Daily database dump copied off the machine (`pnpm backup` exists for the dump).
- Environment: see `.env.example`; secrets only in the environment or the encrypted settings table.

## If Postiz is added (decision 1B)
Its own compose file defines nine services (app, Postgres, Redis, Temporal with its own Postgres and
Elasticsearch, Temporal UI, admin tools, Spotlight). Plan a 4 GB RAM class machine or more (my
estimate; Postiz's docs give its own minimums). It needs the same Meta app credentials.

## Hosting rules
- GitHub stores the code; it does not host the application or the database.
- Vercel's free Hobby plan must not be used for commercial multi-client production.
- Own hardware works if the line, power and backups are reliable; otherwise a small VPS is cheaper
  than an outage.
