-- New properties must create their own private POS access PIN during setup.
-- Existing properties retain their already-created credentials and may rotate them
-- from the POS access screen. The reset RPC remains owner/admin-authorized.
create or replace function public.fn_seed_property_pos_access_pin()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  -- Intentionally do not seed the shared default PIN (1234) for new properties.
  -- The property owner/admin creates the first PIN through fn_reset_pos_access_pin.
  return new;
end;
$$;

revoke all on function public.fn_seed_property_pos_access_pin() from public, anon, authenticated;
