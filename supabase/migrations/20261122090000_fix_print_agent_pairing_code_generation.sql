-- Repair pairing-code generation without changing the RPC signature or grants.
--
-- The deployed implementation keeps a 16-character pairing code, but its
-- translate() call maps only 16 hexadecimal source characters to 16 symbols.
-- Preserve the 16-character UX while selecting from all 32 symbols: 16 x 5
-- bits gives 80 bits of entropy. Since 256 is divisible by 32, modulo mapping
-- one random byte per character introduces no distribution bias.

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
  v_random bytea := gen_random_bytes(16);
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

  -- Sixteen characters, each selected uniformly from the full 32-symbol alphabet.
  for v_index in 0..15 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_random, v_index) % 32) + 1, 1);
  end loop;

  insert into public.print_agent_credentials(property_id, name, pairing_code_hash, pairing_expires_at, created_by)
  values (p_property_id, v_name, md5(v_code), v_expires, auth.uid())
  returning id into v_id;

  return query select v_id, v_code, v_expires;
end;
$$;

notify pgrst, 'reload schema';

commit;
