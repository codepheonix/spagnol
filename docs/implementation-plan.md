# Implementation plan — milestones, dependencies, verification

| Phase | Scope | Depends on | Verification | State (4 Nov 2026) |
|---|---|---|---|---|
| 0 Spec lock | blueprint read, Zernio OpenAPI (764 paths) inspected, docs written | — | docs present | done |
| 1 Foundation | monorepo, Prisma schema (35 models), owner auth, brands, encrypted token store, media store + validation, Postgres job queue, worker + serverless tick, audit, notifications | 0 | `pnpm test` (27 tests incl. queue restart survival + brand isolation), `pnpm build`, `pnpm smoke` | done |
| 2 Integrations framework | adapter contract, registry, capability matrix, OAuth state/PKCE, credential connect; Telegram, Bluesky, Discord, Slack native; Zernio gateway for 16 platforms | 1 | unit tests with stubbed transport; smoke through stub Bot API | code complete; **live verification pending credentials** |
| 3 Meta family | native Facebook Page + Instagram (Facebook Login path), comments, insights; Meta Ads via Zernio read + pause | 2 | real post/permalink, insights match Meta dashboard | code complete; needs Meta app or Zernio key |
| 4 Google / video | YouTube resumable upload, GBP posts + reviews; FFmpeg probing | 2 | real upload id + processing status | native not started (available through Zernio) |
| 5 Remaining organic | LinkedIn, Pinterest, Reddit, TikTok, X native | 2 | live connect→validate→publish→status per platform | native not started (available through Zernio) |
| 6 Inbox + analytics | webhooks (done for Zernio), comments/DMs/reviews sync + replies, analytics snapshots, CSV | 2–3 | one real inbound event stored once; reply reaches provider; metrics traced to API responses | code complete; needs live accounts |
| 7 Ads | read sync (done), drafts + validation + confirmation token (done), activation/boost write path | 3 + LIVE_VERIFIED read | existing campaign sync matches Ads Manager; pause/resume receipt | write path intentionally disabled |
| 8 Advanced | automations engine execution, CRM, AI drafts (done, needs key), Canva/competitor-ads modules | 6 | per-flow live test | partial |
| 9 Deployment | GitHub + Vercel + Supabase (DB, Storage S3), Vercel Cron tick, worker option, backups | 1 | `/api/health` ok on production; cron tick processed; backup restored once | in progress |

## Next milestone (needs the owner)
1. Save the Zernio API key in Settings (or set `ZERNIO_API_KEY`), register the webhook URL with a secret.
2. Connect Facebook Page + Instagram (Facebook Login) via Zernio → publish one real test post → record evidence in `docs/test-evidence/` → flip status to `LIVE_VERIFIED`.
3. Optional: create a Telegram bot + channel and a Bluesky app password to verify the native adapters live.
