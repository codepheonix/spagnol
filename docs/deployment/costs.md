# Cost inventory (nothing hidden)

Intended recurring payments: **OpenRouter usage** and **the advertiser's own ad spend**. Everything
else below is either zero today or an unavoidable infrastructure cost that must be stated.

| Item | Today | When it changes | Notes |
|---|---|---|---|
| OpenRouter | pay per token; owner's cap $100 / month | — | off until a key is saved |
| Ad spend | advertiser's Meta ad account, billed by Meta | — | never passes through this app |
| Meta / Instagram APIs | free | — | App Review and Business Verification cost time, not money |
| Hosting — web app | Vercel | **Vercel Hobby is for personal, non-commercial use**: serving paying clients needs Pro (about $20 / month per seat) or self-hosting | stated in Vercel's terms |
| Database + storage | Supabase free tier (500 MB DB, 1 GB files, pauses after a week idle) | Pro about $25 / month when files or uptime guarantees are needed | Reels will outgrow 1 GB |
| Self-hosting alternative | one VPS, roughly €5–10 / month for this app alone | 4 GB RAM class (roughly €8–20 / month) if Postiz + Temporal are added | plus your time for updates and backups |
| Own hardware | electricity, a reliable line with a public HTTPS endpoint, backups off-site | — | "free" only if downtime is acceptable |
| Domain | optional, about €10–15 / year | needed for a branded URL and for Meta app review | — |
| E-mail delivery (dealer hand-off, invites) | not built | free tiers exist (a few thousand e-mails / month) | — |
| Zernio | **off** | per connected account if switched on ($6 each after the first two) | opt-in page shows this warning |
| Canva | not integrated | free, or Pro about €12 / month for brand-template autofill | optional |
| WhatsApp | not used | Meta per-message fees if ever enabled | optional |
| Generative video / image models | not integrated | need paid APIs or a GPU server; no free equivalent exists | disabled until deliberately configured |
| Postiz, OpenReply, Temporal, Redis | not deployed | software is free; they need the bigger server above | see audit §5 |

Figures are indicative list prices on 18 Nov 2026; check the provider before committing.
