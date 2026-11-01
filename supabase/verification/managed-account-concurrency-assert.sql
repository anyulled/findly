do $$
begin
  if (select count(*) from public.accounts where owner_id = '35000000-0000-4000-8000-000000000003') <> 3 then
    raise exception 'Concurrent bootstrap calls did not leave exactly three accounts';
  end if;
end;
$$;

drop trigger test_pause_managed_account_bootstrap on public.accounts;
drop function public.test_pause_managed_account_bootstrap();
delete from auth.users where id = '35000000-0000-4000-8000-000000000003';
