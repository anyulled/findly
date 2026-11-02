-- Allow discarding failed posts too (never sent to Buffer, so safe to tombstone).
create or replace function public.discard_review_post(p_post_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.posts
  set status = 'discarded', content = '', last_error = null
  where id = p_post_id
    and owner_id = (select auth.uid())
    and buffer_post_id is null
    and (
      (status = 'review' and approved_at is null and scheduling_attempt_id is null)
      or status = 'failed'
    );
  return found;
end;
$$;

revoke all on function public.discard_review_post(uuid) from public, anon;
grant execute on function public.discard_review_post(uuid) to authenticated;
