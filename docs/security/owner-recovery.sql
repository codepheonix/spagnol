-- Owner account recovery when no e-mail service is connected.
--
-- Who can run this: only someone with administrator access to the database (the Supabase SQL
-- editor). That access is the proof of ownership; the app itself offers no way around sign-in.
--
-- What it does: creates one password-reset link for one account. The link works once, for 30
-- minutes. Only a hash of it is stored. If the account has two-factor sign-in, the reset page
-- also asks for an authenticator code or a recovery code — this file does not remove that.
--
-- How: replace the two placeholders, run it once, open the link it prints, choose a password.

with t as (
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as token
), ins as (
  insert into "PasswordResetToken" (id, "userId", "tokenHash", "expiresAt", "requestedIp")
  select gen_random_uuid()::text, u.id, encode(sha256(convert_to(t.token, 'utf8')), 'hex'),
         (now() at time zone 'utc') + interval '30 minutes', 'owner-recovery'
  from "User" u, t
  where u.email = lower('OWNER_EMAIL_HERE')
  returning 1
)
select 'https://YOUR-HOST-HERE/reset?token=' || t.token as open_this_link_once
from t, ins;

-- Lost the authenticator app AND every recovery code? Then, and only then, run the block below
-- (remove the leading dashes). It turns two-factor sign-in off for that one account, signs every
-- browser out, and gives the account 24 hours to set two-factor up again. Afterwards use the
-- link above to choose a new password.
--
-- update "User" set "totpSecretEnc" = null, "totpPendingEnc" = null, "totpEnabledAt" = null, "totpLastStep" = null,
--                   "mfaGraceUntil" = (now() at time zone 'utc') + interval '24 hours'
--  where email = lower('OWNER_EMAIL_HERE');
-- delete from "RecoveryCode" where "userId" = (select id from "User" where email = lower('OWNER_EMAIL_HERE'));
-- delete from "Session"      where "userId" = (select id from "User" where email = lower('OWNER_EMAIL_HERE'));
