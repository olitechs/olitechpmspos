-- Enforce employee workspace assignments as a hard upper bound for every permission.
-- A selected custom role is authoritative even when its permission list is empty.
-- Temporary manager grants cannot expand an employee into an unassigned workspace.

create or replace function public.fn_employee_permission_codes(p_property_id uuid, p_staff_id uuid default null)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_staff public.staff;
  v_codes text[] := '{}'::text[];
  v_role_codes text[] := '{}'::text[];
  v_grant_codes text[] := '{}'::text[];
  v_assigned text[] := '{}'::text[];
begin
  if auth.uid() is null or not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    return '{}'::text[];
  end if;

  if public.property_role(p_property_id) in ('owner','admin') then
    return array(select code from public.employee_permission_codes order by sort_order);
  end if;

  -- A non-admin may only resolve their own active staff identity.
  select s.* into v_staff
  from public.staff s
  where s.id = coalesce(p_staff_id, public.current_staff_id(p_property_id))
    and s.property_id = p_property_id
    and s.is_active = true
    and (
      s.user_id = auth.uid()
      or lower(coalesce(s.email,'')) = lower(coalesce((select email from auth.users where id=auth.uid()),''))
      or s.id = public.current_staff_id(p_property_id)
    )
  limit 1;

  if v_staff.id is null then
    return '{}'::text[];
  end if;

  v_assigned := coalesce(v_staff.assigned_modules, '{}'::text[]);

  -- A selected custom role is authoritative, including an intentionally empty
  -- permission set. Otherwise use the built-in staff role permission map.
  if v_staff.role_id is not null then
    select coalesce(r.permission_codes, '{}'::text[]) into v_role_codes
    from public.employee_roles r
    where r.id = v_staff.role_id and r.property_id = p_property_id;
    if not found then v_role_codes := '{}'::text[]; end if;
  else
    v_role_codes := case v_staff.role
      when 'super_admin' then array(select code from public.employee_permission_codes)
      when 'hotel_admin' then array(select code from public.employee_permission_codes)
      when 'front_office_manager' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment']
      when 'receptionist' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment']
      when 'front_desk' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view']
      when 'pos_staff' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'waiter' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'cashier' then array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      when 'store_manager' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      when 'housekeeping_supervisor' then array['front_office.access']
      else '{}'::text[]
    end;
  end if;

  -- Explicit module assignment is a hard upper bound, never a role fallback.
  select coalesce(array_agg(distinct c.code), '{}'::text[])
    into v_codes
  from public.employee_permission_codes c
  where c.code = any(coalesce(v_role_codes, '{}'::text[]))
    and c.workspace = any(v_assigned);

  -- Temporary grants add only specific permissions inside already assigned modules.
  select coalesce(array_agg(distinct g.permission_code), '{}'::text[])
    into v_grant_codes
  from public.module_access_grants g
  join public.employee_permission_codes c on c.code = g.permission_code
  where g.property_id = p_property_id
    and g.staff_id = v_staff.id
    and g.revoked_at is null
    and g.expires_at > now()
    and c.workspace = any(v_assigned);

  return (
    select coalesce(array_agg(distinct x.code), '{}'::text[])
    from unnest(coalesce(v_codes,'{}'::text[]) || coalesce(v_grant_codes,'{}'::text[])) as x(code)
  );
end;
$function$;

create or replace function public.fn_employee_workspaces(p_property_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(array_agg(distinct c.workspace), '{}'::text[])
  from unnest(public.fn_employee_permission_codes(p_property_id)) as codes(code)
  join public.employee_permission_codes c on c.code = codes.code
  where c.code like '%.access';
$function$;

create or replace function public.fn_employee_has_permission(p_property_id uuid, p_code text, p_staff_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(p_code = any(public.fn_employee_permission_codes(p_property_id, p_staff_id)), false);
$function$;

notify pgrst, 'reload schema';
