-- Buffer channel IDs are specific to each managed social account and network.
create table public.account_buffer_channels (
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  network text not null check (network in ('LinkedIn','X','Bluesky')),
  buffer_channel_id text not null check (length(btrim(buffer_channel_id)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, account_id, network),
  foreign key (owner_id, account_id) references public.accounts(owner_id,id) on delete cascade
);

create trigger account_buffer_channels_updated_at
before update on public.account_buffer_channels
for each row execute function public.set_updated_at();

alter table public.account_buffer_channels enable row level security;
create policy "Owner manages Buffer channel mappings"
  on public.account_buffer_channels for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- `scheduling` is a durable claim: a second request cannot submit the same post.
-- If a process stops after Buffer accepted the mutation, the claim remains and
-- must be reconciled rather than blindly retried.
alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('review','approved','scheduling','scheduled','published','failed','needs_reconciliation'));

create or replace function public.claim_post_for_scheduling(p_post_id uuid, p_owner_id uuid)
returns table (id uuid, account_id uuid, network text, due_at timestamptz, content text)
language sql
security invoker
set search_path = ''
as $$
  update public.posts as post
  set status = 'scheduling', last_error = null
  where post.id = p_post_id
    and post.owner_id = p_owner_id
    and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
    and post.status in ('approved','failed')
    and post.buffer_post_id is null
  returning post.id, post.account_id, post.network, post.due_at, post.content;
$$;

create or replace function public.mark_post_scheduled(p_post_id uuid, p_buffer_post_id text, p_owner_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if length(btrim(p_buffer_post_id)) = 0 then
    raise exception 'Buffer post ID cannot be empty';
  end if;
  update public.posts
  set status = 'scheduled', buffer_post_id = p_buffer_post_id, last_error = null
  where id = p_post_id and owner_id = p_owner_id
    and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
    and status = 'scheduling';
  if not found then raise exception 'Post is not held for scheduling'; end if;
end;
$$;

create or replace function public.mark_post_scheduling_failure(
  p_post_id uuid,
  p_error text,
  p_needs_reconciliation boolean,
  p_owner_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.posts
  set status = case when p_needs_reconciliation then 'needs_reconciliation' else 'failed' end,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'Buffer scheduling failed.'), 500)
  where id = p_post_id and owner_id = p_owner_id
    and ((select auth.uid()) = p_owner_id or current_user = 'service_role')
    and status = 'scheduling';
  if not found then raise exception 'Post is not held for scheduling'; end if;
end;
$$;

revoke all on function public.claim_post_for_scheduling(uuid, uuid) from public, anon;
revoke all on function public.mark_post_scheduled(uuid, text, uuid) from public, anon;
revoke all on function public.mark_post_scheduling_failure(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.claim_post_for_scheduling(uuid, uuid) to authenticated, service_role;
grant execute on function public.mark_post_scheduled(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.mark_post_scheduling_failure(uuid, text, boolean, uuid) to authenticated, service_role;

-- Rejected posts may be edited and retried. Posts with uncertain outcomes stay
-- locked in `needs_reconciliation` and cannot be edited or resubmitted here.
create or replace function public.update_post_content(p_post_id uuid, p_content text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_post_id uuid;
begin
  if length(btrim(p_content)) = 0 then
    raise exception 'Post content cannot be empty';
  end if;

  update public.posts
  set content = p_content
  where id = p_post_id
    and owner_id = (select auth.uid())
    and status in ('review', 'approved', 'failed')
  returning id into updated_post_id;

  if not found then raise exception 'Post is missing, inaccessible, or cannot be edited'; end if;

  update public.style_examples
  set content = p_content
  where post_id = updated_post_id and owner_id = (select auth.uid());
end;
$$;

revoke all on function public.update_post_content(uuid, text) from public, anon;
grant execute on function public.update_post_content(uuid, text) to authenticated;

create or replace function public.reconcile_post_scheduled(p_post_id uuid, p_buffer_post_id text, p_owner_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if length(btrim(p_buffer_post_id)) = 0 then
    raise exception 'Buffer post ID cannot be empty';
  end if;
  update public.posts
  set status = 'scheduled', buffer_post_id = btrim(p_buffer_post_id), last_error = null
  where id = p_post_id
    and owner_id = p_owner_id
    and (select auth.uid()) = p_owner_id
    and status in ('needs_reconciliation','scheduling')
    and buffer_post_id is null;
  if not found then raise exception 'Post is not awaiting reconciliation'; end if;
end;
$$;

revoke all on function public.reconcile_post_scheduled(uuid, text, uuid) from public, anon;
grant execute on function public.reconcile_post_scheduled(uuid, text, uuid) to authenticated;

create or replace function public.reconcile_post_missing(p_post_id uuid, p_owner_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.posts
  set status = 'failed', last_error = 'Owner checked Buffer and confirmed no matching post was found.'
  where id = p_post_id
    and owner_id = p_owner_id
    and (select auth.uid()) = p_owner_id
    and status in ('needs_reconciliation','scheduling')
    and buffer_post_id is null;
  if not found then raise exception 'Post is not awaiting reconciliation'; end if;
end;
$$;

revoke all on function public.reconcile_post_missing(uuid, uuid) from public, anon;
grant execute on function public.reconcile_post_missing(uuid, uuid) to authenticated;
