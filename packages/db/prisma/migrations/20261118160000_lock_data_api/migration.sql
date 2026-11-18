-- Lock the database's public data API.
--
-- On Supabase every table in `public` is reachable over HTTP by the `anon` and `authenticated`
-- roles unless (a) those roles have no privilege on it and (b) row level security is on.
-- Before this migration only (a) protected the tables, and one table (PrivateReply) had been
-- created with the platform's default grants, so it was readable and writable from outside.
--
-- After it:
--   * row level security is ON for every table, with no policy = nothing is visible or writable
--     to any role except the table owner (the application's own database role) — even if a grant
--     is added by mistake later;
--   * `anon` and `authenticated` hold no privilege on any table, sequence or function here;
--   * tables created later by the migration role start without those grants.
--
-- The application connects as the table owner, so its queries are unaffected. Workspace isolation
-- between users is enforced in the application layer (owner checks on every query, covered by
-- tests); this migration closes the path that bypassed the application altogether.
--
-- Roles that do not exist (a plain PostgreSQL used for development) are skipped.
-- Rollback: packages/db/prisma/rollback/20261118160000_lock_data_api.down.sql
DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
