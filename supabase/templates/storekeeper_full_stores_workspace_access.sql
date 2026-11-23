-- Register the Storekeeper production action in the server permission catalog.
insert into public.employee_permission_codes(code,workspace,label,sensitive,sort_order)
values ('stores.production.post','store','Post inventory production and assembly batches',true,38)
on conflict (code) do nothing;

-- Storekeeper receives the complete operational Stores permission bundle.
-- This update is scoped to the built-in Storekeeper role only.
update public.employee_roles
set permission_codes = array[
  'stores.access',
  'stores.inventory.view',
  'stores.stock.receive',
  'stores.stock.issue',
  'stores.stock.transfer',
  'stores.stock.adjust',
  'stores.suppliers.manage',
  'stores.production.post'
]::text[],
    updated_at = now()
where is_system = true
  and lower(btrim(name)) = 'storekeeper';

-- Preserve tenant membership, platform-owner, active-staff, assigned-workspace,
-- and time-limited grant checks. Resolve authenticated staff by user_id only
-- when neither an explicit staff id nor a verified PIN session is available.
create or replace function public.fn_employee_permission_codes(
  p_property_id uuid,
  p_staff_id uuid default null
)
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
    if not found then
      v_role_codes := '{}'::text[];
    end if;
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
      when 'storekeeper' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage','stores.production.post']
      when 'store_keeper' then array['stores.access','stores.inventory.view','stores.stock.receive','stores.stock.issue','stores.stock.transfer','stores.stock.adjust','stores.suppliers.manage','stores.production.post']
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

-- Keep future property provisioning consistent with existing seeded roles.
create or replace function public.fn_seed_employee_roles(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  insert into public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
  values
    (p_property_id,'Cashier','pos','{pos.access,pos.open_shift,pos.close_shift,pos.process_sale,pos.apply_discount}','POS cashier workspace',true),
    (p_property_id,'Waiter','pos','{pos.access,pos.open_shift,pos.process_sale}','Restaurant waiter workspace',true),
    (p_property_id,'Storekeeper','store','{stores.access,stores.inventory.view,stores.stock.receive,stores.stock.issue,stores.stock.transfer,stores.stock.adjust,stores.suppliers.manage,stores.production.post}','Stores workspace',true),
    (p_property_id,'Receptionist','frontoffice','{front_office.access,front_office.reservations.view,front_office.reservations.create,front_office.checkin,front_office.folio.view,front_office.folio.payment}','Front Office workspace',true),
    (p_property_id,'Accountant','backoffice','{back_office.access,back_office.reports.view,back_office.billing.manage}','Financial reports and accounting',true),
    (p_property_id,'Property Manager','backoffice','{back_office.access,back_office.reports.view,back_office.employees.manage,back_office.settings.manage,pos.access,front_office.access,stores.access}','Assigned management modules',true)
  on conflict (property_id, name) do nothing;
end;
$function$;

-- Supabase CLI migration generation source; keep this template aligned with the migration.


-- Enforce granular employee permissions inside the SECURITY DEFINER posting RPCs.
-- Property membership alone is not sufficient authorization for stock changes.

create or replace function public.fn_post_stock_adjustment(
  p_property_id uuid, p_product_id uuid, p_change numeric, p_reason text,
  p_location_id uuid default null::uuid
) returns stock_adjustments
language plpgsql security definer set search_path to 'public'
as $function$
declare v public.stock_adjustments; loc_qty numeric;
begin
 if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if not public.fn_employee_has_permission(p_property_id,'stores.stock.adjust') then raise exception 'Missing employee permission: stores.stock.adjust' using errcode='42501'; end if;
 if p_change=0 or nullif(trim(p_reason),'') is null then raise exception 'Adjustment quantity and reason are required'; end if;
 if not exists(select 1 from products where id=p_product_id and property_id=p_property_id) then raise exception 'Invalid product'; end if;
 if p_location_id is not null and p_change<0 then
  select coalesce(qty,0) into loc_qty from product_stock_locations where product_id=p_product_id and location_id=p_location_id for update;
  if loc_qty<abs(p_change) then raise exception 'Insufficient stock at location'; end if;
  update product_stock_locations set qty=qty-abs(p_change) where product_id=p_product_id and location_id=p_location_id;
 elsif p_location_id is not null then
  insert into product_stock_locations(property_id,product_id,location_id,qty) values(p_property_id,p_product_id,p_location_id,p_change)
  on conflict(product_id,location_id) do update set qty=product_stock_locations.qty+excluded.qty;
 end if;
 perform fn_apply_stock_movement(p_product_id,p_change,p_reason,'adjustment',null);
 insert into stock_adjustments(property_id,product_id,location_id,change_qty,reason,created_by) values(p_property_id,p_product_id,p_location_id,p_change,p_reason,auth.uid()) returning * into v;
 return v;
end $function$;

create or replace function public.fn_create_inventory_count(
  p_property_id uuid, p_location_id uuid, p_lines jsonb, p_reference text default null::text
) returns inventory_counts
language plpgsql security definer set search_path to 'public'
as $function$
declare v inventory_counts; l jsonb; pid uuid; counted numeric; expected numeric;
begin
 if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if not public.fn_employee_has_permission(p_property_id,'stores.stock.adjust') then raise exception 'Missing employee permission: stores.stock.adjust' using errcode='42501'; end if;
 insert into inventory_counts(property_id,location_id,reference,counted_by) values(p_property_id,p_location_id,nullif(trim(p_reference),''),auth.uid()) returning * into v;
 for l in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  pid:=nullif(l->>'product_id','')::uuid; counted:=coalesce((l->>'counted_qty')::numeric,0);
  if pid is null or counted<0 then raise exception 'Invalid count line'; end if;
  if not exists(select 1 from products where id=pid and property_id=p_property_id) then raise exception 'Invalid count product'; end if;
  select coalesce(qty,0) into expected from product_stock_locations where product_id=pid and location_id=p_location_id;
  insert into inventory_count_lines(count_id,product_id,expected_qty,counted_qty) values(v.id,pid,coalesce(expected,0),counted);
 end loop;
 update inventory_counts set status='submitted' where id=v.id returning * into v;
 return v;
end $function$;

create or replace function public.fn_approve_inventory_count(p_count_id uuid)
returns inventory_counts
language plpgsql security definer set search_path to 'public'
as $function$
declare v inventory_counts; l record; diff numeric;
begin
 select * into v from inventory_counts where id=p_count_id for update;
 if not found or not (public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Count not found or not authorized'; end if;
 if not public.fn_employee_has_permission(v.property_id,'stores.stock.adjust') then raise exception 'Missing employee permission: stores.stock.adjust' using errcode='42501'; end if;
 if v.status<>'submitted' then raise exception 'Count is not awaiting approval'; end if;
 for l in select * from inventory_count_lines where count_id=v.id loop
  diff:=l.counted_qty-l.expected_qty;
  if diff<>0 then
   if v.location_id is not null then
    insert into product_stock_locations(property_id,product_id,location_id,qty) values(v.property_id,l.product_id,v.location_id,greatest(l.counted_qty,0))
    on conflict(product_id,location_id) do update set qty=excluded.qty;
   end if;
   perform fn_apply_stock_movement(l.product_id,diff,'Inventory count variance','count',v.id);
  end if;
 end loop;
 update inventory_counts set status='approved',approved_by=auth.uid(),approved_at=now() where id=v.id returning * into v;
 return v;
end $function$;

create or replace function public.fn_create_stock_transfer(
 p_property_id uuid,p_from uuid,p_to uuid,p_lines jsonb,p_reference text default null::text
) returns stock_transfers
language plpgsql security definer set search_path to 'public'
as $function$
declare v stock_transfers; l jsonb; pid uuid; q numeric; v_from numeric;
begin
 if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if not public.fn_employee_has_permission(p_property_id,'stores.stock.transfer') then raise exception 'Missing employee permission: stores.stock.transfer' using errcode='42501'; end if;
 if p_from=p_to then raise exception 'Source and destination must differ'; end if;
 if not exists(select 1 from inventory_locations where id=p_from and property_id=p_property_id) or not exists(select 1 from inventory_locations where id=p_to and property_id=p_property_id) then raise exception 'Invalid transfer location'; end if;
 for l in select value from jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) loop
  pid:=nullif(l->>'product_id','')::uuid; q:=coalesce((l->>'qty')::numeric,0);
  if pid is null or q<=0 or not exists(select 1 from products where id=pid and property_id=p_property_id) then raise exception 'Invalid transfer line'; end if;
  select coalesce(qty,0) into v_from from product_stock_locations where product_id=pid and location_id=p_from for update;
  if v_from<q then raise exception 'Insufficient stock at source location'; end if;
 end loop;
 insert into stock_transfers(property_id,from_location_id,to_location_id,status,reference,lines,created_by) values(p_property_id,p_from,p_to,'pending',nullif(trim(p_reference),''),p_lines,auth.uid()) returning * into v;
 return v;
end $function$;

create or replace function public.fn_complete_stock_transfer(p_transfer_id uuid)
returns stock_transfers
language plpgsql security definer set search_path to 'public'
as $function$
declare v public.stock_transfers; l jsonb; pid uuid; v_qty numeric; from_qty numeric;
begin
 select * into v from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception 'Transfer not found'; end if;
 if not (public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not authorized'; end if;
 if not public.fn_employee_has_permission(v.property_id,'stores.stock.transfer') then raise exception 'Missing employee permission: stores.stock.transfer' using errcode='42501'; end if;
 if v.status<>'pending' then raise exception 'Transfer is not pending'; end if;
 if v.from_location_id=v.to_location_id then raise exception 'Source and destination must differ'; end if;
 for l in select value from jsonb_array_elements(v.lines) loop
  pid:=nullif(l->>'product_id','')::uuid; v_qty:=coalesce((l->>'qty')::numeric,0);
  if pid is null or v_qty<=0 then raise exception 'Invalid transfer line'; end if;
  select coalesce(qty,0) into from_qty from public.product_stock_locations where product_id=pid and location_id=v.from_location_id for update;
  if from_qty<v_qty then raise exception 'Insufficient stock at source location'; end if;
  update public.product_stock_locations set qty=qty-v_qty where product_id=pid and location_id=v.from_location_id;
  insert into public.product_stock_locations(property_id,product_id,location_id,qty) values(v.property_id,pid,v.to_location_id,v_qty)
  on conflict(product_id,location_id) do update set qty=product_stock_locations.qty+excluded.qty;
  insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id) values(v.property_id,pid,'out',v_qty,'Transfer '||v.id::text,auth.uid());
  insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id) values(v.property_id,pid,'in',v_qty,'Transfer '||v.id::text,auth.uid());
 end loop;
 update public.stock_transfers set status='completed',completed_by=auth.uid(),completed_at=now() where id=v.id returning * into v;
 return v;
end $function$;

create or replace function public.fn_create_purchase_order(
 p_property_id uuid,p_supplier_id uuid,p_lines jsonb,p_invoice_no text default null::text
) returns purchase_orders
language plpgsql security definer set search_path to 'public'
as $function$
declare v_po public.purchase_orders; v_total numeric:=0; v_line jsonb; v_product_id uuid; v_qty numeric; v_cost numeric;
begin
 if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized for this property'; end if;
 if not public.fn_employee_has_permission(p_property_id,'stores.suppliers.manage') then raise exception 'Missing employee permission: stores.suppliers.manage' using errcode='42501'; end if;
 if p_lines is null or jsonb_array_length(p_lines)=0 then raise exception 'At least one purchase line is required'; end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_product_id:=nullif(v_line->>'product_id','')::uuid; v_qty:=coalesce((v_line->>'qty')::numeric,0); v_cost:=coalesce((v_line->>'unit_cost')::numeric,0);
  if v_product_id is null or v_qty<=0 or v_cost<0 then raise exception 'Invalid purchase line'; end if;
  if not exists(select 1 from public.products where id=v_product_id and property_id=p_property_id) then raise exception 'Product does not belong to this property'; end if;
  v_total:=v_total+(v_qty*v_cost);
 end loop;
 if p_supplier_id is not null and not exists(select 1 from public.suppliers where id=p_supplier_id and property_id=p_property_id) then raise exception 'Supplier does not belong to this property'; end if;
 insert into public.purchase_orders(property_id,supplier_id,invoice_no,lines,total,status,created_by)
 values(p_property_id,p_supplier_id,nullif(trim(p_invoice_no),''),p_lines,v_total,'ordered',auth.uid()) returning * into v_po;
 return v_po;
end $function$;

create or replace function public.fn_receive_purchase_order(
 p_purchase_order_id uuid,p_received_lines jsonb default null::jsonb
) returns purchase_orders
language plpgsql security definer set search_path to 'public'
as $function$
declare po purchase_orders; line jsonb; pid uuid; qty numeric; cost numeric; ordered numeric; already numeric; remaining numeric; grn goods_receipts; grnno text; old_stock numeric; old_cost numeric; all_received boolean:=true; x jsonb;
begin
 select * into po from purchase_orders where id=p_purchase_order_id for update;
 if not found then raise exception 'Purchase order not found'; end if;
 if not (public.is_platform_owner() or public.is_member_of_property(po.property_id)) then raise exception 'Not authorized for this property'; end if;
 if not public.fn_employee_has_permission(po.property_id,'stores.stock.receive') then raise exception 'Missing employee permission: stores.stock.receive' using errcode='42501'; end if;
 if po.status in ('received','cancelled') then raise exception 'Purchase order cannot be received in its current status'; end if;
 if coalesce(jsonb_array_length(p_received_lines),0)=0 then p_received_lines:=po.lines; end if;
 grnno:='GRN-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6);
 insert into goods_receipts(property_id,purchase_order_id,grn_no,received_by) values(po.property_id,po.id,grnno,auth.uid()) returning * into grn;
 for line in select value from jsonb_array_elements(p_received_lines) loop
  pid:=nullif(line->>'product_id','')::uuid; qty:=coalesce((line->>'qty')::numeric,0); cost:=coalesce((line->>'unit_cost')::numeric,0);
  if pid is null or qty<=0 then raise exception 'Each received line requires product_id and qty > 0'; end if;
  select coalesce((x->>'qty')::numeric,0) into ordered from jsonb_array_elements(po.lines) x where (x->>'product_id')=pid::text limit 1;
  if ordered is null then raise exception 'Product is not on this purchase order'; end if;
  select coalesce(sum(l.qty),0) into already from goods_receipt_lines l join goods_receipts g on g.id=l.goods_receipt_id where g.purchase_order_id=po.id and l.product_id=pid;
  remaining:=ordered-already;
  if qty>remaining then raise exception 'Received quantity for product exceeds ordered quantity'; end if;
  select current_stock,cost_price into old_stock,old_cost from products where id=pid and property_id=po.property_id for update;
  perform fn_apply_stock_movement(pid,qty,'GRN '||grn.grn_no,'purchase',grn.id);
  if cost>0 then update products set cost_price=case when coalesce(old_stock,0)+qty>0 then round(((coalesce(old_stock,0)*coalesce(old_cost,0))+(qty*cost))/(coalesce(old_stock,0)+qty),4) else cost end,updated_at=now() where id=pid; end if;
  insert into goods_receipt_lines(goods_receipt_id,product_id,qty,unit_cost) values(grn.id,pid,qty,cost);
 end loop;
 for x in select value from jsonb_array_elements(po.lines) loop
  pid:=nullif(x->>'product_id','')::uuid; ordered:=coalesce((x->>'qty')::numeric,0);
  select coalesce(sum(l.qty),0) into already from goods_receipt_lines l join goods_receipts g on g.id=l.goods_receipt_id where g.purchase_order_id=po.id and l.product_id=pid;
  if already<ordered then all_received:=false; end if;
 end loop;
 update purchase_orders set status=case when all_received then 'received' else 'partial' end,received_at=case when all_received then now() else received_at end,received_by=auth.uid() where id=po.id returning * into po;
 return po;
end $function$;




-- Expose readiness without exposing internal schema details. Posting becomes
-- available only after both location-aware stock writing and the atomic Phase 8
-- production RPC are deployed, and the current employee has the production grant.
create or replace function public.fn_inventory_production_ready(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select auth.uid() is not null
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
    and public.fn_employee_has_permission(p_property_id,'stores.production.post')
    and to_regprocedure('public.fn_post_inventory_production(uuid,uuid,uuid,numeric,text,text)') is not null
    and to_regclass('stock_internal.production_cost_snapshots') is not null
    and to_regprocedure('stock_internal.fn_post_stock_movement_at_location(uuid,uuid,uuid,numeric,text,text,uuid,text)') is not null;
$function$;
revoke all on function public.fn_inventory_production_ready(uuid) from public, anon;
grant execute on function public.fn_inventory_production_ready(uuid) to authenticated;

-- Storekeeper item-master access: keep product writes inside the same property
-- boundary and require the explicit stock-adjust permission.
alter table public.products add column if not exists description text;

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (
    public.can_store_write(property_id, category)
    or public.can_store_write(property_id, 'adjust')
    or (pos_enabled and public.can_manage_pos_menu(property_id))
  );

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update to authenticated
  using (
    public.can_store_write(property_id, category)
    or public.can_store_write(property_id, 'adjust')
    or (pos_enabled and public.can_manage_pos_menu(property_id))
  )
  with check (
    public.can_store_write(property_id, category)
    or public.can_store_write(property_id, 'adjust')
    or (pos_enabled and public.can_manage_pos_menu(property_id))
  );

create unique index if not exists products_id_property_id_uidx
  on public.products(id,property_id);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  product_id uuid not null,
  name text not null check (length(btrim(name))>0),
  sku text,
  barcode text,
  price_delta numeric(14,2) not null default 0,
  cost_price numeric(14,2) not null default 0 check (cost_price>=0),
  current_stock numeric(14,4) not null default 0 check (current_stock>=0),
  track_stock boolean not null default true,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes)='object'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_product_property_fk
    foreign key(product_id,property_id) references public.products(id,property_id) on delete cascade,
  constraint product_variants_property_sku_uidx unique(property_id,sku)
);

create index if not exists product_variants_product_idx
  on public.product_variants(property_id,product_id,sort_order);

alter table public.product_variants enable row level security;
drop policy if exists product_variants_select on public.product_variants;
create policy product_variants_select on public.product_variants
  for select to authenticated
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists product_variants_insert on public.product_variants;
create policy product_variants_insert on public.product_variants
  for insert to authenticated
  with check (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  );
drop policy if exists product_variants_update on public.product_variants;
create policy product_variants_update on public.product_variants
  for update to authenticated
  using (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  )
  with check (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  );
drop policy if exists product_variants_delete on public.product_variants;
create policy product_variants_delete on public.product_variants
  for delete to authenticated
  using (
    public.is_member_of_property(property_id)
    and public.fn_subscription_module_allowed(property_id,'store')
    and public.fn_employee_has_permission(property_id,'stores.stock.adjust')
  );

-- The composite recipe RPC already checks membership and property ownership.
-- Extend its existing manager guard by one explicit Storekeeper capability.
do $migration$
declare
  v_definition text;
  v_original text := 'or v_role in (''hotel_admin'',''super_admin'',''fb_manager'',''store_manager'',''inventory_manager'')';
  v_replacement text := 'or public.fn_employee_has_permission(p_property_id,''stores.stock.adjust'') or v_role in (''hotel_admin'',''super_admin'',''fb_manager'',''store_manager'',''inventory_manager'')';
begin
  select pg_get_functiondef('public.fn_upsert_composite_product_recipe(uuid,uuid,boolean,jsonb,text)'::regprocedure)
    into v_definition;
  if position(v_original in v_definition)=0 then
    raise exception 'Composite recipe authorization guard changed; review this migration before applying.';
  end if;
  v_definition := replace(v_definition,v_original,v_replacement);
  execute v_definition;
end
$migration$;

