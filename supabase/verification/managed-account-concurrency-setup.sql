insert into auth.users (id, email) values
  ('35000000-0000-4000-8000-000000000003', 'bootstrap-concurrent@example.invalid');

create function public.test_pause_managed_account_bootstrap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id = '35000000-0000-4000-8000-000000000003' then
    perform pg_catalog.pg_sleep(0.25);
  end if;
  return new;
end;
$$;

create trigger test_pause_managed_account_bootstrap
before insert on public.accounts
for each row execute function public.test_pause_managed_account_bootstrap();
