-- Save a source and its account links as one operation. This keeps source
-- configuration from being left half-written if an account does not belong
-- to the signed-in owner.
create or replace function public.save_source(
  p_source_id uuid,
  p_name text,
  p_source_type text,
  p_feed_url text,
  p_enabled boolean,
  p_account_ids uuid[]
)
returns table (
  id uuid,
  name text,
  source_type text,
  feed_url text,
  enabled boolean,
  account_ids uuid[]
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_source_id uuid := p_source_id;
  v_account_count integer;
begin
  if v_owner_id is null then
    raise exception 'Authentication is required';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Source name must contain 1 to 120 characters';
  end if;
  if p_source_type is null or p_source_type not in ('luma_ical', 'meetup') then
    raise exception 'Unsupported source type';
  end if;
  if p_feed_url is null or length(btrim(p_feed_url)) not between 1 and 2000 then
    raise exception 'Source URL is required';
  end if;
  if p_account_ids is null or cardinality(p_account_ids) = 0 then
    raise exception 'At least one account must be associated';
  end if;
  if p_enabled is null then
    raise exception 'Source enabled state is required';
  end if;

  select count(distinct account.id)::integer
    into v_account_count
    from public.accounts as account
    where account.owner_id = v_owner_id
      and account.id = any(p_account_ids);
  if v_account_count <> cardinality(p_account_ids) then
    raise exception 'One or more accounts are unavailable';
  end if;

  if v_source_id is null then
    insert into public.sources (owner_id, name, source_type, feed_url, enabled)
    values (v_owner_id, btrim(p_name), p_source_type, btrim(p_feed_url), p_enabled)
    returning public.sources.id into v_source_id;
  else
    update public.sources as source
      set name = btrim(p_name), source_type = p_source_type, feed_url = btrim(p_feed_url), enabled = p_enabled
      where source.id = v_source_id and source.owner_id = v_owner_id;
    if not found then
      raise exception 'Source is missing or inaccessible';
    end if;
  end if;

  delete from public.source_accounts as link
    where link.owner_id = v_owner_id and link.source_id = v_source_id;
  insert into public.source_accounts (owner_id, source_id, account_id)
    select v_owner_id, v_source_id, selected.account_id
    from unnest(p_account_ids) as selected(account_id);

  return query
    select source.id, source.name, source.source_type, source.feed_url, source.enabled,
      array_agg(link.account_id order by link.account_id)
    from public.sources as source
    join public.source_accounts as link
      on link.owner_id = source.owner_id and link.source_id = source.id
    where source.id = v_source_id and source.owner_id = v_owner_id
    group by source.id;
end;
$$;

revoke all on function public.save_source(uuid, text, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.save_source(uuid, text, text, text, boolean, uuid[]) to authenticated;
