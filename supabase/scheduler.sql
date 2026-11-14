-- Every-minute scheduler for the job queue, run by the database itself (free on Supabase).
-- pg_cron fires each minute; pg_net calls the app's tick endpoint, which drains due jobs
-- (scheduled posts, retries, reconciliation). No browser or always-on server is involved.
--
-- The bearer token is generated HERE, inside Postgres: the token lives in Supabase Vault and the
-- app only ever sees its SHA-256 (SystemSetting `jobs.tickTokenHash`), so the secret never leaves
-- the database. Re-running this file is safe (idempotent). To rotate: delete the vault secret
-- `sm_tick_token` and run the file again.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  tok text;
begin
  if not exists (select 1 from vault.secrets where name = 'sm_tick_token') then
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    perform vault.create_secret(tok, 'sm_tick_token', 'Bearer token pg_cron sends to /api/jobs/tick');
    insert into public."SystemSetting" ("key", "value", "encrypted", "updatedAt")
    values ('jobs.tickTokenHash', to_jsonb(encode(sha256(convert_to(tok, 'utf8')), 'hex')), false, now())
    on conflict ("key") do update set "value" = excluded."value", "updatedAt" = now();
  end if;
end $$;

-- cron.schedule with an existing job name replaces that job.
select cron.schedule(
  'sm-job-tick',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://spagnol-social-manager.vercel.app/api/jobs/tick?budgetMs=40000',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sm_tick_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

-- Keep pg_cron's own run history small.
select cron.schedule('sm-cron-history-prune', '17 3 * * *', $job$ delete from cron.job_run_details where end_time < now() - interval '2 days'; $job$);
