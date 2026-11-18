# iGerald security master plan

The order of work, what each phase must prove, and where it stands. The detailed, per-task record
is `implementation-tracker.md`. This file changes only when the plan changes.

Rules that apply to every phase: preserve working behaviour; commit in reversible units; back up or
write a rollback before a risky database change; never print a secret; never publish a post, send a
message or start an ad to test security; never call a control working until its test has run.

| Phase | Scope | State |
|---|---|---|
| 0 (done earlier) | Database closed to the public data API, webhook signatures, sign-in return bound to the user, database-backed sign-in limits, script policy and headers, dependency fixes | Production verified 18 Nov 2026 (`README.md`) |
| 1 | Containment: exposed password, preview/production isolation, repository scan, last vulnerable dependency | See tracker |
| 2 | Account security: password rules, two-factor sign-in, recovery, sessions, attack prevention | See tracker |
| 3 | Several users per organization, roles, tenant isolation enforced in the database | Not started |
| 4 | Platform sign-in and webhook hardening (token lifecycle, replay, per-workspace credentials) | Not started |
| 5 | API, browser, upload and infrastructure defence | Partly covered by phase 0; rest not started |
| 6 | AI agent security (prompt injection, tool permissions, data boundaries) | Not started |
| 7 | Advertising and spending safeguards | Read-only by default today; rest not started |
| 8 | Security Center at `/security` | Not started |
| 9 | Automatic scanning and monitoring (CI secret scan, dependency audit, static analysis) | Not started |
| 10 | Backups, restore test, incident response | Not started |
| 11 | Abuse-case test suite and penetration-test readiness | Grows with each phase |
| 12 | Release verification and final report | Per release |
| 13 | Recurring maintenance | Not started |

Order of the remaining work, and why: phase 3 before 4–7 because every later control (per-workspace
credentials, agent permissions, spending limits) is expressed in terms of members and roles; phase 9
early, because the scans protect every later commit; phase 8 after the controls it reports on exist,
so the Security Center shows records and never placeholders.

Nothing in this plan makes the product "unhackable". The aim is that each known attack path has a
control, a test that tries the attack, and evidence of the result.
