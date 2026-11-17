create or replace function public.fn_employee_permission_codes(p_property_id uuid, p_staff_id uuid default null)
returns text[] language plpgsql stable security definer set search_path=public
as $function$
declare
  v_staff public.staff;
  v_codes text[] := '{}'::text[];
  v_role_codes text[] := '{}'::text[];
  v_grant_codes text[] := '{}'::text[];
  v_assigned text[] := '{}'::text[];
begin
  if auth.uid() is null or not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then return '{}'::text[]; end if;
  if public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin') then
    return array(select code from public.employee_permission_codes order by sort_order);
  end if;
  select s.* into v_staff from public.staff s
  where s.id=coalesce(p_staff_id,public.current_staff_id(p_property_id))
    and s.property_id=p_property_id and s.is_active=true
    and (s.user_id=auth.uid()
      or lower(coalesce(s.email,''))=lower(coalesce((select email from auth.users where id=auth.uid()),''))
      or s.id=public.current_staff_id(p_property_id))
  limit 1;
  if v_staff.id is null then return '{}'::text[]; end if;
  v_assigned:=coalesce(v_staff.assigned_modules,'{}'::text[]);
  if v_staff.role_id is not null then
    select coalesce(r.permission_codes,'{}'::text[]) into v_role_codes
    from public.employee_roles r where r.id=v_staff.role_id and r.property_id=p_property_id;
    if not found then v_role_codes:='{}'::text[]; end if;
  else
    v_role_codes:=case v_staff.role
      when 'super_admin' then array(select code from public.employee_permission_codes)
      when 'hotel_admin' then array(select code from public.employee_permission_codes)
      when 'front_office_manager' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment']
      when 'receptionist' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment','pos.access']
      when 'front_desk' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','pos.access']
      when 'pos_staff' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'waiter' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'cashier' then array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      when 'store_manager' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      when 'housekeeping_supervisor' then array['front_office.access']
      else '{}'::text[] end;
  end if;
  select coalesce(array_agg(distinct c.code),'{}'::text[]) into v_codes from public.employee_permission_codes c
  where c.code=any(coalesce(v_role_codes,'{}'::text[])) and c.workspace=any(v_assigned);
  select coalesce(array_agg(distinct g.permission_code),'{}'::text[]) into v_grant_codes
  from public.module_access_grants g join public.employee_permission_codes c on c.code=g.permission_code
  where g.property_id=p_property_id and g.staff_id=v_staff.id and g.revoked_at is null
    and g.expires_at>now() and c.workspace=any(v_assigned);
  return (select coalesce(array_agg(distinct x.code),'{}'::text[])
    from unnest(coalesce(v_codes,'{}'::text[])||coalesce(v_grant_codes,'{}'::text[])) as x(code));
end;
$function$;
notify pgrst,'reload schema';
