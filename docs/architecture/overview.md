# Architecture overview

One web application (`apps/web`, Next.js) with its API routes, a PostgreSQL database, a durable job
queue in that database, and provider adapters behind one contract. Background work runs without a
browser: a database cron calls `/api/jobs/tick` every minute (or `apps/worker` runs always-on).

The five diagrams are defined once in `packages/core/src/architecture/diagrams.ts`:

| Diagram | Mermaid file | Interactive view |
|---|---|---|
| A — System architecture | `system.mmd` | `/architecture` tab A |
| B — Account connection | `account-connections.mmd` | tab B |
| C — Publishing and learning | `publishing-learning.mmd` | tab C (follow a real post) |
| D — Paid advertising | `advertising.mmd` | tab D |
| E — Comments, DMs and leads | `messaging-leads.mmd` | tab E (follow a real comment) |

Rules:
- Run `pnpm diagrams` after editing the source; a test fails if the `.mmd` files are stale.
- Every node declares its `state` (implemented, partial, planned, optional, external, candidate).
  Planned and candidate nodes have no live probe and are always shown as Disabled.
- When a service interface changes, update the node (service, link, probe) in the same commit.

Live status (`packages/core/src/architecture/status.ts`) is computed at request time from the
system's own records: `Job`, `PublishAttempt`, `PostTarget`, `WebhookEvent`, `PrivateReply`,
`SocialAccount`, `SystemSetting` (last tick, configured credentials — names only), `AuditLog`.
Statuses: Healthy, Running, Waiting, Needs approval, Warning, Failed, Disabled.

Execution traces (`runs.ts`) map one stored run onto its diagram: a post (targets + publish attempts)
on diagram C, a handled comment (`PrivateReply`) on diagram E. Stages are completed / in progress /
failed / skipped; a stage the system does not have is always "skipped".

Not yet covered by traces: account connections (B) and advertising (D) — they have no per-run record
with stages yet. Correlation ids across API request → job → provider call are planned (Phase 8);
today the join keys are the job id, the publish-attempt idempotency key and the provider request id.
