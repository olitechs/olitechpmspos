begin;

-- Inventory valuation contains commercially sensitive cost data. Register a
-- dedicated Stores permission rather than treating inventory visibility as cost access.
insert into public.employee_permission_codes(code,workspace,label,sensitive,sort_order)
values ('stores.inventory.valuation.view','store','View inventory costs and valuation',true,39)
on conflict (code) do update
set workspace=excluded.workspace,
    label=excluded.label,
    sensitive=true,
    sort_order=excluded.sort_order;

-- Grant the new capability only to the built-in Storekeeper role.
update public.employee_roles
set permission_codes = case
      when 'stores.inventory.valuation.view'=any(coalesce(permission_codes,'{}'::text[]))
        then coalesce(permission_codes,'{}'::text[])
      else array_append(coalesce(permission_codes,'{}'::text[]),'stores.inventory.valuation.view')
    end,
    updated_at=now()
where is_system=true and lower(btrim(name))='storekeeper';

-- Keep future property provisioning consistent.
create or replace function public.fn_seed_employee_roles(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $function$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  insert into public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
  values
    (p_property_id,'Cashier','pos','{pos.access,pos.open_shift,pos.close_shift,pos.process_sale,pos.apply_discount}','POS cashier workspace',true),
    (p_property_id,'Waiter','pos','{pos.access,pos.open_shift,pos.process_sale}','Restaurant waiter workspace',true),
    (p_property_id,'Storekeeper','store','{stores.access,stores.inventory.view,stores.stock.receive,stores.stock.issue,stores.stock.transfer,stores.stock.adjust,stores.suppliers.manage,stores.production.post,stores.inventory.valuation.view}','Stores workspace',true),
    (p_property_id,'Receptionist','frontoffice','{front_office.access,front_office.reservations.view,front_office.reservations.create,front_office.checkin,front_office.folio.view,front_office.folio.payment}','Front Office workspace',true),
    (p_property_id,'Accountant','backoffice','{back_office.access,back_office.reports.view,back_office.billing.manage}','Financial reports and accounting',true),
    (p_property_id,'Property Manager','backoffice','{back_office.access,back_office.reports.view,back_office.employees.manage,back_office.settings.manage,pos.access,front_office.access,stores.access}','Assigned management modules',true)
  on conflict (property_id, name) do nothing;
end;
$function$;

-- Preserve the legacy role-name resolver for staff rows without role_id.
-- Both legacy Storekeeper spellings receive valuation only after this permission is
-- registered in the catalog and their Stores workspace is assigned.
create or replace function public.fn_employee_permission_codes(
  p_property_id uuid,
  p_staff_id uuid default null
)
returns text[]
language plpgsql
stable
security definer
set search_path=public
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

  if public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin') then
    return array(select code from public.employee_permission_codes order by sort_order);
  end if;

  select s.* into v_staff
  from public.staff s
  where s.property_id = p_property_id
    and s.is_active = true
    and (
      s.id = coalesce(p_staff_id, public.current_staff_id(p_property_id))
      or (
        p_staff_id is null
        and public.current_staff_id(p_property_id) is null
        and s.user_id = auth.uid()
      )
    )
  limit 1;

  if v_staff.id is null then
    return '{}'::text[];
  end if;

  v_assigned := coalesce(v_staff.assigned_modules, '{}'::text[]);

  if v_staff.role_id is not null then
    select coalesce(r.permission_codes, '{}'::text[]) into v_role_codes
    from public.employee_roles r
    where r.id = v_staff.role_id
      and r.property_id = p_property_id;
    if not found then v_role_codes := '{}'::text[]; end if;
  else
    v_role_codes := case v_staff.role
      when 'super_admin' then array(select code from public.employee_permission_codes)
      when 'hotel_admin' then array(select code from public.employee_permission_codes)
      when 'front_office_manager' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment']
      when 'receptionist' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment','pos.access']
      when 'front_desk' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','pos.access']
      when 'pos_staff' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'waiter' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'cashier' then array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      when 'store_manager' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage']
      when 'storekeeper' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage','stores.production.post','stores.inventory.valuation.view']
      when 'store_keeper' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage','stores.production.post','stores.inventory.valuation.view']
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      when 'housekeeping_supervisor' then array['front_office.access']
      else '{}'::text[]
    end;
  end if;

  select coalesce(array_agg(distinct c.code), '{}'::text[]) into v_codes
  from public.employee_permission_codes c
  where c.code = any(coalesce(v_role_codes, '{}'::text[]))
    and c.workspace = any(v_assigned);

  select coalesce(array_agg(distinct g.permission_code), '{}'::text[]) into v_grant_codes
  from public.module_access_grants g
  join public.employee_permission_codes c on c.code = g.permission_code
  where g.property_id = p_property_id
    and g.staff_id = v_staff.id
    and g.revoked_at is null
    and g.expires_at > now()
    and c.workspace = any(v_assigned);

  return (
    select coalesce(array_agg(distinct x.code), '{}'::text[])
    from unnest(coalesce(v_codes, '{}'::text[]) || coalesce(v_grant_codes, '{}'::text[])) as x(code)
  );
end;
$function$;

-- A staff member may read product cost columns only when explicitly granted the
-- valuation permission. Existing property members retain their existing read policy.
drop policy if exists products_valuation_select on public.products;
create policy products_valuation_select
  on public.products
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or public.is_member_of_property(property_id)
    or public.fn_employee_has_permission(property_id,'stores.inventory.valuation.view')
  );

-- Keep both valuation endpoints invoker-rights. Their authorization checks and the
-- products RLS policy are both required; do not bypass tenant RLS with SECURITY DEFINER.
create or replace function public.fn_inventory_valuation(p_property_id uuid)
returns table(
  product_id uuid, sku text, name text, category text, unit text,
  current_stock numeric, cost_price numeric, stock_value numeric
)
language plpgsql
stable
set search_path=public
as $function$
begin
  if auth.uid() is null or p_property_id is null then
    raise exception 'Authenticated user and property are required.' using errcode='42501';
  end if;

  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.fn_employee_has_permission(p_property_id,'stores.inventory.valuation.view')
  ) then
    raise exception 'You are not authorised to view inventory valuation for this property.' using errcode='42501';
  end if;

  return query
  select p.id,p.sku,p.name,p.category,p.unit,p.current_stock,p.cost_price,
         round(p.current_stock*p.cost_price,2)
  from public.products p
  where p.property_id=p_property_id
  order by p.category,p.name;
end;
$function$;

create or replace function public.fn_inventory_valuation_summary(p_property_id uuid)
returns table(total_products bigint,total_units numeric,total_value numeric,expired_value numeric)
language plpgsql
stable
set search_path=public,pg_temp
as $function$
begin
  if auth.uid() is null or p_property_id is null then
    raise exception 'Authenticated user and property are required.' using errcode='42501';
  end if;

  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.fn_employee_has_permission(p_property_id,'stores.inventory.valuation.view')
  ) then
    raise exception 'You are not authorised to view inventory valuation for this property.' using errcode='42501';
  end if;

  return query
  select count(*)::bigint,
         coalesce(sum(p.current_stock),0)::numeric,
         coalesce(round(sum(p.current_stock*p.cost_price),2),0)::numeric,
         coalesce(round(sum(case when p.expiry_date<current_date then p.current_stock*p.cost_price else 0 end),2),0)::numeric
  from public.products p
  where p.property_id=p_property_id;
end;
$function$;

revoke all on function public.fn_inventory_valuation(uuid) from public,anon;
grant execute on function public.fn_inventory_valuation(uuid) to authenticated;
revoke all on function public.fn_inventory_valuation_summary(uuid) from public,anon;
grant execute on function public.fn_inventory_valuation_summary(uuid) to authenticated;

notify pgrst,'reload schema';
commit;

-- Generated through the Supabase CLI migration workflow.

-- Regenerate after workflow expression correction.
