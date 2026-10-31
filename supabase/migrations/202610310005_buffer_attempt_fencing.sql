-- A persisted attempt identity prevents a late response from finishing a newer claim.
alter table public.posts add column scheduling_attempt_id uuid;

-- The return shape changes, so PostgreSQL requires dropping the old function.
drop function public.claim_post_for_scheduling(uuid, uuid);
create function public.claim_post_for_scheduling(p_post_id uuid, p_owner_id uuid)
returns table (id uuid, account_id uuid, network text, due_at timestamptz, content text, attempt_id uuid)
language sql
security invoker
set search_path = ''
as $$
  update public.posts as post
  set status = 'scheduling', last_error = null, scheduling_attempt_id = pg_catalog.gen_random_uuid()
  where post.id = p_post_id and post.owner_id = p_owner_id
    and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
    and post.status in ('approved', 'failed') and post.buffer_post_id is null
  returning post.id, post.account_id, post.network, post.due_at, post.content, post.scheduling_attempt_id;
$$;
revoke all on function public.claim_post_for_scheduling(uuid, uuid) from public, anon;
grant execute on function public.claim_post_for_scheduling(uuid, uuid) to authenticated, service_role;

-- Remove the unfenced signatures so old calls cannot finish a different attempt.
drop function public.mark_post_scheduled(uuid, text, uuid);
drop function public.mark_post_scheduling_failure(uuid, text, boolean, uuid);
create function public.mark_post_scheduled(p_post_id uuid, p_buffer_post_id text, p_owner_id uuid, p_attempt_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if p_buffer_post_id is null or length(btrim(p_buffer_post_id)) = 0 or p_attempt_id is null then
    raise exception 'Buffer post ID and scheduling attempt are required';
  end if;
  update public.posts
  set status = 'scheduled', buffer_post_id = p_buffer_post_id, last_error = null
  where id = p_post_id and owner_id = p_owner_id
    and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
    and status = 'scheduling' and scheduling_attempt_id = p_attempt_id;
  if not found then
    -- The owner may have confirmed this same post in Buffer while its response
    -- was still in flight. A matching response is harmless and idempotent.
    if exists (select 1 from public.posts where id = p_post_id and owner_id = p_owner_id
      and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
      and status = 'scheduled' and scheduling_attempt_id = p_attempt_id and buffer_post_id = p_buffer_post_id) then
      return;
    end if;
    raise exception 'Post is not held by this scheduling attempt';
  end if;
end;
$$;

create function public.mark_post_scheduling_failure(
  p_post_id uuid, p_error text, p_needs_reconciliation boolean, p_owner_id uuid, p_attempt_id uuid
)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  update public.posts
  set status = case when p_needs_reconciliation then 'needs_reconciliation' else 'failed' end,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'Buffer scheduling failed.'), 500)
  where id = p_post_id and owner_id = p_owner_id
    and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
    and status = 'scheduling' and p_attempt_id is not null and scheduling_attempt_id = p_attempt_id;
  if not found then raise exception 'Post is not held by this scheduling attempt'; end if;
end;
$$;
revoke all on function public.mark_post_scheduled(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.mark_post_scheduling_failure(uuid, text, boolean, uuid, uuid) from public, anon;
grant execute on function public.mark_post_scheduled(uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.mark_post_scheduling_failure(uuid, text, boolean, uuid, uuid) to authenticated, service_role;

-- An active attempt can never be released on an absence check. Only a settled,
-- uncertain attempt can be reconciled as missing and become retryable.
create or replace function public.reconcile_post_missing(p_post_id uuid, p_owner_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  update public.posts
  set status = 'failed', last_error = 'Owner checked Buffer and confirmed no matching post was found.'
  where id = p_post_id and owner_id = p_owner_id and (select auth.uid()) = p_owner_id
    and status = 'needs_reconciliation' and buffer_post_id is null;
  if not found then raise exception 'Post is not awaiting reconciliation'; end if;
end;
$$;
revoke all on function public.reconcile_post_missing(uuid, uuid) from public, anon;
grant execute on function public.reconcile_post_missing(uuid, uuid) to authenticated;
