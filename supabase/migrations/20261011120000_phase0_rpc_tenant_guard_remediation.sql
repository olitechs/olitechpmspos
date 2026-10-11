-- Forward remediation drafted during Phase 0 audit.
-- IMPORTANT: this is a NEW migration, not a reconstruction of any historical ledger entry.
-- Review and test in a disposable/local test database before applying to any shared environment.
-- Addresses confirmed cross-tenant authorization gaps found during read-only audit.

begin;

-- Prevent an authenticated caller from reading another property's POS menu by
-- supplying an arbitrary property UUID to a SECURITY DEFINER RPC.
create or replace function public.fn_list_pos_menu(p_property_id uuid)
returns table(
  id uuid,
  sku text,
  name text,
  category text,
  unit text,
  current_stock numeric,
  min_stock numeric,
  selling_price numeric,
  production_center text,
  pos_sort integer
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if p_property_id is null then
    raise exception 'Property id is required.'
      using errcode = '22023';
  end if;

  if not (
    public.is_platform_owner()
    or public.is_member_of_property(p_property_id)
  ) then
    raise exception 'Not authorized to access this property menu.'
      using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.sku,
    p.name,
    coalesce(nullif(p.pos_category, ''), p.category),
    p.unit,
    p.current_stock,
    p.min_stock,
    p.selling_price,
    p.production_center,
    p.pos_sort
  from public.products p
  where p.property_id = p_property_id
    and p.pos_enabled = true
    and p.pos_active = true
  order by coalesce(nullif(p.pos_category, ''), p.category), p.pos_sort, p.name;
end;
$function$;

-- Ensure pending-property creation cannot be invoked for an arbitrary user's ID
-- by an ordinary authenticated caller. Preserve trusted service-role workflows.
create or replace function public.create_pending_property_for_user(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_business_name text default null
)
returns public.properties
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_property public.properties;
  v_name text;
begin
  if p_user_id is null then
    raise exception 'User id is required.' using errcode = '22023';
  end if;

  if auth.uid() is distinct from p_user_id
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to create a property for another user.'
      using errcode = '42501';
  end if;

  select p.* into v_property
  from public.properties p
  join public.property_users pu on pu.property_id = p.id
  where pu.user_id = p_user_id and pu.role = 'owner'
  order by p.created_at desc
  limit 1;

  if found then
    return v_property;
  end if;

  v_name := coalesce(
    nullif(trim(p_business_name), ''),
    nullif(trim(p_full_name), '') || '''s Property',
    'New Property'
  );

  insert into public.properties
    (name, business_name, created_by, email, contact_person, status, package)
  values
    (v_name,
     nullif(trim(p_business_name), ''),
     p_user_id,
     nullif(trim(p_email), ''),
     nullif(trim(p_full_name), ''),
     'pending',
     'none')
  returning * into v_property;

  insert into public.property_users (property_id, user_id, role)
  values (v_property.id, p_user_id, 'owner');

  return v_property;
exception
  when unique_violation then
    select p.* into v_property
    from public.properties p
    join public.property_users pu on pu.property_id = p.id
    where pu.user_id = p_user_id and pu.role = 'owner'
    order by p.created_at desc
    limit 1;
    if found then
      return v_property;
    end if;
    raise;
end;
$function$;

-- Preserve intended application access; this migration does not broadly revoke
-- EXECUTE from unrelated SECURITY DEFINER functions.
revoke all on function public.fn_list_pos_menu(uuid) from public, anon;
grant execute on function public.fn_list_pos_menu(uuid) to authenticated;

revoke all on function public.create_pending_property_for_user(uuid, text, text, text) from public, anon;
grant execute on function public.create_pending_property_for_user(uuid, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
