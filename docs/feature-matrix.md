# Feature matrix and acceptance criteria

Status legend: ✅ implemented + tested locally · 🟡 implemented, needs live credentials to verify · ⬜ not implemented · ❌ unsupported by provider.

| Module | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| Owner login | Single owner, scrypt password, DB-backed session + signed cookie, 14-day expiry, login rate limit, CSRF origin check | ✅ | `packages/security` tests, smoke step "login" |
| First-run setup | `/setup` only while no user exists (optional `SETUP_TOKEN`) | ✅ | manual |
| Owner settings | timezone, locale (IT/EN), password change | ✅ | `/settings` |
| Brands | create/edit/archive, switch active brand, server-side ownership on every query | ✅ | `queue.test.ts › brand isolation`, smoke "bogus brand rejected" |
| Audit log | actor, action, target, outcome, details, ip | ✅ | `/activity`, smoke |
| Provider catalogue | truthful capability + implementation status per provider × backend | ✅ | `/accounts` |
| Connect (credentials) | Telegram bot, Bluesky app password, Discord bot, Slack app — verified with a live identity call before saving; encrypted at rest | 🟡 | smoke (stub) · needs real accounts |
| Connect (OAuth native) | Facebook Pages + Instagram professional via Facebook Login; state/PKCE/anti-replay | 🟡 | needs Meta app |
| Connect (Zernio gateway) | hosted OAuth for 16 platforms with your Zernio key; profile per brand | 🟡 | needs Zernio key |
| Connection health | verify + capability discovery per account, token expiry, reconnect flags, notifications | ✅ | `check_account_health` job |
| Disconnect | cancel queued targets, delete local secrets, revoke remotely where supported | ✅ | smoke |
| Media library | upload (multipart), magic-byte sniffing, size/MIME checks, dimensions, private storage (local/S3), preview, delete, orphan cleanup | ✅ | `validate.test.ts`, smoke |
| Compose | body/title/link/tags, media order, per-target overrides (caption, content type, first comment, board, subreddit, privacy) | ✅ | `/posts/new` |
| Validation | per-target adapter validation before submit, blocked targets never enqueued | ✅ | smoke "over-limit text is blocked" |
| Publish now / schedule | UTC instant + IANA zone, DST-safe conversion | ✅ | `schedule helpers` test |
| Per-target status | one `PostTarget` per account with independent status, attempts, error category; parent rollup incl. `partial` | ✅ | smoke |
| Reconciliation | processing/remotely-scheduled targets polled until terminal; earlier remote id reused instead of re-posting | ✅ | `reconcile_target` job, smoke idempotency |
| Retry / cancel / duplicate / delete remote | per target retry, post cancel, duplicate, delete on networks with official endpoint | ✅ | `/posts/[id]` |
| Calendar | month view in brand timezone, statuses | ✅ | smoke |
| Weekly queue slots | per brand / per account, pause/resume, next free slot | ✅ | `nextAvailableSlot` test |
| Bulk CSV import | dry-run with per-row errors, duplicate check, commit | ✅ | `/posts` |
| Durable queue | SKIP LOCKED claim, backoff + jitter + Retry-After, dead-letter + manual retry, orphan recovery | ✅ | `queue.test.ts` |
| Serverless runner | `/api/jobs/tick` with `CRON_SECRET`, Vercel Cron config | ✅ | `vercel.json` |
| Always-on worker | `apps/worker`, heartbeat shown on `/health` | ✅ | manual |
| Webhooks | Zernio receiver: HMAC verify, dedupe by event id, post status / inbox / account / lead events | 🟡 | needs Zernio webhook |
| Inbox | threads + messages, comments, reviews (GBP via Zernio), reply where API allows, unread, search | 🟡 | needs live accounts |
| Analytics | account + post metrics with source, freshness, null-for-unsupported, CSV export, engagement rate with visible denominator | 🟡 | smoke "no invented metrics" |
| Ads (read) | sync ad accounts + campaigns via Zernio, separate reporting view | 🟡 | needs Meta Ads via Zernio |
| Ads (write) | pause/resume (explicit confirm), drafts + local validation, confirmation token, spend ceiling; activation disabled until read path is live-verified | ✅ gate / ⬜ create | `ads.ts` |
| Automations | bounded rules (trigger → notify/draft/tag), cooldown, per-contact cap; no auto-messaging | 🟡 engine stub | `/automations` |
| CRM contacts | lead records from `lead.received` with opt-in status | 🟡 | `ContactRecord` |
| AI drafts | OpenRouter-compatible, draft-only, reviewed by owner | 🟡 | needs API key |
| WhatsApp / telephony / Shopify / WordPress | optional extensions | ⬜ | out of scope for v1 (company does not use WhatsApp) |
| Backups | `scripts/backup.sh` (pg_dump) | ✅ | manual |
| i18n | IT/EN navigation labels, locale toggle | ✅ | layout |
