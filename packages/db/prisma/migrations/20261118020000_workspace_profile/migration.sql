-- Workspace profile: a Brand row is a workspace (personal, business, or a client company).
-- Additive only: existing rows keep working and default to "business".
ALTER TABLE "Brand" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'business';
ALTER TABLE "Brand" ADD COLUMN "industry" TEXT;
ALTER TABLE "Brand" ADD COLUMN "country" TEXT;
ALTER TABLE "Brand" ADD COLUMN "description" TEXT;
ALTER TABLE "Brand" ADD COLUMN "brandVoice" TEXT;
ALTER TABLE "Brand" ADD COLUMN "targetAudience" TEXT;
ALTER TABLE "Brand" ADD COLUMN "logoUrl" TEXT;
