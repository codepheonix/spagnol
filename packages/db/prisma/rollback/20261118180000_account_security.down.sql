-- Rollback for 20261118180000_account_security. Deploy the previous application version first:
-- the current one reads these columns. Two-factor secrets, recovery codes, reset links and the
-- password reuse list are lost; accounts and their passwords are untouched.
DROP TABLE IF EXISTS "PasswordResetToken";
DROP TABLE IF EXISTS "RecoveryCode";
DROP TABLE IF EXISTS "PasswordHistory";
ALTER TABLE "AuthThrottle" DROP COLUMN IF EXISTS "blocks";
ALTER TABLE "Session" DROP COLUMN IF EXISTS "mfaAt", DROP COLUMN IF EXISTS "reauthAt", DROP COLUMN IF EXISTS "lastSeenAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "mfaGraceUntil", DROP COLUMN IF EXISTS "mustChangePassword", DROP COLUMN IF EXISTS "passwordChangedAt",
                   DROP COLUMN IF EXISTS "totpLastStep", DROP COLUMN IF EXISTS "totpEnabledAt", DROP COLUMN IF EXISTS "totpPendingEnc";
DELETE FROM _prisma_migrations WHERE migration_name = '20261118180000_account_security';
