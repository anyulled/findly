-- Allow 'openai' as generation_origin in posts
alter table public.posts
  drop constraint if exists posts_generation_origin_check;

alter table public.posts
  add constraint posts_generation_origin_check
  check (generation_origin in ('groq', 'openai', 'fallback'));

-- Table for tracking individual LLM invocation attempts
create table public.llm_generation_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('groq', 'openai', 'fallback')),
  model text not null,
  status text not null check (status in ('success', 'error')),
  error_code text,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table public.llm_generation_logs enable row level security;

-- Performance-optimized RLS policy (using SELECT wrapper for auth.uid() per best practices)
create policy "Owner manages llm generation logs" on public.llm_generation_logs
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Indexes for performance
create index llm_generation_logs_owner_created_idx
  on public.llm_generation_logs(owner_id, created_at desc);

create index llm_generation_logs_owner_provider_idx
  on public.llm_generation_logs(owner_id, provider, created_at desc);
