# Phase 0 audit — source systems, candidate components, reuse decisions

Audit date: 18 Nov 2026. Method: source code read for every repository below (shallow clone at the
commit shown); the two deployed apps inspected through their repositories and live `/api/health`.
Nothing here is inferred from a public demo.

## 1. The two source systems

### Social Manager — `codepheonix/spagnol` @ `a927eef` · https://spagnol-social-manager.vercel.app
A real application: Next.js 15 + React 19, Prisma on PostgreSQL (Supabase), a Postgres job queue
driven every minute by `pg_cron`, encrypted provider tokens, native adapters for the official APIs.

| Area | State in code | Verified against the real provider? |
|---|---|---|
| Sign-in, sessions, owner → brand scoping | built (single owner, several brands) | n/a |
| Brands (five Spagnol companies possible) | built | n/a |
| Connections: Facebook Page + Instagram via the group's own Meta app; account chooser; reconnect | built | **no** — no Meta app registered yet, zero accounts connected in production |
| Publishing: validate, schedule, per-account results, retry one account, check-before-resend | built | no (stand-in Graph server only) |
| Calendar, queues/slots, bulk import | built | n/a |
| Media: direct uploads, content sniffing, signed URLs | built | storage verified in production |
| Comment → DM (Instagram + Facebook Page), Meta webhook, exactly-once ledger, poll fallback | built (14 Nov) | no (stand-in only) |
| Inbox + comments sync, reply | built | no |
| Analytics sync (account + post metrics) | built | no |
| Ads: read sync, drafts, confirmation token | built **through the Zernio gateway only**; activation disabled | no |
| AI: caption drafts via an OpenRouter-compatible endpoint | built (drafts only) | not configured in production |
| Automations (generic rules), notifications, audit log, health page | built | n/a |
| Zernio gateway adapter | built, off without a key | no |
| Telegram, Bluesky, Discord, Slack adapters | built | no |
| Organizations, roles, multi-user tenancy | **not built** (one owner) | — |
| TikTok, LinkedIn, YouTube, X adapters | **not built** | — |
| Brand knowledge base, planning agents, learning engine | **not built** | — |
| Native Meta Marketing API (ads) adapter | **not built** | — |
| Image/video processing (Sharp, FFmpeg, Remotion) | **not built** | — |
| Italian page content | navigation only | — |

### AI Mobili Agent — https://spagnol-mobili-agent.vercel.app (+ `/demo.html`, `/dash.html`)
A **static planning site**: an interactive flowchart of the intended pipeline (Basic / Premium /
Enterprise), a post-and-ads mock-up and a report-screens mock-up, with invented example data. It has
no backend, no sign-in and no integrations. What it contributes to the unified platform is design,
not code:

- the five-brand structure and brand-specific wording, the keyword CTAs (CATALOGO, MISURE,
  RIVENDITORE, CAMPIONE, PROMO) and the dealer hand-off concept (e-mail + lead card; WhatsApp optional);
- the pipeline stages now represented in diagrams C, D and E;
- decisions already taken: fixed monthly ad budget mirrored as the Meta spending limit, money stays
  on the advertiser's ad account, OpenRouter with a fixed monthly cap, Zernio optional.

Its mock-up numbers must never be shown as live results inside the platform.

## 2. Candidate open-source components

| Repository (commit) | License | What it really is | Runs as | Needs |
|---|---|---|---|---|
| `gitroomhq/postiz-app` @ `c92d58b` (v1.47.0) | **AGPL-3.0** | Full scheduler product, 30+ network providers, public REST API (`/public/v1/posts`, `/integrations`, `/analytics`, `/upload`) | its own app: nine services in its compose file (app, Postgres, Redis, Temporal, Temporal's Postgres, **Elasticsearch**, Temporal UI, admin tools, Spotlight) | its own server; and **the same Meta app** (`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`) — it does not remove Meta's registration or review |
| `diwenne/openreply` @ `c78b2d2` | MIT | Instagram comment → DM tool (keywords, public reply, follow gate, tracked links, 750/h limiter, DM inbox) | its own Next.js 16 app + BullMQ worker | Postgres + **Redis**, its own sign-in (magic links, e-mail delivery); Instagram Login path only — **no Facebook Pages** |
| `masgant99/nalarin-agentic-ads-studio` @ `c500cc5` | MIT | Ads operations dashboard | FastAPI (Python) backend + React/Vite frontend + Postgres, own JWT auth | Meta service is substantial (campaign, ad set, creative, ad, insights, video upload — 649 lines on `facebook-business` SDK); Google 340 lines; **TikTok 134 lines**; AI through **Gemini and Fal.ai (paid)**, not OpenRouter; Ad Library scraper uses Playwright |
| `opencoredev/social-sdk` @ `ff274e3` (npm 0.5.0) | MIT | TypeScript library, typed capability manifests, per-destination outcomes incl. "uncertain" | **in-process library** (no extra service) | direct adapters: Bluesky, Instagram, LinkedIn, Threads, TikTok, X, YouTube; managed backends: Zernio, Postiz, Buffer…; pre-1.0 (API may change) |
| `xyflow/xyflow` (`@xyflow/react` 12) | MIT | Diagram canvas | library | — adopted in this phase |
| `activepieces/activepieces` | MIT core + commercial EE folders | Automation builder with its own scheduler | separate service (Postgres + Redis) | would be a second scheduler |
| `chatwoot/chatwoot` | MIT core + enterprise folder | Customer-support inbox | Rails app + Postgres + Redis + Sidekiq | heavy for this use |
| `deuxfleurs-org/garage` | AGPL-3.0 | S3-compatible storage | separate service | only when self-hosting media |

### License notes
- **AGPL-3.0 (Postiz, Garage):** running them unmodified as separate services and calling their HTTP
  APIs does not put this application under the AGPL. Modifying Postiz and offering it to clients over
  a network obliges publishing those modifications. Copying Postiz code into this repository would
  put the result under the AGPL — do not copy.
- **MIT (OpenReply, Agentic Ads Studio, Social SDK, React Flow):** code may be reused or ported with
  the copyright notice kept.
- Activepieces and Chatwoot ship enterprise-licensed directories; only the MIT parts may be used.

## 3. Findings that change the plan

1. **Postiz does not remove the Meta blocker and adds a server.** It needs the same Meta app
   credentials this platform needs, plus its own stack of services including Temporal and Elasticsearch. It
   cannot run on Vercel + Supabase (the hosting chosen so far); it needs an always-on machine.
   This platform already publishes natively to Facebook and Instagram with stricter delivery
   guarantees (attempt ledger, check-before-resend). Making Postiz the *default* engine would replace
   working code with a second system and a second scheduler for the same networks.
2. **OpenReply's function is already in this app** (built 14 Nov on Meta's Private Replies API),
   and this app's version also covers Facebook Pages and the Facebook Login path, which OpenReply
   does not. Deploying OpenReply would add a second app, a second sign-in and Redis for one feature.
   Worth porting from it (MIT): optional public reply, follow gate, tracked links, the 750-per-hour
   per-account limiter, story-reply / inbound-DM triggers.
3. **Agentic Ads Studio is a second product, not an adapter.** Its Meta service is a good reference
   for the native Marketing API adapter this platform lacks. Its Google and TikTok parts are thin, and
   its creative generation depends on paid Gemini / Fal.ai — which the prompt forbids adding silently.
4. **Social SDK overlaps this app's adapter contract** (same ideas: capability manifests, uncertain
   outcomes). It is the cheapest way to add TikTok / LinkedIn / YouTube / X / Threads: a library call
   inside the existing adapter contract, no new containers. Risk: pre-1.0.
5. **Temporal + Redis are not needed by the current design.** The Postgres queue already gives
   durable, retried, browser-independent execution, verified in production. They become necessary
   only if Postiz or OpenReply are deployed.
6. **Tenancy is the real gap for "multiple companies and customers".** The app has one owner with
   several brands. Organizations, memberships and six roles are a schema and authorization change
   that touches every query; it is Phase 1 work and independent of the choices above.

## 4. Recommended architecture (decision needed — see §5)

| Layer | Recommendation | Why |
|---|---|---|
| Frontend / API / DB / queue | keep this repository's stack | built, deployed, tested |
| Facebook + Instagram publishing, comments, private replies | keep the native adapters | already stricter than the alternatives; no extra service |
| TikTok, LinkedIn, YouTube, X, Threads | add through **Social SDK direct adapters** behind the existing contract; **Postiz as an optional provider** (like Zernio) for anyone who runs it | no new mandatory infrastructure |
| Comment → DM | keep native; port OpenReply features listed above | one app, both Meta login paths |
| Ads | build `meta-ads` native adapter (read first), porting from Agentic Ads Studio's Meta service; keep the confirmation gate; add guardrail policy (daily / total caps, change %, hours, kill switch) | one auth, one audit log |
| AI | OpenRouter only; agents with explicit tool permissions; every call logged with a correlation id | cost policy |
| Workflow UI | React Flow (this phase) | MIT, no service |
| Activepieces, Chatwoot, Garage, Temporal, Redis | not deployed | avoid competing schedulers and idle services |

This keeps the recurring costs to OpenRouter + ad spend + hosting, and keeps Zernio and Postiz as
opt-in providers behind the same interface.

## 5. Decisions the owner has to take

| # | Decision | Options | Consequence |
|---|---|---|---|
| 1 | Publishing engine | **A (recommended):** native + Social SDK, Postiz optional · **B:** Postiz as default, as the prompt says | B needs an always-on server (my estimate: 4 GB RAM or more for Postiz + Temporal + Elasticsearch) and replaces the working Facebook/Instagram path |
| 2 | Comment → DM | **A (recommended):** keep native, port features · **B:** deploy OpenReply | B adds Redis, a second login, loses Facebook Pages |
| 3 | Ads | **A (recommended):** native TypeScript adapter ported from the reference · **B:** run Agentic Ads Studio as a Python service | B adds a service, a second auth, paid Gemini/Fal.ai unless removed |
| 4 | Hosting | Vercel (eligible plan) + Supabase as today · or one VPS with Docker Compose | Vercel Hobby is not allowed for commercial multi-client use; a VPS is needed for option 1B/2B |
| 5 | Tenancy | organizations + roles now (Phase 1) or after the first real Meta connection | touches every query; best done before more features |

Still blocking every real-provider verification, regardless of the above: **the Meta app** (App ID +
App secret at Connections → Meta setup) and the first real account connection.

## 6. What Phase 0 delivered in code
- Branch `unified-platform`.
- One diagram source (`packages/core/src/architecture/diagrams.ts`) → five Mermaid files in
  `docs/architecture/` (test keeps them in sync) and the interactive **Architecture & Workflows**
  page (`/architecture`, React Flow).
- Live node status from real records (`status.ts`, `/api/architecture/status`) — no simulated health.
- Execution traces for real posts and real comments (`runs.ts`, `/api/architecture/runs`).
- Documentation set under `docs/architecture`, `docs/integrations`, `docs/deployment`.
