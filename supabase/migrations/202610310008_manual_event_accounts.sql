-- NULL preserves the previous behavior for existing events and imported sources.
-- New manual events always persist at least one explicit account.
alter table public.events
  add column target_account_ids uuid[]
  check (target_account_ids is null or (cardinality(target_account_ids) between 1 and 3 and array_position(target_account_ids, null) is null));
