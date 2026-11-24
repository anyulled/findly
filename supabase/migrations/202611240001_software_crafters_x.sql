-- Add the connected X profile without replacing existing networks or channels.
update public.accounts
set networks = array_append(networks, 'X')
where managed_account_key = 'software_crafters_barcelona'
  and not (networks @> array['X']);

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
    (current_owner_id, 'software_crafters_barcelona', 'Software Crafters Barcelona', 'association', 'Tono profesional y acogedor. Destaca la comunidad y el aprendizaje.', array['LinkedIn', 'Bluesky', 'X'])
  on conflict (owner_id, managed_account_key) do nothing;
end;
$$;
