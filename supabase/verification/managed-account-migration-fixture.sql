insert into auth.users (id, email) values
  ('35000000-0000-4000-8000-000000000010', 'legacy-bootstrap@example.invalid'),
  ('35000000-0000-4000-8000-000000000020', 'unmanaged-bootstrap@example.invalid');
insert into public.accounts (id, owner_id, name, account_type, voice_prompt, networks, enabled, created_at) values
  ('35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000010', 'Personal', 'personal', 'same prompt', array['LinkedIn','X','Bluesky'], true, '2026-10-01'),
  ('35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000010', 'Alex · Personal', 'personal', 'same prompt', array['LinkedIn','X','Bluesky'], true, '2026-10-02'),
  ('35000000-0000-4000-8000-000000000013', '35000000-0000-4000-8000-000000000010', 'Barcelona JUG', 'association', 'jug prompt', array['LinkedIn','X'], true, '2026-10-01'),
  ('35000000-0000-4000-8000-000000000014', '35000000-0000-4000-8000-000000000010', 'BarcelonaJS', 'association', 'jug prompt', array['LinkedIn','X'], true, '2026-10-02'),
  ('35000000-0000-4000-8000-000000000015', '35000000-0000-4000-8000-000000000010', 'Software Crafters Barcelona', 'association', 'crafters prompt', array['LinkedIn','Bluesky'], true, '2026-10-01'),
  ('35000000-0000-4000-8000-000000000016', '35000000-0000-4000-8000-000000000010', 'DevBcn', 'association', 'crafters prompt', array['LinkedIn','Bluesky'], true, '2026-10-02'),
  ('35000000-0000-4000-8000-000000000021', '35000000-0000-4000-8000-000000000020', 'Owner custom account', 'association', 'custom', array['X'], true, '2026-10-01');
insert into public.sources (id, owner_id, name, source_type, feed_url) values
  ('35000000-0000-4000-8000-000000000030', '35000000-0000-4000-8000-000000000010', 'Legacy feed', 'luma_ical', 'https://example.invalid/feed.ics');
insert into public.source_accounts (owner_id, source_id, account_id) values
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000030', '35000000-0000-4000-8000-000000000011'),
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000030', '35000000-0000-4000-8000-000000000012');
insert into public.account_buffer_channels (owner_id, account_id, network, buffer_channel_id) values
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000011', 'LinkedIn', 'personal-linkedin'),
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000012', 'LinkedIn', 'personal-linkedin'),
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000012', 'X', 'personal-x'),
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000014', 'LinkedIn', 'jug-linkedin'),
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000016', 'Bluesky', 'crafters-bluesky');
insert into public.events (id, owner_id, title, starts_at, detected_language) values
  ('35000000-0000-4000-8000-000000000031', '35000000-0000-4000-8000-000000000010', 'Legacy event', '2026-12-01 18:00+00', 'en');
insert into public.posts (id, owner_id, event_id, account_id, network, lead_days, due_at, language, content, status) values
  ('35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000031', '35000000-0000-4000-8000-000000000011', 'LinkedIn', 14, '2026-11-17 12:00+00', 'en', 'Post one', 'approved'),
  ('35000000-0000-4000-8000-000000000042', '35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000031', '35000000-0000-4000-8000-000000000012', 'X', 7, '2026-11-24 12:00+00', 'en', 'Post two', 'review');
insert into public.style_examples (owner_id, post_id, account_id, network, language, content) values
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000011', 'LinkedIn', 'en', 'Example one'),
  ('35000000-0000-4000-8000-000000000010', '35000000-0000-4000-8000-000000000042', '35000000-0000-4000-8000-000000000012', 'X', 'en', 'Example two');

insert into auth.users (id, email) values
  ('35000000-0000-4000-8000-000000000050', 'collision-bootstrap@example.invalid');
insert into public.accounts (id, owner_id, name, account_type, buffer_profile_id, voice_prompt, networks, enabled) values
  ('35000000-0000-4000-8000-000000000051', '35000000-0000-4000-8000-000000000050', 'Personal', 'personal', 'profile-a', 'voice-a', array['LinkedIn'], true),
  ('35000000-0000-4000-8000-000000000052', '35000000-0000-4000-8000-000000000050', 'Alex · personal', 'association', 'profile-b', 'voice-b', array['X'], false);
insert into public.events (id, owner_id, title, starts_at, detected_language) values
  ('35000000-0000-4000-8000-000000000053', '35000000-0000-4000-8000-000000000050', 'Collision event', '2026-12-01 18:00+00', 'en');
insert into public.posts (id, owner_id, event_id, account_id, network, lead_days, due_at, language, content) values
  ('35000000-0000-4000-8000-000000000054', '35000000-0000-4000-8000-000000000050', '35000000-0000-4000-8000-000000000053', '35000000-0000-4000-8000-000000000051', 'LinkedIn', 14, '2026-11-17 12:00+00', 'en', 'Conflicting post one'),
  ('35000000-0000-4000-8000-000000000055', '35000000-0000-4000-8000-000000000050', '35000000-0000-4000-8000-000000000053', '35000000-0000-4000-8000-000000000052', 'LinkedIn', 14, '2026-11-17 12:00+00', 'en', 'Conflicting post two');
insert into public.account_buffer_channels (owner_id, account_id, network, buffer_channel_id) values
  ('35000000-0000-4000-8000-000000000050', '35000000-0000-4000-8000-000000000051', 'LinkedIn', 'channel-a'),
  ('35000000-0000-4000-8000-000000000050', '35000000-0000-4000-8000-000000000052', 'LinkedIn', 'channel-b');
