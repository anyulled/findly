-- Manual events may not have an external event page.
alter table public.events alter column event_url drop not null;

-- Approval and style-example creation are one transaction. The function runs
-- with the caller's privileges, so the existing owner RLS policies still apply.
create or replace function public.approve_post(p_post_id uuid, p_content text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  approved_post record;
begin
  if length(btrim(p_content)) = 0 then
    raise exception 'Post content cannot be empty';
  end if;

  update public.posts
  set content = p_content,
      status = 'approved',
      approved_at = now()
  where id = p_post_id
    and owner_id = (select auth.uid())
    and status = 'review'
  returning id, owner_id, account_id, network, language, content
  into approved_post;

  if not found then
    raise exception 'Post is missing, inaccessible, or no longer awaiting review';
  end if;

  insert into public.style_examples (owner_id, post_id, account_id, network, language, content)
  values (
    approved_post.owner_id,
    approved_post.id,
    approved_post.account_id,
    approved_post.network,
    approved_post.language,
    approved_post.content
  );
end;
$$;

revoke all on function public.approve_post(uuid, text) from public, anon;
grant execute on function public.approve_post(uuid, text) to authenticated;

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
    and status in ('review', 'approved')
  returning id into updated_post_id;

  if not found then
    raise exception 'Post is missing, inaccessible, or cannot be edited';
  end if;

  update public.style_examples
  set content = p_content
  where post_id = updated_post_id
    and owner_id = (select auth.uid());
end;
$$;

revoke all on function public.update_post_content(uuid, text) from public, anon;
grant execute on function public.update_post_content(uuid, text) to authenticated;
