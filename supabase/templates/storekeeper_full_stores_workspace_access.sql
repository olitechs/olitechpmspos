-- Grant the built-in Storekeeper the same Stores operational permissions as Store Manager.
-- This intentionally does not grant Back Office or employee-administration permissions.

update public.employee_roles
set permission_codes = array[
  'stores.access',
  'stores.inventory.view',
  'stores.stock.receive',
  'stores.stock.issue',
  'stores.stock.transfer',
  'stores.stock.adjust',
  'stores.suppliers.manage'
]::text[],
    updated_at = now()
where is_system = true
  and lower(btrim(name)) = 'storekeeper';

-- Keep legacy staff records without a role_id working as well.
-- Custom roles remain governed solely by their explicitly assigned permission_codes.
create or replace function public.fn_employee_permission_codes(
  p_property_id uuid,
  p_staff_id uuid default null
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff public.staff;
  v_codes text[];
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    return '{}';
  end if;

  if public.property_role(p_property_id) in ('owner','admin') then
    return array(select code from public.employee_permission_codes order by sort_order);
  end if;

  select * into v_staff
  from public.staff
  where id = coalesce(p_staff_id, public.current_staff_id(p_property_id))
    and property_id = p_property_id
    and is_active = true
  limit 1;

  if v_staff.id is null then
    return '{}';
  end if;

  select coalesce(array_agg(distinct g.permission_code), '{}') into v_codes
  from public.module_access_grants g
  where g.property_id = p_property_id
    and g.staff_id = v_staff.id
    and g.revoked_at is null
    and g.expires_at > now();

  if v_staff.role_id is not null then
    select array(
      select unnest(r.permission_codes)
      union
      select unnest(coalesce(v_codes, '{}'::text[]))
    ) into v_codes
    from public.employee_roles r
    where r.id = v_staff.role_id
      and r.property_id = p_property_id;
  end if;

  if coalesce(array_length(coalesce(v_codes, '{}'::text[]), 1), 0) = 0 then
    v_codes := case v_staff.role
      when 'super_admin' then array(select code from public.employee_permission_codes)
      when 'hotel_admin' then array(select code from public.employee_permission_codes)
      when 'front_office_manager' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment','pos.access','pos.process_sale','stores.access','stores.inventory.view','back_office.access','back_office.reports.view']
      when 'receptionist' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment']
      when 'front_desk' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view']
      when 'pos_staff' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'waiter' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'cashier' then array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      when 'store_manager' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      when 'storekeeper' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      when 'store_keeper' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      when 'housekeeping_supervisor' then array['front_office.access','front_office.reservations.view']
      else '{}'::text[]
    end;
  end if;

  if coalesce(array_length(coalesce(v_codes, '{}'::text[]), 1), 0) = 0
     and coalesce(array_length(coalesce(v_staff.assigned_modules, '{}'::text[]), 1), 0) > 0 then
    select coalesce(array_agg(c.code), '{}') into v_codes
    from unnest(v_staff.assigned_modules) m
    join public.employee_permission_codes c
      on c.workspace = m and c.code like '%.access';
  end if;

  return coalesce(v_codes, '{}');
end;
$$;

-- Ensure newly seeded properties receive the same Storekeeper bundle.
create or replace function public.fn_seed_employee_roles(p_property_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
  values
    (p_property_id,'Cashier','pos','{pos.access,pos.open_shift,pos.close_shift,pos.process_sale,pos.apply_discount}','POS cashier workspace',true),
    (p_property_id,'Waiter','pos','{pos.access,pos.open_shift,pos.process_sale}','Restaurant waiter workspace',true),
    (p_property_id,'Storekeeper','store','{stores.access,stores.inventory.view,stores.stock.receive,stores.stock.issue,stores.stock.transfer,stores.stock.adjust,stores.suppliers.manage}','Stores workspace',true),
    (p_property_id,'Receptionist','frontoffice','{front_office.access,front_office.reservations.view,front_office.reservations.create,front_office.checkin,front_office.folio.view,front_office.folio.payment}','Front Office workspace',true),
    (p_property_id,'Accountant','backoffice','{back_office.access,back_office.reports.view,back_office.billing.manage}','Financial reports and accounting',true),
    (p_property_id,'Property Manager','backoffice','{back_office.access,back_office.reports.view,back_office.employees.manage,back_office.settings.manage,pos.access,front_office.access,stores.access}','Assigned management modules',true)
  on conflict (property_id, name) do nothing;
end;
$$;
