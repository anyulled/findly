-- Exercise first load, partial recovery, and existing owner data under RLS.

begin;
insert into auth.users (id, email) values
  ('35000000-0000-4000-8000-000000000001', 'bootstrap-owner@example.invalid');
insert into public.accounts (id, owner_id, managed_account_key, name, account_type, voice_prompt, networks)
values (
  '35000000-0000-4000-8000-000000000002',
  '35000000-0000-4000-8000-000000000001',
  'personal',
  'Personal',
  'personal',
  'Owner-edited voice prompt',
  array['LinkedIn']
);
insert into public.account_buffer_channels (owner_id, account_id, network, buffer_channel_id)
values ('35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000002', 'LinkedIn', 'existing-channel');
select set_config('request.jwt.claim.sub', '35000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.ensure_managed_accounts();
select public.ensure_managed_accounts();
do $$
begin
  if (select count(*) from public.accounts where owner_id = '35000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Repeated bootstrap did not leave exactly three managed accounts';
  end if;
  if not exists (
    select 1 from public.accounts
    where owner_id = '35000000-0000-4000-8000-000000000001'
      and managed_account_key = 'personal'
      and voice_prompt = 'Owner-edited voice prompt'
      and networks = array['LinkedIn']
  ) then
    raise exception 'Bootstrap overwrote pre-existing account configuration';
  end if;
  if not exists (
    select 1 from public.account_buffer_channels
    where owner_id = '35000000-0000-4000-8000-000000000001'
      and account_id = '35000000-0000-4000-8000-000000000002'
      and buffer_channel_id = 'existing-channel'
  ) then
    raise exception 'Bootstrap changed an existing Buffer channel';
  end if;
end;
$$;
delete from public.accounts
where owner_id = '35000000-0000-4000-8000-000000000001'
  and managed_account_key = 'barcelona_jug';
select public.ensure_managed_accounts();
do $$
begin
  if (select count(*) from public.accounts where owner_id = '35000000-0000-4000-8000-000000000001') <> 3 then
    raise exception 'Retry after a partial bootstrap did not restore exactly three accounts';
  end if;
end;
$$;
reset role;
rollback;
