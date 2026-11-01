-- Owner isolation, immutable submitted states and regeneration protection.
begin;
insert into auth.users (id,email) values
 ('10000000-aaaa-4000-8000-000000000001','discard-owner@example.invalid'),
 ('10000000-aaaa-4000-8000-000000000002','discard-other@example.invalid');
insert into public.accounts (id,owner_id,name) values
 ('20000000-aaaa-4000-8000-000000000001','10000000-aaaa-4000-8000-000000000001','Personal'),
 ('20000000-aaaa-4000-8000-000000000002','10000000-aaaa-4000-8000-000000000002','Personal');
insert into public.events (id,owner_id,title,starts_at,detected_language) values
 ('30000000-aaaa-4000-8000-000000000001','10000000-aaaa-4000-8000-000000000001','Event','2099-01-01 19:00+00','en'),
 ('30000000-aaaa-4000-8000-000000000002','10000000-aaaa-4000-8000-000000000002','Other','2099-01-01 19:00+00','en');
insert into public.posts (id,owner_id,event_id,account_id,network,lead_days,due_at,language,content,status) values
 ('40000000-aaaa-4000-8000-000000000001','10000000-aaaa-4000-8000-000000000001','30000000-aaaa-4000-8000-000000000001','20000000-aaaa-4000-8000-000000000001','LinkedIn',14,'2098-12-18 12:00+00','en','Private draft','review'),
 ('40000000-aaaa-4000-8000-000000000002','10000000-aaaa-4000-8000-000000000001','30000000-aaaa-4000-8000-000000000001','20000000-aaaa-4000-8000-000000000001','LinkedIn',7,'2098-12-25 12:00+00','en','Scheduled','scheduled'),
 ('40000000-aaaa-4000-8000-000000000003','10000000-aaaa-4000-8000-000000000001','30000000-aaaa-4000-8000-000000000001','20000000-aaaa-4000-8000-000000000001','LinkedIn',1,'2098-12-31 12:00+00','en','Uncertain','needs_reconciliation'),
 ('40000000-aaaa-4000-8000-000000000004','10000000-aaaa-4000-8000-000000000002','30000000-aaaa-4000-8000-000000000002','20000000-aaaa-4000-8000-000000000002','LinkedIn',14,'2098-12-18 12:00+00','en','Other owner','review');
select set_config('request.jwt.claim.sub','10000000-aaaa-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
 if public.discard_review_post('40000000-aaaa-4000-8000-000000000002') or public.discard_review_post('40000000-aaaa-4000-8000-000000000003') or public.discard_review_post('40000000-aaaa-4000-8000-000000000004') then raise exception 'Discarded a protected post'; end if;
 if not public.discard_review_post('40000000-aaaa-4000-8000-000000000001') then raise exception 'Review draft was not discarded'; end if;
 if public.discard_review_post('40000000-aaaa-4000-8000-000000000001') then raise exception 'Discarded twice'; end if;
 if not exists (select 1 from public.posts where id='40000000-aaaa-4000-8000-000000000001' and status='discarded' and content='') then raise exception 'Draft content was retained'; end if;
 begin
   perform public.approve_post('40000000-aaaa-4000-8000-000000000001','Attempted approval');
   raise exception 'Discarded draft was approved';
 exception when raise_exception then
   if sqlerrm = 'Discarded draft was approved' then raise; end if;
 end;
 if exists (select 1 from public.claim_post_for_scheduling('40000000-aaaa-4000-8000-000000000001','10000000-aaaa-4000-8000-000000000001')) then raise exception 'Discarded draft was claimed'; end if;
end;
$$;
-- Generation uses this exact unique conflict target with ignoreDuplicates.
insert into public.posts (owner_id,event_id,account_id,network,lead_days,due_at,language,content,status)
values ('10000000-aaaa-4000-8000-000000000001','30000000-aaaa-4000-8000-000000000001','20000000-aaaa-4000-8000-000000000001','LinkedIn',14,'2098-12-18 12:00+00','en','Regenerated','review')
on conflict (event_id,account_id,network,lead_days) do nothing;
do $$ begin
 if (select count(*) from public.posts where event_id='30000000-aaaa-4000-8000-000000000001' and lead_days=14) <> 1 or not exists (select 1 from public.posts where id='40000000-aaaa-4000-8000-000000000001' and status='discarded' and content='') then raise exception 'Discarded reminder regenerated'; end if;
end $$;
rollback;
