# Technology stack (as implemented on branch `unified-platform`)

| Layer | In use today | Prompt's suggestion | Status / decision |
|---|---|---|---|
| Frontend | Next.js 15 App Router, React 19, plain CSS tokens (dark/light), IT/EN | Next.js, React, Tailwind, 3D-inspired cards | Tailwind + visual redesign = Phase 1 |
| Workflow diagrams | `@xyflow/react` 12 (MIT) | React Flow | **adopted** |
| Backend / API | Next.js route handlers, zod, TypeScript | TypeScript/Node, FastAPI where needed | no Python service unless decision 3B |
| Authentication | scrypt passwords, JWT session cookie, owner → brand scoping | Auth.js, organizations, 6 roles | organizations + roles = Phase 1 |
| Database | PostgreSQL 17 (Supabase), Prisma | PostgreSQL + pgvector | pgvector when brand knowledge is built |
| Queue / scheduling | Postgres `Job` table (`FOR UPDATE SKIP LOCKED`), `pg_cron` + `pg_net` minute tick, optional worker | Redis + Temporal | not needed unless Postiz/OpenReply are deployed |
| Publishing | native adapters: Facebook Page, Instagram, Telegram, Bluesky, Discord, Slack | Postiz | decision 1 (audit §5) |
| Comment → DM | native: Meta webhook + Private Replies API + poll fallback | OpenReply | decision 2 |
| Ads | drafts + confirmation gate; read via optional Zernio | Agentic Ads Studio | decision 3; native adapter not built |
| Shared social abstraction | `packages/integrations/src/contract.ts` | Social SDK | candidate for TikTok/LinkedIn/YouTube/X |
| AI | OpenRouter-compatible chat completions (drafts) | OpenRouter | agents = Phase 4 |
| Media | uploads, sniffing, signed URLs (Supabase Storage / S3 / Vercel Blob) | Sharp, FFmpeg, Remotion, Garage | processing = Phase 3/4 |
| Optional managed API | Zernio adapter, off without a key | Zernio optional | **as required** |
| Deployment | Vercel + Supabase; `docker-compose.yml` for local Postgres + MinIO | Docker Compose + Caddy | see `docs/deployment/self-hosting.md` |

One scheduling authority: this app's queue. Provider-side scheduling, Activepieces and Temporal are
not used, so no job can be executed by two schedulers.
