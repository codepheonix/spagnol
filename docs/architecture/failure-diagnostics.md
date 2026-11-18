# Failure diagnostics — where to look first

Every row names the first node to open on `/architecture` (click it: live status, latest failure,
recent job ids, error text, configured credentials, next step) and what the system records.

| Symptom | First node (diagram) | Error category | What is recorded | Corrective action |
|---|---|---|---|---|
| Facebook / Instagram will not connect | Meta app configured? · Official Meta sign-in (B) | auth / provider permission missing | OAuth state row, audit `connection.*`, Meta's message verbatim | Register the Meta app; add the permission to its use case; sign in with a profile that has an app role |
| "Invalid Scopes" at sign-in | Official Meta sign-in (B) | provider permission missing | callback error | Add the scope in Meta, or untick "comments + insights" in Meta setup |
| Account shows needs_reconnect | Capability check + health (B) | token expired | `SocialAccount.lastError`, job `check_account_health` | Reconnect on Connections |
| Scheduled post never runs | Scheduled or manual trigger (C) → scheduler probe | queue processing failure | `SystemSetting jobs.lastTick`, `Job` rows | Supabase cron job `sm-job-tick` must be active, or run the worker |
| Instagram does not publish | Publish to authorized channels (C) | publishing validation failure | `PublishAttempt` (redacted request/response, provider request id) | JPEG reachable by signed URL; aspect ratio; reconnect if permission |
| Post published on one network only | Partial publication (C) | provider error | per-target status and error | Retry the failed account only |
| Posts duplicated | Record failure and retry safely (C) | — | attempt ledger + idempotency key; lookup before re-send | Should not happen; open the run trace and report the attempts |
| Outcome unknown after timeout | Verify each platform result (C) | provider unavailable | attempt status `unknown` | The job asks the network first; nothing to do |
| DMs are not sent | Send approved reply (E) | provider permission missing | `PrivateReply.status/error`, audit `automation.private_reply.failed` | Add comments / messaging permission, reconnect; in Development mode the commenter needs an app role |
| Comment never arrives | Official webhook · Per-minute poll (E) | webhook signature failure / approval | `WebhookEvent`, account `pollError` | Check App secret; live webhooks need Live + Advanced Access; poll covers the gap |
| DM outcome "uncertain" | Human review (E) | provider unavailable | status `uncertain`, notification | Check the inbox, then Retry |
| AI produces nothing | OpenRouter (A/C) | AI request failure | audit `ai.draft`, error text from OpenRouter | Add the key in Settings; check OpenRouter credit |
| Ads will not activate | Approved or pre-authorised? · Advertising adapter (D) | advertisement approval failure / budget guardrail block | audit `ads.activate` outcome denied | By design until read sync is verified live |
| Analytics are missing | Analytics collection (A) | provider permission missing | job `sync_analytics`, metric count | Add insights permissions, reconnect |
| Dashboard shows the wrong brand | Authentication + brand permissions (A) | tenant authorization failure | every query is owner → brand scoped | Switch brand in the sidebar; report if data of another owner appears |
| Database errors | PostgreSQL (A) | database failure | `/api/health` | Restore a paused Supabase project; check `DATABASE_URL` |
| Media upload rejected | Creative + media engine (A) | media processing failure | `MediaAsset.status` | File content must match its type; size limits per network |

Secrets and tokens never appear: the logger redacts token fields, credentials are listed by name
with configured / missing only, and provider requests are stored as redacted summaries.
Not built yet: per-company filtering of this view beyond the owner's brands, correlation ids, and a
rejected-webhook counter (unsigned deliveries are refused and not stored).
