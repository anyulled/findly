do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounts' and column_name = 'managed_account_key'
  ) then
    raise exception 'A failed managed-account migration left schema changes behind';
  end if;
  if (select count(*) from public.accounts where owner_id = '35000000-0000-4000-8000-000000000050') <> 2 then
    raise exception 'A failed migration changed or removed conflicting accounts';
  end if;
  if (select count(*) from public.posts where id in ('35000000-0000-4000-8000-000000000054', '35000000-0000-4000-8000-000000000055')) <> 2 then
    raise exception 'A failed migration changed or removed colliding posts';
  end if;
  if (select count(*) from public.account_buffer_channels where owner_id = '35000000-0000-4000-8000-000000000050') <> 2 then
    raise exception 'A failed migration changed or removed conflicting channels';
  end if;
end;
$$;
