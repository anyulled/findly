-- Run with psql ON_ERROR_STOP against a disposable database after all migrations.
-- The transaction is rolled back so the script is safe to repeat locally and in CI.
begin;
insert into auth.users (id, email) values ('33000000-0000-0000-0000-000000000001', 'issue33@example.invalid');
insert into public.accounts (id, owner_id, name) values
  ('33000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000001', 'Personal');
insert into public.events (id, owner_id, title, starts_at, detected_language) values
  ('33000000-0000-0000-0000-000000000003', '33000000-0000-0000-0000-000000000001', 'Test event', now() + interval '30 days', 'en');
insert into public.posts (id, owner_id, event_id, account_id, network, lead_days, due_at, language, content, status) values
  ('33000000-0000-0000-0000-000000000004', '33000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000003', '33000000-0000-0000-0000-000000000002', 'LinkedIn', 7, now() + interval '7 days', 'en', 'Test post', 'approved'),
  ('33000000-0000-0000-0000-000000000005', '33000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000003', '33000000-0000-0000-0000-000000000002', 'X', 7, now() + interval '7 days', 'en', 'Second test post', 'approved'),
  ('33000000-0000-0000-0000-000000000006', '33000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000003', '33000000-0000-0000-0000-000000000002', 'Bluesky', 7, now() + interval '7 days', 'en', 'Cron post', 'approved');
select set_config('request.jwt.claim.sub', '33000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $$
declare
  owner_id constant uuid := '33000000-0000-0000-0000-000000000001';
  post_id constant uuid := '33000000-0000-0000-0000-000000000004';
  confirmed_post_id constant uuid := '33000000-0000-0000-0000-000000000005';
  first_attempt uuid;
  second_attempt uuid;
  confirmed_attempt uuid;
  error_seen boolean := false;
begin
  select attempt_id into first_attempt from public.claim_post_for_scheduling(post_id, owner_id);
  if first_attempt is null then raise exception 'First claim failed'; end if;
  begin
    perform public.reconcile_post_missing(post_id, owner_id);
  exception when raise_exception then error_seen := true;
  end;
  if not error_seen then raise exception 'Active attempt was incorrectly released'; end if;
  if exists (select 1 from public.claim_post_for_scheduling(post_id, owner_id)) then
    raise exception 'A second claim was accepted while the first is active';
  end if;

  perform public.mark_post_scheduling_failure(post_id, 'timeout', true, owner_id, first_attempt);
  perform public.reconcile_post_missing(post_id, owner_id);
  select attempt_id into second_attempt from public.claim_post_for_scheduling(post_id, owner_id);
  if second_attempt is null or second_attempt = first_attempt then raise exception 'Retry did not receive a new attempt ID'; end if;
  error_seen := false;
  begin
    perform public.mark_post_scheduled(post_id, 'stale-buffer-id', owner_id, first_attempt);
  exception when raise_exception then error_seen := true;
  end;
  if not error_seen then raise exception 'Old success was accepted for a new claim'; end if;
  error_seen := false;
  begin
    perform public.mark_post_scheduling_failure(post_id, 'stale failure', false, owner_id, first_attempt);
  exception when raise_exception then error_seen := true;
  end;
  if not error_seen then raise exception 'Old failure was accepted for a new claim'; end if;
  perform public.mark_post_scheduled(post_id, 'actual-buffer-id', owner_id, second_attempt);
  if not exists (select 1 from public.posts where id = post_id and status = 'scheduled' and buffer_post_id = 'actual-buffer-id') then
    raise exception 'Current attempt did not persist its result';
  end if;

  -- Confirming an existing Buffer post while its response is pending is safe;
  -- the matching eventual response remains idempotent for the same attempt.
  select attempt_id into confirmed_attempt from public.claim_post_for_scheduling(confirmed_post_id, owner_id);
  perform public.reconcile_post_scheduled(confirmed_post_id, 'confirmed-buffer-id', owner_id);
  perform public.mark_post_scheduled(confirmed_post_id, 'confirmed-buffer-id', owner_id, confirmed_attempt);
end;
$$;

-- The cron importer runs under service_role without an authenticated user.
reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role service_role;
do $$
declare attempt uuid;
begin
  select attempt_id into attempt from public.claim_post_for_scheduling('33000000-0000-0000-0000-000000000006', '33000000-0000-0000-0000-000000000001');
  if attempt is null then raise exception 'Service role could not claim a post'; end if;
  perform public.mark_post_scheduled('33000000-0000-0000-0000-000000000006', 'cron-buffer-id', '33000000-0000-0000-0000-000000000001', attempt);
end;
$$;
rollback;
