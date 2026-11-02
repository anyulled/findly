-- Add custom_scheduled flag to posts table to distinguish user-scheduled posts from queue-slot posts
alter table public.posts
  add column if not exists custom_scheduled boolean not null default false;

-- Function to update post content and optionally scheduled time
create or replace function public.update_post_details(
  p_post_id uuid,
  p_content text,
  p_due_at timestamptz default null
)
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
  set
    content = p_content,
    due_at = coalesce(p_due_at, due_at),
    custom_scheduled = case when p_due_at is not null then true else custom_scheduled end
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

revoke all on function public.update_post_details(uuid, text, timestamptz) from public, anon;
grant execute on function public.update_post_details(uuid, text, timestamptz) to authenticated;
