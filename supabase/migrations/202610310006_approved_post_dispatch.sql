-- Approved posts are durable dispatch intents. Select only a bounded batch
-- belonging to the owner and, for imported events, accounts still linked to
-- that source. Claims and Buffer calls remain separate and atomic per post.
create index posts_approved_dispatch_idx
  on public.posts (owner_id, due_at, id) where status = 'approved';

create or replace function public.list_approved_posts_for_dispatch(
  p_owner_id uuid,
  p_event_id uuid default null,
  p_limit integer default 50
)
returns table (id uuid)
language sql
security invoker
set search_path = ''
as $$
  select post.id
  from public.posts as post
  join public.events as event
    on event.owner_id = post.owner_id and event.id = post.event_id
  join public.accounts as account
    on account.owner_id = post.owner_id and account.id = post.account_id
  where account.enabled = true
    and post.owner_id = p_owner_id
    and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
    and post.status = 'approved'
    and post.buffer_post_id is null
    and (p_event_id is null or post.event_id = p_event_id)
    and (event.source_id is null or exists (
      select 1 from public.source_accounts as link
      where link.owner_id = post.owner_id
        and link.source_id = event.source_id
        and link.account_id = post.account_id
    ))
  order by post.due_at, post.id
  limit greatest(1, least(coalesce(p_limit, 50), 50));
$$;

revoke all on function public.list_approved_posts_for_dispatch(uuid, uuid, integer) from public, anon;
grant execute on function public.list_approved_posts_for_dispatch(uuid, uuid, integer) to authenticated, service_role;

-- The claim is the authorization point for dispatch. A source association
-- removed after listing but before the claim must not permit a send. Once a
-- claim has succeeded, later source edits do not revoke an in-flight request.
create or replace function public.claim_post_for_scheduling(p_post_id uuid, p_owner_id uuid)
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
    and exists (
      select 1 from public.events as event
      join public.accounts as account
        on account.owner_id = post.owner_id and account.id = post.account_id
      where event.owner_id = post.owner_id and event.id = post.event_id
        and account.enabled = true
        and (event.source_id is null or exists (
          select 1 from public.source_accounts as link
          where link.owner_id = post.owner_id
            and link.source_id = event.source_id
            and link.account_id = post.account_id
        ))
    )
  returning post.id, post.account_id, post.network, post.due_at, post.content, post.scheduling_attempt_id;
$$;
