alter table public.accounts
  add column managed_account_key text
  check (managed_account_key in ('personal', 'barcelona_jug', 'software_crafters_barcelona'));

update public.accounts
set managed_account_key = case lower(btrim(name))
  when 'personal' then 'personal'
  when 'alex · personal' then 'personal'
  when 'barcelona jug' then 'barcelona_jug'
  when 'barcelonajs' then 'barcelona_jug'
  when 'software crafters barcelona' then 'software_crafters_barcelona'
  when 'devbcn' then 'software_crafters_barcelona'
  else null
end;

create temporary table _managed_account_merge on commit drop as
with ranked as (
  select
    id,
    owner_id,
    managed_account_key,
    first_value(id) over (
      partition by owner_id, managed_account_key
      order by created_at, id
    ) as survivor_id
  from public.accounts
  where managed_account_key is not null
)
select id, owner_id, managed_account_key, survivor_id, id <> survivor_id as is_duplicate
from ranked;

do $$
declare
  conflicts text;
begin
  select string_agg(problem, E'\n') into conflicts
  from (
    select format(
      'account configuration: owner=%s key=%s fields=%s',
      owner_id,
      managed_account_key,
      concat_ws(', ',
        case when count(distinct account_type) > 1 then 'account_type' end,
        case when count(distinct nullif(voice_prompt, '')) > 1 then 'voice_prompt' end,
        case when count(distinct nullif(buffer_profile_id, '')) > 1 then 'buffer_profile_id' end,
        case when count(distinct networks) > 1 then 'networks' end,
        case when count(distinct enabled) > 1 then 'enabled' end
      )
    ) as problem
    from public.accounts
    where managed_account_key is not null
    group by owner_id, managed_account_key
    having count(*) > 1 and (
      count(distinct account_type) > 1
      or count(distinct nullif(voice_prompt, '')) > 1
      or count(distinct nullif(buffer_profile_id, '')) > 1
      or count(distinct networks) > 1
      or count(distinct enabled) > 1
    )

    union all

    select format(
      'Buffer channel: owner=%s key=%s network=%s channel_ids=%s',
      channel.owner_id,
      merge.managed_account_key,
      channel.network,
      string_agg(distinct channel.buffer_channel_id, ', ' order by channel.buffer_channel_id)
    )
    from public.account_buffer_channels as channel
    join _managed_account_merge as merge
      on merge.owner_id = channel.owner_id and merge.id = channel.account_id
    where merge.managed_account_key is not null
    group by channel.owner_id, merge.managed_account_key, channel.network
    having count(distinct channel.buffer_channel_id) > 1

    union all

    select format(
      'posts: owner=%s event=%s key=%s network=%s lead_days=%s post_ids=%s',
      post.owner_id,
      post.event_id,
      merge.managed_account_key,
      post.network,
      post.lead_days,
      string_agg(post.id::text, ', ' order by post.id)
    )
    from public.posts as post
    join _managed_account_merge as merge
      on merge.owner_id = post.owner_id and merge.id = post.account_id
    where merge.managed_account_key is not null
    group by post.owner_id, post.event_id, merge.managed_account_key, post.network, post.lead_days
    having count(*) > 1
  ) as issues;

  if conflicts is not null then
    raise exception 'Managed account reconciliation requires a manual decision:%', E'\n' || conflicts
      using hint = 'Resolve the listed duplicate configuration, Buffer channel, or post rows without deleting data, then retry this migration.';
  end if;
end;
$$;

-- Duplicate associations represent the same source-to-managed-account link.
insert into public.source_accounts (owner_id, source_id, account_id, created_at)
select link.owner_id, link.source_id, merge.survivor_id, min(link.created_at)
from public.source_accounts as link
join _managed_account_merge as merge
  on merge.owner_id = link.owner_id and merge.id = link.account_id
where merge.is_duplicate
group by link.owner_id, link.source_id, merge.survivor_id
on conflict (owner_id, source_id, account_id)
do update set created_at = least(public.source_accounts.created_at, excluded.created_at);

delete from public.source_accounts as link
using _managed_account_merge as merge
where merge.is_duplicate
  and link.owner_id = merge.owner_id
  and link.account_id = merge.id;

-- A channel mapping can move only when the survivor has no mapping for that
-- network, or when both duplicate rows have the same channel ID (preflighted).
insert into public.account_buffer_channels (owner_id, account_id, network, buffer_channel_id, created_at, updated_at)
select channel.owner_id, merge.survivor_id, channel.network, channel.buffer_channel_id,
  min(channel.created_at), max(channel.updated_at)
from public.account_buffer_channels as channel
join _managed_account_merge as merge
  on merge.owner_id = channel.owner_id and merge.id = channel.account_id
where merge.is_duplicate
group by channel.owner_id, merge.survivor_id, channel.network, channel.buffer_channel_id
on conflict (owner_id, account_id, network)
do update set
  created_at = least(public.account_buffer_channels.created_at, excluded.created_at),
  updated_at = greatest(public.account_buffer_channels.updated_at, excluded.updated_at);

delete from public.account_buffer_channels as channel
using _managed_account_merge as merge
where merge.is_duplicate
  and channel.owner_id = merge.owner_id
  and channel.account_id = merge.id;

update public.posts as post
set account_id = merge.survivor_id
from _managed_account_merge as merge
where merge.is_duplicate
  and post.owner_id = merge.owner_id
  and post.account_id = merge.id;

update public.style_examples as example
set account_id = merge.survivor_id
from _managed_account_merge as merge
where merge.is_duplicate
  and example.owner_id = merge.owner_id
  and example.account_id = merge.id;

update public.accounts as survivor
set name = case merge.managed_account_key
      when 'personal' then 'Personal'
      when 'barcelona_jug' then 'Barcelona JUG'
      when 'software_crafters_barcelona' then 'Software Crafters Barcelona'
    end,
    voice_prompt = coalesce(nullif(survivor.voice_prompt, ''), (
      select nullif(candidate.voice_prompt, '')
      from public.accounts as candidate
      where candidate.owner_id = survivor.owner_id
        and candidate.managed_account_key = survivor.managed_account_key
        and candidate.id <> survivor.id
      order by candidate.created_at, candidate.id
      limit 1
    ), ''),
    buffer_profile_id = coalesce(nullif(survivor.buffer_profile_id, ''), (
      select nullif(candidate.buffer_profile_id, '')
      from public.accounts as candidate
      where candidate.owner_id = survivor.owner_id
        and candidate.managed_account_key = survivor.managed_account_key
        and candidate.id <> survivor.id
      order by candidate.created_at, candidate.id
      limit 1
    )),
    networks = survivor.networks
from _managed_account_merge as merge
where not merge.is_duplicate
  and survivor.id = merge.survivor_id;

delete from public.accounts as account
using _managed_account_merge as merge
where merge.is_duplicate
  and account.id = merge.id
  and account.owner_id = merge.owner_id;

alter table public.accounts
  add constraint accounts_owner_managed_account_key_key unique (owner_id, managed_account_key);

create or replace function public.ensure_managed_accounts()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_owner_id uuid := (select auth.uid());
begin
  if current_owner_id is null then
    raise exception 'An authenticated owner is required to prepare managed accounts';
  end if;

  insert into public.accounts (
    owner_id, managed_account_key, name, account_type, voice_prompt, networks
  ) values
    (current_owner_id, 'personal', 'Personal', 'personal', 'Cercano, curioso y directo. Primera persona. Evita sonar promocional.', array['LinkedIn', 'X', 'Bluesky']),
    (current_owner_id, 'barcelona_jug', 'Barcelona JUG', 'association', 'Comunidad tecnológica abierta. Entusiasta, inclusiva y concreta.', array['LinkedIn', 'X']),
    (current_owner_id, 'software_crafters_barcelona', 'Software Crafters Barcelona', 'association', 'Tono profesional y acogedor. Destaca la comunidad y el aprendizaje.', array['LinkedIn', 'Bluesky'])
  on conflict (owner_id, managed_account_key) do nothing;
end;
$$;

revoke all on function public.ensure_managed_accounts() from public, anon;
grant execute on function public.ensure_managed_accounts() to authenticated;
