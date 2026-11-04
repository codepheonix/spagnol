# Provider capabilities and implementation status

Research reference: 4 Nov 2026 (Zernio OpenAPI v1.457.0, official provider docs). Verify again when credentials arrive.
Statuses: `LIVE_VERIFIED` (remote evidence in `docs/test-evidence/`), `CODE_COMPLETE_NEEDS_CREDENTIALS`, `AWAITING_PLATFORM_APPROVAL`, `UNSUPPORTED_BY_PROVIDER`, `REGION_OR_ACCOUNT_RESTRICTED`, `NOT_IMPLEMENTED`, `FAILED`.

## Native adapters (official APIs, `packages/integrations/src/<provider>`)

| Provider | Auth | Publish | Inbox | Analytics | Ads | Status | Notes |
|---|---|---|---|---|---|---|---|
| Telegram | Bot token (BotFather) + channel admin | text, photo, video, GIF, document, media group ≤10, delete, edit | ❌ Bot API has no channel comment/DM read for our use | ❌ no view counts via Bot API | ❌ | CODE_COMPLETE_NEEDS_CREDENTIALS | caption ≤1024, text ≤4096, photo ≤10 MB, video ≤50 MB (bot upload) |
| Bluesky | App password (AT Protocol) | text ≤300 graphemes, ≤4 images ≤1 MB, 1 video, delete | replies read + reply | likes/reposts/replies/quotes, followers | ❌ | CODE_COMPLETE_NEEDS_CREDENTIALS | DMs not tested |
| Discord | Bot token + channel id | text ≤2000, ≤10 attachments ≤10 MB, delete | ❌ | ❌ | ❌ | CODE_COMPLETE_NEEDS_CREDENTIALS | permalink needs guild id |
| Slack | Bot token (xoxb) + channel id | text, files (external upload flow), delete | ❌ | ❌ | ❌ | CODE_COMPLETE_NEEDS_CREDENTIALS | scopes chat:write, files:write, channels:read |
| Facebook Page | Facebook Login (Meta app) → Page tokens | text/link, photo, multi-photo, video, remote schedule (10 min–75 days), first comment, delete | comments read/reply; DMs need `pages_messaging` approval | page followers, reach/engagements/views (day), post impressions/reach/engaged/clicks/reactions | ❌ (separate Marketing API) | CODE_COMPLETE_NEEDS_CREDENTIALS | Standard Access suffices for Pages you manage; App Review for others |
| Instagram professional | Facebook Login → linked Page token | image, carousel ≤10, reel, story, first comment; **media by URL → needs S3 storage driver (signed URLs)** | comments read/reply; DMs need `instagram_manage_messages` approval | followers, posts, reach/profile_views/accounts_engaged (day), per-media likes/comments/impressions/reach/saves/shares/views | ❌ | CODE_COMPLETE_NEEDS_CREDENTIALS | JPEG/PNG only, ≤8 MB images; no delete via API |
| Threads, YouTube, LinkedIn, Pinterest, Reddit, TikTok, X, Google Business, WhatsApp, Snapchat | — | — | — | — | — | NOT_IMPLEMENTED natively (Reddit/TikTok/GBP/Snapchat would also be AWAITING_PLATFORM_APPROVAL) | use the Zernio backend |

## Zernio gateway (`packages/integrations/src/zernio`, optional, replaceable)

Uses your Zernio API key (stored encrypted from Settings). Connect = Zernio-hosted OAuth (`GET /v1/connect/{platform}`), one Zernio profile per brand (`externalId = brandId`). Publish = `POST /v1/posts` with `Idempotency-Key` (24 h dedupe), media via `POST /v1/media/presign`. Analytics = `GET /v1/analytics` + `/v1/accounts/follower-stats` (follower stats need Zernio's analytics add-on; absent → metric omitted, never 0). Inbox = `/v1/inbox/comments`, `/v1/inbox/conversations`. Ads = `/v1/ads/campaigns`, `PUT /v1/ads/campaigns/{id}/status`. Webhooks = `X-Zernio-Event-Id` dedupe, `X-Zernio-Signature` HMAC-SHA256.

| Platform (Zernio) | Publish | Inbox | Analytics | Ads | Restrictions documented by Zernio |
|---|---|---|---|---|---|
| Facebook Page | post, photo, carousel, video, reel, story, schedule, first comment | comments, DMs | yes | Meta Ads (read, pause; create disabled here) | Ads need Business account, ad account, Page, payment method |
| Instagram | image, carousel ≤10, reel ≤15 min/300 MB, story, schedule | comments, DMs | yes | via Meta Ads | connect with **Facebook Login** to run ads (Instagram Login = posting only) |
| Threads | text, image, video, carousel | comments | yes | — | no DMs |
| YouTube | video, short, schedule, first comment | comments | yes | — | no DMs |
| LinkedIn | text, image, video, carousel, document, first comment | comments | yes | LinkedIn Ads | personal post analytics only for Zernio-published posts |
| TikTok | video, photo carousel | comments | yes | TikTok Ads | business messaging region-restricted (EEA incl. Italy) → `blocked_by_region` |
| Pinterest | pin image/video, board required | ❌ no inbox API | yes | Pinterest Ads | — |
| X | text, images, video, thread | comments, DMs (legacy only) | yes | X Ads | encrypted X Chat not readable |
| Bluesky | text, images, video | replies, DMs | yes | — | — |
| Google Business | post, image, link, event/offer | reviews + reply | yes | — | needs verified location |
| Telegram | text, image, video, document | DMs | — | — | — |
| Discord / Slack | messages + files | — | — | — | — |
| Reddit | — | — | — | — | temporarily unavailable on Zernio → `needs_approval` |
| Snapchat | — | — | — | — | closed beta → 403 `PLATFORM_BETA_RESTRICTED` |
| WhatsApp | messaging only | DMs, templates | — | CTWA ads | optional; the company does not use WhatsApp |

Zernio pricing (Build plan): 2 accounts free; 3–10 accounts $6/mo each; ads $0.01 per active ad/month after 500 free; messaging first 10,000 sent/month free.
