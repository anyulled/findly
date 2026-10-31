create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;

create table public.app_settings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key = 'publishing_mode'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type text not null default 'association' check (account_type in ('personal','association')),
  buffer_profile_id text,
  voice_prompt text not null default '',
  networks text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id,id),
  check (networks <@ array['LinkedIn','X','Bluesky']::text[])
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('luma_ical','meetup','manual')),
  feed_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id,id)
);

create table public.source_accounts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  account_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (owner_id,source_id,account_id),
  foreign key (owner_id,source_id) references public.sources(owner_id,id) on delete cascade,
  foreign key (owner_id,account_id) references public.accounts(owner_id,id) on delete cascade
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid,
  external_id text,
  title text not null,
  starts_at timestamptz not null,
  timezone text not null default 'Europe/Madrid' check (timezone = 'Europe/Madrid'),
  location text not null default '',
  description text not null default '',
  event_url text not null,
  detected_language text not null default 'en' check (detected_language in ('en','es','ca')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id,id),
  foreign key (owner_id,source_id) references public.sources(owner_id,id),
  unique (owner_id,source_id,external_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  account_id uuid not null,
  network text not null check (network in ('LinkedIn','X','Bluesky')),
  lead_days smallint not null check (lead_days in (14,7,1)),
  due_at timestamptz not null,
  timezone text not null default 'Europe/Madrid' check (timezone = 'Europe/Madrid'),
  language text not null check (language in ('en','es','ca')),
  content text not null,
  status text not null default 'review' check (status in ('review','approved','scheduled','published','failed','needs_reconciliation')),
  buffer_post_id text,
  approved_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id,id),
  foreign key (owner_id,event_id) references public.events(owner_id,id) on delete cascade,
  foreign key (owner_id,account_id) references public.accounts(owner_id,id) on delete cascade,
  unique (event_id,account_id,network,lead_days)
);

create table public.style_examples (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null,
  account_id uuid not null,
  network text not null check (network in ('LinkedIn','X','Bluesky')),
  language text not null check (language in ('en','es','ca')),
  content text not null,
  created_at timestamptz not null default now(),
  foreign key (owner_id,post_id) references public.posts(owner_id,id) on delete cascade,
  foreign key (owner_id,account_id) references public.accounts(owner_id,id) on delete cascade,
  unique (post_id)
);

create index posts_calendar_idx on public.posts(owner_id,due_at);
create index style_examples_lookup_idx on public.style_examples(owner_id,account_id,network,language,created_at desc);

create trigger app_settings_updated_at before update on public.app_settings for each row execute function public.set_updated_at();
create trigger accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger sources_updated_at before update on public.sources for each row execute function public.set_updated_at();
create trigger events_updated_at before update on public.events for each row execute function public.set_updated_at();
create trigger posts_updated_at before update on public.posts for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.accounts enable row level security;
alter table public.sources enable row level security;
alter table public.source_accounts enable row level security;
alter table public.events enable row level security;
alter table public.posts enable row level security;
alter table public.style_examples enable row level security;

create policy "Owner manages app settings" on public.app_settings for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner manages accounts" on public.accounts for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner manages sources" on public.sources for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner manages source account links" on public.source_accounts for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner manages events" on public.events for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner manages posts" on public.posts for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Owner manages style examples" on public.style_examples for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
