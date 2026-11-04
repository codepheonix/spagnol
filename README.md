# Spagnol Social Manager

Personal-use social media manager (one owner, several brands) built with Next.js 15, Prisma/PostgreSQL, a durable Postgres job queue and per-provider adapters (official APIs) plus an optional Zernio gateway. Minimal UI by design. See `CLAUDE.md` for the rules and `docs/` for the feature matrix, provider capabilities, credential register, plan and acceptance tests.

## Run locally (Mac)
```bash
pnpm install
pnpm infra:up                 # Postgres + MinIO via Docker
cp .env.example .env && cp .env.example apps/web/.env.local   # fill in secrets (openssl rand -base64 32)
pnpm db:migrate:dev
pnpm db:seed                  # creates the owner from OWNER_EMAIL / OWNER_PASSWORD
pnpm dev                      # http://localhost:3000
pnpm dev:worker               # always-on job runner (or call POST /api/jobs/tick from a cron)
pnpm test && pnpm typecheck
```

## Deploy
- Web: Vercel (root directory `apps/web`, build `pnpm build`, install at repo root). `vercel.json` schedules `/api/jobs/tick` on the Hobby plan limit; for minute-level native scheduling run `apps/worker` on an always-on host or ping the tick endpoint every few minutes from cron-job.org. Posts published through the Zernio backend are scheduled by Zernio itself and do not depend on the runner.
- Database: Supabase Postgres (`DATABASE_URL` = transaction pooler with `pgbouncer=true`, `DIRECT_URL` = session pooler). Media: Supabase Storage S3 (`STORAGE_DRIVER=s3`).
