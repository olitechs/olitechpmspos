-- Repair pairing-code generation without changing the RPC signature or grants.
--
-- PostgreSQL translate() maps only the 16 hexadecimal source characters in
-- the original implementation. The original "32-symbol alphabet" therefore
-- produced only 16 possible symbols per character. Generate each character
-- directly from one random byte instead; 256 is divisible by 32, so modulo
-- mapping introduces no distribution bias.

begin;

-- Remove the obsolete reversed-argument overload if an older deployment has it.
-- The application uses the canonical (uuid, text) signature with named arguments.
drop function if exists public.fn_create_print_agent_pairing(text, uuid);

create or replace function public.fn_create_print_agent_pairing(
  p_property_id uuid,
  p_name text
) returns table(credential_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text := coalesce(nullif(btrim(p_name), ''), 'POS computer');
  v_code text := '';
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_id uuid;
  v_expires timestamptz := now() + interval '10 minutes';
  v_index integer;
begin
  if p_property_id is null then
    raise exception 'Property id is required.' using errcode = '22023';
  end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.is_hotel_admin(p_property_id)
  ) then
    raise exception 'Only a manager can pair a print workstation.' using errcode = '42501';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'Workstation name is too long.' using errcode = '22023';
  end if;

  -- Eight characters, each selected uniformly from the full 32-symbol alphabet.
  for v_index in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1);
  end loop;

  insert into public.print_agent_credentials(property_id, name, pairing_code_hash, pairing_expires_at, created_by)
  values (p_property_id, v_name, md5(v_code), v_expires, auth.uid())
  returning id into v_id;

  return query select v_id, v_code, v_expires;
end;
$$;

notify pgrst, 'reload schema';

commit;
