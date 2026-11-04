# Acceptance tests — live proof per feature / provider

Local proofs (already passing): `pnpm test` (security, media, integrations stub, core queue + brand isolation) and `pnpm smoke` (end-to-end through a stub Telegram API). These prove the pipeline, **not** a live provider. Each live test below produces a JSON evidence file in `docs/test-evidence/<provider>-<date>.json` with: date, account id (external), request ids, remote post ids, permalink, scopes granted, pass/fail. Only then the provider's status becomes `LIVE_VERIFIED`.

## Per provider (repeat for each eligible network)
1. **Authentication** — connect via the official flow; `/api/connections/:id/health` returns `healthy`; granted scopes recorded; wrong token/app password rejected with `auth_expired`.
2. **Disconnect** — queued targets canceled; `SocialAccountToken` row deleted; reconnect restores publishing.
3. **Publish** — one post per supported format (text, image, carousel, video, story/reel where applicable). Remote id + permalink stored; the post is visible on the platform; `PublishAttempt` has the provider request id.
4. **Unsupported format** — validation blocks it before any API call with a precise message.
5. **Scheduling** — schedule 10 minutes ahead in Europe/Rome; published within ±2 min of the UTC instant; a second run crossing a DST boundary date (last Sunday of March/October) lands on the right instant.
6. **Idempotency** — kill the worker between provider acceptance and DB write (simulate timeout); on retry the earlier remote id is reconciled, no duplicate post. Replay the same webhook event twice → one `WebhookEvent` row.
7. **Quota / errors** — forced 429 (stub) → retry after `Retry-After`; 5xx → backoff; permanent 403 → `failed_permanent` + notification.
8. **Privacy** — no token in the Next.js client bundle (`grep -r "botToken" .next/static` empty); DB `SocialAccountToken.ciphertext` not plaintext; pino logs redacted.
9. **Inbox** — one real received comment/DM → exactly one local record; one authorized reply visible on the platform.
10. **Analytics** — a nonzero metric matches the platform dashboard (±provider delay); a metric the platform does not expose is absent in the API response and shown as "—".
11. **Ads (read)** — synced campaigns match Ads Manager names/status/budgets; pause/resume receipt saved; activation without a confirmation token is refused (`confirmation_required`).
12. **Report** — evidence file written; status table in `docs/provider-capabilities.md` updated.

## Ops
- Worker outage: stop worker with a job running → within `JOB_LOCK_TTL_MS` it is reclaimed and completes (covered by `queue.test.ts › reclaims jobs orphaned by a crashed worker`).
- Backup/restore: `pnpm backup` then restore into a scratch DB and open `/health`.
- Token expiry: set `tokenExpiresAt` in the past → health check flags `needs_reconnect`, publishing to it is refused.
