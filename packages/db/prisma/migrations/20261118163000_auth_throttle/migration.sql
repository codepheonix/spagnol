-- Sign-in throttle shared across server instances.
-- Rollback: DROP TABLE "AuthThrottle"; (it only holds short-lived counters)
CREATE TABLE "AuthThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("key")
);

-- Every table must have row level security on (see 20261118160000_lock_data_api); a test enforces it.
ALTER TABLE "AuthThrottle" ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "AuthThrottle" FROM %I', r);
    END IF;
  END LOOP;
END $$;
