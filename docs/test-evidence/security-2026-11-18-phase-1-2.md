# Security evidence — phases 1 and 2 — 18 Nov 2026

What was run, against what, and the result. No secrets, addresses or tokens are recorded here.

| Check | Target | Result |
|---|---|---|
| Automated tests (`pnpm test`): media 4, security 8, integrations 19, core 97 | local Postgres | 128 passed, 0 failed |
| Typecheck (`pnpm typecheck`) and production build | local | clean |
| Dependency advisories (`pnpm audit --prod`) | lockfile of the live commit | No known vulnerabilities |
| Outside-in check (`scripts/security-smoke.mjs`) | production, commit `883c04d` | 47 passed, 0 failed |
| Browser journey — exposed password, rules, change, two-factor set-up, recovery codes, sign-in with second factor, replay, sessions, re-authentication, recovery link, script-policy violations on 11 pages | local production build | 47 passed, 0 failed |
| Owner account held at the password screen (pages, API, two-factor set-up, re-choosing the exposed password, sign-out) | production | 15 passed, 0 failed. Nothing on the account was changed; the session was signed out |
| Preview isolation | preview build of `883c04d` | `/api/health` answers 503: no database is configured for previews; no production secret is in the Preview target |
| Runtime errors after release | production, first 15 minutes | none |

Not verified in production, and why:

- Two-factor enrolment and sign-in with a code: needs the owner's authenticator app.
- Password reset by e-mail: no mail service is connected.
- The rewritten Bluesky adapter against Bluesky itself: no account is connected.
- The scheduler after this release was confirmed from the health probe only from the next release
  on (the probe gained the field in the commit after `883c04d`).
