-- Rollback for 20261118160000_lock_data_api. Run by hand only if the application's own role is
-- blocked by row level security (it should not be: the owner of a table is exempt).
-- It turns row level security off again; it deliberately does NOT give `anon` / `authenticated`
-- their privileges back — no part of the application uses them.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;
-- then: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261118160000_lock_data_api';
