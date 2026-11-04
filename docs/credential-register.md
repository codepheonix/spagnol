# Credential register — what the owner must provide (never paste secrets into chat)

Put values in `.env.local` (web), `.env` (worker/prisma) or the hosting provider's env settings. Provider keys for Zernio/AI can instead be saved from **Settings** in the app (stored encrypted).

## Core (required)
| Variable | Purpose | How to get it |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | PostgreSQL (Supabase pooler :6543 with `pgbouncer=true` for runtime; session pooler/direct for migrations) | Supabase → Project → Connect |
| `AUTH_SECRET` | signs session cookies | `openssl rand -base64 32` |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for provider credentials | `openssl rand -base64 32` (32 bytes). Losing it = all connections must be redone |
| `CRON_SECRET` | protects `/api/jobs/tick` | `openssl rand -hex 24` |
| `PUBLIC_APP_URL` | absolute URL used in OAuth callbacks and webhooks | your HTTPS domain |
| `STORAGE_DRIVER` | `local` (dev), `supabase-edge` (production default: private Supabase bucket `media` behind the `media` Edge Function; `MEDIA_GATEWAY_URL` + `MEDIA_GATEWAY_SECRET`), `s3` (`STORAGE_*`, e.g. Supabase S3 keys/MinIO/R2) or `vercel-blob` (`BLOB_READ_WRITE_TOKEN`). Any driver except `local` gives signed URLs, which Instagram native publishing needs | already provisioned on Supabase project `spagnol-social-manager` |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | seed only (`pnpm db:seed`); hashed, never stored in clear | choose |

## Zernio gateway (recommended first path for Facebook/Instagram)
| What | Where |
|---|---|
| API key (`zk_…`) | zernio.com → API keys. Save in Settings → Zernio (verified with one `GET /v1/profiles` call). |
| Webhook | zernio.com → Webhooks → URL `${PUBLIC_APP_URL}/api/webhooks/zernio`, events: `post.*`, `account.*`, `comment.received`, `message.received`, `conversation.started`, `analytics.synced`, `lead.received`, `review.*`; set a secret and save the same value in Settings. |
| Meta assets for ads | Business account, ad account `act_…`, Facebook Page, Instagram professional linked to the Page, payment method on the ad account. Connect Instagram with **Facebook Login**. |

## Native providers (optional, one developer app each)
| Provider | Registration | Variables | Redirect / webhook URLs |
|---|---|---|---|
| Meta (Facebook Pages, Instagram) | developers.facebook.com → app (Business type) → Facebook Login for Business + Instagram Graph API products; add yourself/Page admins as app roles (Standard Access works for assets you manage); App Review only for other people's assets | `META_APP_ID`, `META_APP_SECRET`, optional `META_GRAPH_VERSION` (default v22.0) | `${PUBLIC_APP_URL}/api/oauth/facebook/callback`, `${PUBLIC_APP_URL}/api/oauth/instagram/callback` |
| Telegram | @BotFather → `/newbot`; add bot as channel admin with "Post messages" | none (bot token entered in Accounts, stored encrypted) | — |
| Bluesky | bsky.app → Settings → App passwords | none (entered in Accounts) | — |
| Discord | discord.com/developers → app → Bot → token; invite with Send Messages + Attach Files | none | — |
| Slack | api.slack.com/apps → scopes `chat:write`, `files:write`, `channels:read` → install → Bot token | none | — |
| Google (YouTube, GBP), LinkedIn, Pinterest, Reddit, TikTok, X | not needed while using the Zernio backend; register only when a native adapter is built | `GOOGLE_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET`, `PINTEREST_APP_ID/SECRET`, `REDDIT_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `X_CLIENT_ID/SECRET` | — |

## AI (optional)
`AI_API_KEY` (OpenRouter or any OpenAI-compatible endpoint), `AI_API_BASE`, `AI_MODEL` — or set from Settings → AI. Drafts only; the owner reviews before publishing.

## Safe setup practice
- Generate secrets locally; never commit `.env*`; `.gitignore` already excludes them.
- Rotate `TOKEN_ENCRYPTION_KEY` by adding `TOKEN_ENCRYPTION_KEY_V2` and setting `TOKEN_ENCRYPTION_KEY_VERSION=2`, then reconnecting accounts (old blobs keep decrypting with V1 while both keys exist).
