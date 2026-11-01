-- Keep the reminder identity as a tombstone so completing reminders cannot recreate it.
alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('review','approved','scheduling','scheduled','published','failed','needs_reconciliation','discarded'));

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
    and status = 'review'
    and approved_at is null
    and buffer_post_id is null
    and scheduling_attempt_id is null;
  return found;
end;
$$;

revoke all on function public.discard_review_post(uuid) from public, anon;
grant execute on function public.discard_review_post(uuid) to authenticated;
