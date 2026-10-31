-- Regression for recovery selection: owner isolation, source associations and
-- exclusion of uncertain/in-flight/confirmed posts. No provider is contacted.
begin;
insert into auth.users (id, email) values
 ('11111111-1111-4111-8111-111111111111', 'dispatch-owner@example.invalid'),
 ('22222222-2222-4222-8222-222222222222', 'dispatch-other@example.invalid');
insert into public.accounts (id, owner_id, name) values
 ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Personal'),
 ('10000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Barcelona JUG'),
 ('10000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Disabled'),
 ('20000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Other');
update public.accounts set enabled = false where id = '10000000-0000-4000-8000-000000000003';
insert into public.sources (id, owner_id, name, source_type) values
 ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Luma', 'luma_ical');
insert into public.source_accounts (owner_id, source_id, account_id) values
 ('11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');
insert into public.events (id, owner_id, source_id, title, starts_at, detected_language) values
 ('40000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, 'Manual', '2099-01-01 19:00+00', 'en'),
 ('40000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '30000000-0000-4000-8000-000000000001', 'Luma', '2099-01-01 19:00+00', 'en'),
 ('40000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', null, 'Other', '2099-01-01 19:00+00', 'en');
insert into public.posts (id,owner_id,event_id,account_id,network,lead_days,due_at,language,content,status) values
 ('50000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','LinkedIn',14,'2098-12-18 12:00+00','en','Manual approved','approved'),
 ('50000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','LinkedIn',14,'2098-12-18 12:00+00','en','Luma linked','approved'),
 ('50000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','LinkedIn',14,'2098-12-18 12:00+00','en','Luma unlinked','approved'),
 ('50000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','LinkedIn',7,'2098-12-25 12:00+00','en','Uncertain','needs_reconciliation'),
 ('50000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','LinkedIn',1,'2098-12-31 12:00+00','en','In flight','scheduling'),
 ('50000000-0000-4000-8000-000000000006','22222222-2222-4222-8222-222222222222','40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','LinkedIn',14,'2098-12-18 12:00+00','en','Other owner','approved'),
 ('50000000-0000-4000-8000-000000000007','11111111-1111-4111-8111-111111111111','40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','LinkedIn',14,'2098-12-18 12:00+00','en','Disabled account','approved');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
do $$
declare ids uuid[];
begin
  select array_agg(id order by id) into ids from public.list_approved_posts_for_dispatch('11111111-1111-4111-8111-111111111111', null, 50);
  if ids is distinct from array['50000000-0000-4000-8000-000000000001'::uuid, '50000000-0000-4000-8000-000000000002'::uuid] then
    raise exception 'Incorrect global eligible IDs: %', ids;
  end if;
  select array_agg(id order by id) into ids from public.list_approved_posts_for_dispatch('11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000002', 50);
  if ids is distinct from array['50000000-0000-4000-8000-000000000002'::uuid] then
    raise exception 'Incorrect event eligible IDs: %', ids;
  end if;
  if exists (select 1 from public.list_approved_posts_for_dispatch('22222222-2222-4222-8222-222222222222', null, 50)) then
    raise exception 'Another owner was visible';
  end if;
  if (select count(*) from public.list_approved_posts_for_dispatch('11111111-1111-4111-8111-111111111111', null, 1)) <> 1 then
    raise exception 'Batch limit was not applied';
  end if;
end;
$$;
reset role;
set local role service_role;
do $$
begin
  if (select count(*) from public.list_approved_posts_for_dispatch('11111111-1111-4111-8111-111111111111', null, 50)) <> 2 then
    raise exception 'Service role cannot recover eligible owner posts';
  end if;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  -- Simulate a removal after the approved list was read but before claiming.
  delete from public.source_accounts where source_id = '30000000-0000-4000-8000-000000000001'
    and account_id = '10000000-0000-4000-8000-000000000002';
  if exists (select 1 from public.claim_post_for_scheduling('50000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111')) then
    raise exception 'Unlinked source account was claimed';
  end if;
  if not exists (select 1 from public.claim_post_for_scheduling('50000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111')) then
    raise exception 'Manual event could not be claimed';
  end if;
end;
$$;
rollback;
