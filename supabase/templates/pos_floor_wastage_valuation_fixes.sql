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
