-- Retire a source without deleting it. Imported events keep a foreign key to
-- the source for traceability and (owner_id, source_id, external_id)
-- deduplication, so a physical DELETE is rejected once anything was imported.
-- A retired source keeps its events, posts and style examples, is disabled and
-- is excluded from every later synchronisation.
alter table public.sources add column archived_at timestamptz;

create or replace function public.retire_source(p_source_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    raise exception 'Authentication is required';
  end if;
  update public.sources as source
    set enabled = false, archived_at = coalesce(source.archived_at, now())
    where source.id = p_source_id and source.owner_id = v_owner_id;
  return found;
end;
$$;

revoke all on function public.retire_source(uuid) from public, anon;
grant execute on function public.retire_source(uuid) to authenticated;
