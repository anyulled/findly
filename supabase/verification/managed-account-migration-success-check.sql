do $$
begin
  if (select count(*) from public.accounts where owner_id = '35000000-0000-4000-8000-000000000010') <> 3 then
    raise exception 'Legacy aliases did not consolidate to exactly three managed accounts';
  end if;
  if not exists (select 1 from public.accounts where id = '35000000-0000-4000-8000-000000000011' and managed_account_key = 'personal' and name = 'Personal' and voice_prompt = 'same prompt') then
    raise exception 'The deterministic personal survivor or its configuration was not preserved';
  end if;
  if (select count(*) from public.source_accounts where owner_id = '35000000-0000-4000-8000-000000000010' and source_id = '35000000-0000-4000-8000-000000000030' and account_id = '35000000-0000-4000-8000-000000000011') <> 1 then
    raise exception 'Source-account association was not preserved';
  end if;
  if (select count(*) from public.account_buffer_channels where owner_id = '35000000-0000-4000-8000-000000000010') <> 4
    or not exists (select 1 from public.account_buffer_channels where account_id = '35000000-0000-4000-8000-000000000011' and buffer_channel_id = 'personal-x')
    or not exists (select 1 from public.account_buffer_channels where account_id = '35000000-0000-4000-8000-000000000013' and buffer_channel_id = 'jug-linkedin')
    or not exists (select 1 from public.account_buffer_channels where account_id = '35000000-0000-4000-8000-000000000015' and buffer_channel_id = 'crafters-bluesky') then
    raise exception 'Buffer mappings were not preserved during reconciliation';
  end if;
  if (select count(*) from public.posts where owner_id = '35000000-0000-4000-8000-000000000010' and id in ('35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000042') and account_id = '35000000-0000-4000-8000-000000000011') <> 2 then
    raise exception 'Existing posts or their account references were not preserved';
  end if;
  if (select count(*) from public.style_examples where owner_id = '35000000-0000-4000-8000-000000000010' and account_id = '35000000-0000-4000-8000-000000000011' and post_id in ('35000000-0000-4000-8000-000000000041', '35000000-0000-4000-8000-000000000042')) <> 2 then
    raise exception 'Existing style examples or their account references were not preserved';
  end if;
  if not exists (select 1 from public.accounts where id = '35000000-0000-4000-8000-000000000021' and managed_account_key is null and name = 'Owner custom account') then
    raise exception 'An unmanaged account was changed';
  end if;
end;
$$;
