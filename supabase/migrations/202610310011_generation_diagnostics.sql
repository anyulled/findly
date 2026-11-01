-- Existing drafts have unknown provenance; only new generations are labelled.
alter table public.posts
  add column generation_origin text check (generation_origin in ('groq', 'fallback')),
  add column generation_error_code text check (generation_error_code in ('not_configured', 'provider_error', 'provider_auth', 'rate_limited', 'empty_response', 'over_limit', 'output_truncated')),
  add constraint posts_generation_diagnostic_consistent check (
    generation_error_code is null or generation_origin is not distinct from 'fallback'
  );
