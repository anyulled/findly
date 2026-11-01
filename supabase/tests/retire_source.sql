-- Retiring an imported source keeps events and posts, disables the source and
-- is isolated per owner; a physical delete stays blocked by the events FK.
begin;
insert into auth.users (id,email) values
 ('10000000-bbbb-4000-8000-000000000001','retire-owner@example.invalid'),
 ('10000000-bbbb-4000-8000-000000000002','retire-other@example.invalid');
insert into public.accounts (id,owner_id,name) values
 ('20000000-bbbb-4000-8000-000000000001','10000000-bbbb-4000-8000-000000000001','Personal');
insert into public.sources (id,owner_id,name,source_type,feed_url) values
 ('50000000-bbbb-4000-8000-000000000001','10000000-bbbb-4000-8000-000000000001','Imported','luma_ical','https://example.invalid/a.ics');
insert into public.events (id,owner_id,source_id,external_id,title,starts_at,event_url) values
 ('30000000-bbbb-4000-8000-000000000001','10000000-bbbb-4000-8000-000000000001','50000000-bbbb-4000-8000-000000000001','ext-1','Event','2099-01-01 19:00+00','https://example.invalid/e');
insert into public.posts (id,owner_id,event_id,account_id,network,lead_days,due_at,language,content) values
 ('40000000-bbbb-4000-8000-000000000001','10000000-bbbb-4000-8000-000000000001','30000000-bbbb-4000-8000-000000000001','20000000-bbbb-4000-8000-000000000001','LinkedIn',14,'2098-12-18 12:00+00','en','Draft');
select set_config('request.jwt.claim.sub','10000000-bbbb-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 if public.retire_source('50000000-bbbb-4000-8000-000000000001') then raise exception 'Another owner retired the source'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-bbbb-4000-8000-000000000001',true);
do $$ begin
 begin
   delete from public.sources where id='50000000-bbbb-4000-8000-000000000001';
   raise exception 'Imported source was physically deleted';
 exception when foreign_key_violation then null;
 end;
 if not public.retire_source('50000000-bbbb-4000-8000-000000000001') then raise exception 'Source was not retired'; end if;
 if not exists (select 1 from public.sources where id='50000000-bbbb-4000-8000-000000000001' and enabled=false and archived_at is not null) then raise exception 'Source is not archived and disabled'; end if;
 if not exists (select 1 from public.events where id='30000000-bbbb-4000-8000-000000000001' and source_id='50000000-bbbb-4000-8000-000000000001') then raise exception 'Event lost its source'; end if;
 if not exists (select 1 from public.posts where id='40000000-bbbb-4000-8000-000000000001') then raise exception 'Post was lost'; end if;
 if not public.retire_source('50000000-bbbb-4000-8000-000000000001') then raise exception 'Retiring twice failed'; end if;
end $$;
rollback;
