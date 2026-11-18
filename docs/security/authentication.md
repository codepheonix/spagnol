# Authentication and account security

How an account is protected, where the code is, and how each rule is proven. Status words are the
tracker's (`implementation-tracker.md`): nothing here is called "production verified" without a
check against the live deployment.

## Passwords

| Rule | Where | Proven by |
|---|---|---|
| At least 12 characters; no common passwords, keyboard or character runs, or passwords built from the account's name or e-mail | `checkPasswordStrength` — `packages/core/src/account-security.ts` | `account-security.test.ts` "password rules" |
| Not a password this account used before, and not one recorded as exposed (`PasswordHistory`, hashes only, last 24) | `wasUsedBefore`, `denyPasswordReuse` | "an exposed password forces a change…" |
| Not in known breach lists (Pwned Passwords, k-anonymity: only the first 5 characters of a SHA-1 leave the server). If the service cannot be reached the check is skipped, never blocks | `breachCount` | same test, with a stubbed service |
| Stored only as scrypt hashes (N=16384, r=8, p=1, random salt) | `packages/security/src/crypto.ts` | `packages/security` tests |
| A change needs the current password and signs out every other browser | `changePassword`, `POST /api/auth/password` | "a successful change signs every other session out…" |
| A password whose history is unknown must be replaced: one set before changes were recorded, one provisioned through the environment on a real deployment, or one marked exposed. Until then every page redirects to `/account/password` and every API route answers 403 `password_change_required` | `passwordChangeOwed`, `accountGate`, `requireUser`, `apiSession` | unit test + browser journey |

The owner's password was typed into a chat. It is treated as compromised by the rule above — the
live account predates change tracking, so its next sign-in can do nothing except choose a new
password, inside the app, over TLS. Nobody else sees the new password, and the two short passwords
that were shared fail the length rule and can never be chosen again.

## Two-factor sign-in (TOTP)

- Standard time-based codes (RFC 6238) through `otplib`; no custom cryptography. Any authenticator
  app works.
- Set-up (`/account/security`): a new secret is shown once as a QR code (rendered as an image) and
  as text; nothing changes on the account until the first correct code. The secret is stored
  encrypted with the same AES-256-GCM key as provider tokens.
- A code works once: the time step of the last accepted code is stored, and the same or an older
  step is refused, including from another browser.
- Ten recovery codes are shown once at set-up and stored only as SHA-256 hashes. Each works once.
  New codes need a current authenticator code and replace the old ones.
- Turning two-factor off needs the password **and** a second factor. A stolen password alone
  cannot remove it. After turning it off the account has 24 hours to set it up again.
- Deadline: choosing a password starts a 7-day period to turn two-factor on (new owners get the
  same from first-run setup). After the deadline only `/account/security` opens.
- Sign-in with two-factor: the password step creates a 10-minute session that opens nothing — no
  page, no API route, not even the session list — until `POST /api/auth/mfa` accepts a code.

Passkeys (WebAuthn) are not built. They need a separate credential store and a registration
ceremony per device; they are tracked as a later item, not claimed.

## Password reset

- `/forgot` → `POST /api/auth/forgot`: always the same answer, whether or not the address exists.
  Limits: 5 requests per network address per 15 minutes, 3 links per account per hour.
- The link carries a random token; only its hash is stored. It works once, for 30 minutes.
  A refused new password (too weak, reused) does not burn the link.
- If the account has two-factor sign-in, the reset page also asks for an authenticator or recovery
  code: a stolen mailbox is not enough.
- A completed reset signs out every browser.

**Blocker (owner decision):** no e-mail service is connected, and none was added because that
would be a new paid subscription. `packages/core/src/mailer.ts` is provider-neutral; with
`MAIL_PROVIDER` unset nothing is sent and the pages say so. The whole flow is tested with the
in-memory `test` provider.

**Owner recovery without e-mail:** `docs/security/owner-recovery.sql`, run in the Supabase SQL
editor by someone with database administrator access. It prints one single-use link and does not
bypass the second factor. A separate, commented block removes two-factor for one account when the
authenticator and all recovery codes are lost. Tested end to end in the browser journey.

## Sessions

- Cookie `sm_session`: HttpOnly, Secure, SameSite=Lax, a signed token that names a database row.
  Deleting the row ends the session at once.
- Ends after 12 hours without use and after 7 days at most (`sessionIsLive`).
- `/account/security` lists every live session (browser, network address, signed in, last used)
  and ends one or all others. A session id of another account answers "not found".
- Sensitive changes need the password (and second factor) entered within the last 10 minutes:
  saving API keys or webhook secrets, provider app credentials, activating a campaign draft,
  resuming a campaign. The route answers 403 `reauth_required` and the page sends the user to
  `/account/confirm`.

## Sign-in attack prevention

- Failed attempts are counted in the database (`AuthThrottle`), never in server memory.
- Limits: 5 per e-mail + address per 15 minutes; 20 per address per 15 minutes; 50 per account per
  hour. Each repeated block lasts twice as long as the one before, up to 16 times.
- A browser that has signed in to the account before carries a cookie that exempts it from the
  account-wide limit only, so an attacker cannot lock the owner out by hammering the address.
- Wrong two-factor codes count against the same limits.
- The answer never reveals whether an address exists. A new-device sign-in and a blocked burst of
  attempts each create a notification.
- `?next=` after sign-in accepts only a path on this site (`safeNext`).

## What is not done

- No CAPTCHA or bot challenge (needs a third-party service; rate limits are the control today).
- No passkeys. No e-mail delivery. No per-user notification routing (single owner today).
- Sign-in notices appear in the app only; there is no e-mail or push channel.
