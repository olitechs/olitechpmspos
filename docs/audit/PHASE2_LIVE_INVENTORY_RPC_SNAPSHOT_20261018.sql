-- FORENSIC SNAPSHOT ONLY — captured from live project catalog on 2026-10-18.
-- Project ref: mszogmazldxjsiytrlxr (production).
-- DO NOT APPLY OR REPLAY THIS FILE. It is evidence for source/live reconciliation, not a migration.
-- Definitions are exact pg_get_functiondef output. ACL metadata is read-only catalog evidence.
-- Keep this private; it documents internal database implementation.

-- OBJECT: public.fn_adjust_product_stock(p_product_id uuid, p_change numeric, p_reason text)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_adjust_product_stock(p_product_id uuid, p_change numeric, p_reason text)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin return public.fn_apply_stock_movement(p_product_id,p_change,p_reason,'manual_adjustment',null); end $function$

-- OBJECT: public.fn_apply_stock_movement(p_product_id uuid, p_change numeric, p_reason text, p_source_type text, p_source_id uuid)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: false
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_apply_stock_movement(p_product_id uuid, p_change numeric, p_reason text, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.products; v_type text;
begin
 select * into v from public.products where id=p_product_id for update;
 if v.id is null then raise exception 'Product not found.'; end if;
 if not(public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not allowed.'; end if;
 if p_change=0 then return v; end if;
 if p_change<0 and v.current_stock+p_change<0 then raise exception 'Insufficient stock for % (available %, required %).',v.name,v.current_stock,abs(p_change); end if;
 v_type:=case when p_change>0 then 'in' else 'out' end;
 update public.products set current_stock=current_stock+p_change,updated_at=now() where id=p_product_id returning * into v;
 insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id,source_type,source_id) values(v.property_id,v.id,v_type,abs(p_change),nullif(trim(p_reason),''),auth.uid(),p_source_type,p_source_id);
 return v;
end $function$

-- OBJECT: public.fn_approve_inventory_count(p_count_id uuid)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_approve_inventory_count(p_count_id uuid)
 RETURNS inventory_counts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v inventory_counts; l record; diff numeric;
begin
 select * into v from inventory_counts where id=p_count_id for update;
 if not found or not(is_platform_owner() or is_member_of_property(v.property_id)) then raise exception 'Count not found or not authorized'; end if;
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
end $function$

-- OBJECT: public.fn_bulk_upsert_store_products(p_property_id uuid, p_rows jsonb)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_bulk_upsert_store_products(p_property_id uuid, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb; v_product public.products; v_existing public.products;
  v_category text; v_name text; v_sku text; v_unit text; v_location text; v_pos_category text; v_center text;
  v_stock numeric; v_old_stock numeric; v_min numeric; v_max numeric; v_cost numeric; v_price numeric;
  v_pos_enabled boolean; v_pos_active boolean; v_sort integer; v_supplier uuid; v_location_id uuid;
  v_count integer := 0; v_created integer := 0; v_updated integer := 0; v_stock_adjusted integer := 0; v_change numeric;
  v_errors jsonb := '[]'::jsonb; v_expiry date; v_supplier_raw text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property.';
  end if;

  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_name := nullif(trim(coalesce(r->>'name','')), '');
      if v_name is null then raise exception 'Product name is required.'; end if;

      v_sku := nullif(trim(coalesce(r->>'sku','')), '');
      v_category := coalesce(nullif(trim(r->>'category'), ''), 'General');
      v_unit := coalesce(nullif(trim(r->>'unit'), ''), 'pcs');
      v_location := coalesce(nullif(trim(r->>'location'), ''), 'Main Store');
      v_pos_category := coalesce(nullif(trim(r->>'pos_category'), ''), v_category);
      v_center := coalesce(nullif(trim(r->>'production_center'), ''), 'Kitchen');

      v_stock := greatest(0, coalesce(nullif(trim(r->>'current_stock'),'')::numeric, nullif(trim(r->>'quantity'),'')::numeric, 0));
      v_min := greatest(0, coalesce(nullif(trim(r->>'min_stock'),'')::numeric, nullif(trim(r->>'low_stock_threshold'),'')::numeric, 0));
      v_max := greatest(0, coalesce(nullif(trim(r->>'max_stock'),'')::numeric, 0));
      v_cost := greatest(0, coalesce(nullif(trim(r->>'cost_price'),'')::numeric, 0));
      v_price := greatest(0, coalesce(nullif(trim(r->>'selling_price'),'')::numeric, 0));

      v_pos_enabled := lower(trim(coalesce(r->>'pos_enabled','false'))) in ('true','1','yes','y');
      v_pos_active := lower(trim(coalesce(r->>'pos_active','true'))) not in ('false','0','no','n');
      v_sort := coalesce(nullif(trim(r->>'pos_sort'),'')::integer, nullif(trim(r->>'sort_order'),'')::integer, 0);

      v_supplier := null;
      v_supplier_raw := nullif(trim(coalesce(r->>'supplier_id','')), '');
      if v_supplier_raw is not null and v_supplier_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        v_supplier := v_supplier_raw::uuid;
      end if;

      v_expiry := null;
      if nullif(trim(coalesce(r->>'expiry_date','')), '') is not null then
        begin
          v_expiry := nullif(trim(r->>'expiry_date'),'')::date;
        exception when others then
          v_expiry := null;
        end;
      end if;

      if not (public.is_platform_owner() or public.can_store_write(p_property_id, v_category)) then
        raise exception 'You do not have Store write access for category %.', v_category;
      end if;

      if v_sku is not null then
        select * into v_existing from public.products
        where property_id = p_property_id and sku = v_sku limit 1 for update;
      else
        select * into v_existing from public.products
        where property_id = p_property_id and lower(trim(name)) = lower(v_name) limit 1 for update;
      end if;

      if v_existing.id is null then
        insert into public.products(
          property_id, sku, name, category, unit, current_stock, min_stock, max_stock,
          cost_price, selling_price, supplier_id, location, expiry_date,
          pos_enabled, pos_category, production_center, pos_sort, pos_active
        )
        values(
          p_property_id, v_sku, v_name, v_category, v_unit, 0, v_min, v_max,
          v_cost, v_price, v_supplier, v_location, v_expiry,
          v_pos_enabled, case when v_pos_enabled then v_pos_category else null end,
          v_center, v_sort, v_pos_active
        )
        returning * into v_product;

        v_created := v_created + 1;
        if v_stock > 0 then
          perform public.fn_apply_stock_movement(v_product.id, v_stock,
            'Bulk Store CSV import — opening stock', 'bulk_import', v_product.id);
          v_stock_adjusted := v_stock_adjusted + 1;
        end if;
      else
        v_old_stock := coalesce(v_existing.current_stock, 0);
        update public.products
        set sku = coalesce(v_sku, sku), name = v_name, category = v_category, unit = v_unit,
            min_stock = v_min, max_stock = v_max, cost_price = v_cost, selling_price = v_price,
            supplier_id = coalesce(v_supplier, supplier_id), location = v_location,
            expiry_date = v_expiry, pos_enabled = v_pos_enabled,
            pos_category = case when v_pos_enabled then v_pos_category else null end,
            production_center = v_center, pos_sort = v_sort, pos_active = v_pos_active, updated_at = now()
        where id = v_existing.id
        returning * into v_product;

        v_updated := v_updated + 1;
        v_change := v_stock - v_old_stock;
        if v_change <> 0 then
          perform public.fn_apply_stock_movement(v_product.id, v_change,
            'Bulk Store CSV import — stock reconciliation', 'bulk_import', v_product.id);
          v_stock_adjusted := v_stock_adjusted + 1;
          select * into v_product from public.products where id = v_existing.id;
        end if;
      end if;

      insert into public.inventory_locations(property_id, name)
      values(p_property_id, v_location)
      on conflict(property_id, name) do nothing;

      select id into v_location_id from public.inventory_locations
      where property_id = p_property_id and name = v_location limit 1;

      insert into public.product_stock_locations(property_id, product_id, location_id, qty)
      values(p_property_id, v_product.id, v_location_id, v_stock)
      on conflict(product_id, location_id) do update set qty = excluded.qty;

      if v_pos_enabled then
        insert into public.pos_menu_categories(property_id, name, production_center)
        values(p_property_id, v_pos_category, v_center)
        on conflict(property_id, name)
        do update set production_center = excluded.production_center, active = true;
      end if;

      v_count := v_count + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'name', v_name, 'sku', v_sku, 'error', sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'processed', v_count, 'created', v_created, 'updated', v_updated,
    'stock_adjusted', v_stock_adjusted, 'errors', v_errors
  );
end
$function$

-- OBJECT: public.fn_complete_stock_transfer(p_transfer_id uuid)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_complete_stock_transfer(p_transfer_id uuid)
 RETURNS stock_transfers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.stock_transfers; l jsonb; pid uuid; v_qty numeric; from_qty numeric;
begin
select * into v from public.stock_transfers where id=p_transfer_id for update;
if not found then raise exception 'Transfer not found'; end if;
if not(public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not authorized'; end if;
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
update public.stock_transfers set status='completed',completed_by=auth.uid(),completed_at=now() where id=v.id returning * into v; return v;
end $function$

-- OBJECT: public.fn_consume_recipe_stock(p_property_id uuid, p_items jsonb, p_reference text)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_consume_recipe_stock(p_property_id uuid, p_items jsonb, p_reference text DEFAULT 'POS sale'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare item jsonb; ing record; v_name text; v_order_qty numeric; v_needed numeric; v_consumed jsonb:='[]'::jsonb;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  v_name:=trim(coalesce(item->>'name',item->>'item_name','')); v_order_qty:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0);
  if v_name='' or v_order_qty<=0 then continue; end if;
  for ing in select ri.product_id,ri.qty,r.yield_qty from public.recipes r join public.recipe_ingredients ri on ri.recipe_id=r.id where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name) loop
   v_needed:=ing.qty*(v_order_qty/greatest(ing.yield_qty,0.001));
   perform public.fn_apply_stock_movement(ing.product_id,-v_needed,p_reference,'pos_recipe',null);
   insert into public.stock_usage(property_id,usage_date,department,product_id,qty,reference,created_by) values(p_property_id,current_date,'F&B',ing.product_id,v_needed,p_reference,auth.uid());
   v_consumed:=v_consumed||jsonb_build_object('product_id',ing.product_id,'qty',v_needed);
  end loop;
 end loop;
 return v_consumed;
end $function$

-- OBJECT: public.fn_inventory_valuation(p_property_id uuid)
-- SECURITY DEFINER: false
-- LANGUAGE: sql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_inventory_valuation(p_property_id uuid)
 RETURNS TABLE(product_id uuid, sku text, name text, category text, unit text, current_stock numeric, cost_price numeric, stock_value numeric)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$ select p.id,p.sku,p.name,p.category,p.unit,p.current_stock,p.cost_price,round(p.current_stock*p.cost_price,2) from public.products p where p.property_id=p_property_id order by p.category,p.name $function$

-- OBJECT: public.fn_post_production(p_property_id uuid, p_recipe_id uuid, p_output_product_id uuid, p_quantity numeric, p_reference text)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_post_production(p_property_id uuid, p_recipe_id uuid, p_output_product_id uuid, p_quantity numeric, p_reference text DEFAULT NULL::text)
 RETURNS inventory_productions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v inventory_productions; ing record; need numeric; yield numeric;
begin
 if not(is_platform_owner() or is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if p_quantity<=0 then raise exception 'Production quantity must be greater than zero'; end if;
 select yield_qty into yield from recipes where id=p_recipe_id and property_id=p_property_id and active;
 if yield is null then raise exception 'Recipe not found or inactive'; end if;
 if not exists(select 1 from products where id=p_output_product_id and property_id=p_property_id) then raise exception 'Invalid output product'; end if;
 for ing in select product_id,qty from recipe_ingredients where recipe_id=p_recipe_id loop
  need:=ing.qty*(p_quantity/greatest(yield,0.001));
  perform fn_apply_stock_movement(ing.product_id,-need,'Production consumption','production',null);
 end loop;
 perform fn_apply_stock_movement(p_output_product_id,p_quantity,'Production output','production',null);
 insert into inventory_productions(property_id,recipe_id,output_product_id,quantity,reference,created_by) values(p_property_id,p_recipe_id,p_output_product_id,p_quantity,nullif(trim(p_reference),''),auth.uid()) returning * into v;
 return v;
end $function$

-- OBJECT: public.fn_post_stock_adjustment(p_property_id uuid, p_product_id uuid, p_change numeric, p_reason text, p_location_id uuid)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_post_stock_adjustment(p_property_id uuid, p_product_id uuid, p_change numeric, p_reason text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS stock_adjustments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.stock_adjustments; loc_qty numeric;
begin
 if not(is_platform_owner() or is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
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
end $function$

-- OBJECT: public.fn_post_wastage(p_property_id uuid, p_product_id uuid, p_quantity numeric, p_reason text, p_location_id uuid, p_expiry_date date)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_post_wastage(p_property_id uuid, p_product_id uuid, p_quantity numeric, p_reason text, p_location_id uuid DEFAULT NULL::uuid, p_expiry_date date DEFAULT NULL::date)
 RETURNS inventory_wastage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v inventory_wastage; loc_qty numeric;
begin
 if not(is_platform_owner() or is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if p_quantity<=0 or nullif(trim(p_reason),'') is null then raise exception 'Quantity and reason are required'; end if;
 if p_location_id is not null then
  select coalesce(qty,0) into loc_qty from product_stock_locations where product_id=p_product_id and location_id=p_location_id for update;
  if loc_qty<p_quantity then raise exception 'Insufficient stock at location'; end if;
  update product_stock_locations set qty=qty-p_quantity where product_id=p_product_id and location_id=p_location_id;
 end if;
 perform fn_apply_stock_movement(p_product_id,-p_quantity,p_reason,'wastage',null);
 insert into inventory_wastage(property_id,product_id,location_id,quantity,reason,expiry_date,created_by) values(p_property_id,p_product_id,p_location_id,p_quantity,p_reason,p_expiry_date,auth.uid()) returning * into v;
 return v;
end $function$

-- OBJECT: public.fn_receive_purchase_order(p_purchase_order_id uuid, p_received_lines jsonb)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_receive_purchase_order(p_purchase_order_id uuid, p_received_lines jsonb DEFAULT NULL::jsonb)
 RETURNS purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare po purchase_orders; line jsonb; pid uuid; qty numeric; cost numeric; ordered numeric; already numeric; remaining numeric; grn goods_receipts; grnno text; old_stock numeric; old_cost numeric; all_received boolean:=true; x jsonb;
begin
 select * into po from purchase_orders where id=p_purchase_order_id for update;
 if not found then raise exception 'Purchase order not found'; end if;
 if not(is_platform_owner() or is_member_of_property(po.property_id)) then raise exception 'Not authorized for this property'; end if;
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
end $function$

-- OBJECT: public.fn_record_pos_sale(p_property_id uuid, p_table_number text, p_order_number text, p_items jsonb, p_subtotal numeric, p_discount_amount numeric, p_vat numeric, p_total numeric, p_payment_method text, p_reservation_id uuid, p_shift_id uuid, p_waiter text, p_discount_id uuid, p_discount_name text, p_idempotency_key text, p_payment_allocations jsonb)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_record_pos_sale(p_property_id uuid, p_table_number text, p_order_number text, p_items jsonb, p_subtotal numeric, p_discount_amount numeric, p_vat numeric, p_total numeric, p_payment_method text, p_reservation_id uuid DEFAULT NULL::uuid, p_shift_id uuid DEFAULT NULL::uuid, p_waiter text DEFAULT NULL::text, p_discount_id uuid DEFAULT NULL::uuid, p_discount_name text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_payment_allocations jsonb DEFAULT NULL::jsonb)
 RETURNS pos_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_receipt public.pos_receipts; v_shift uuid; v_key text; v_folio_charge_id uuid;
 v_role text; v_res_property uuid; v_room_id uuid; v_room_number text; v_guest_name text;
 item jsonb; a jsonb; v_product public.products; v_qty numeric; v_name text;
 v_method text; v_amount numeric; v_res uuid; v_sum numeric:=0; v_alloc_folio uuid;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 if p_payment_method not in ('cash','card','mpesa','bank','room','split') then raise exception 'Unknown payment method.'; end if;
 if p_total<=0 then raise exception 'Total must be greater than zero.'; end if;
 v_key:=nullif(trim(p_idempotency_key),'');
 if v_key is not null then select * into v_receipt from public.pos_receipts where property_id=p_property_id and idempotency_key=v_key limit 1; if v_receipt.id is not null then return v_receipt; end if; end if;
 v_shift:=p_shift_id;
 if v_shift is null then select id into v_shift from public.pos_shifts where property_id=p_property_id and status='open' and date=(now() at time zone 'Africa/Nairobi')::date order by opened_at desc limit 1; end if;
 if v_shift is null or not exists(select 1 from public.pos_shifts where id=v_shift and property_id=p_property_id and status='open') then raise exception 'Open a POS shift before recording sales.'; end if;
 if p_discount_id is not null and not exists(select 1 from public.pos_discounts where id=p_discount_id and property_id=p_property_id and active) then raise exception 'Discount is not active or does not belong to this property.'; end if;
 if p_payment_method='room' then
   if p_reservation_id is null then raise exception 'Select which guest/room to charge.'; end if;
   v_role:=public.current_staff_role(p_property_id);
   if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','manager','admin','owner','property_manager','general_manager','front_office_manager','fb_manager') then raise exception 'Only an authorised cashier or manager can charge a restaurant bill to a room.'; end if;
   select r.property_id,r.room_id,rm.number::text,r.guest_name into v_res_property,v_room_id,v_room_number,v_guest_name from public.reservations r left join public.rooms rm on rm.id=r.room_id where r.id=p_reservation_id and r.status='checked-in';
   if v_res_property is null or v_res_property<>p_property_id then raise exception 'Checked-in reservation not found.'; end if;
   insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,p_reservation_id,'pos',coalesce(nullif(p_order_number,''),'POS sale')||' — Table '||coalesce(p_table_number,''),p_total) returning id into v_folio_charge_id;
 end if;
 perform public.fn_consume_recipe_stock(p_property_id,p_items,coalesce(nullif(p_order_number,''),'POS sale'));
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
   v_qty:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0); v_name:=trim(coalesce(item->>'name',item->>'item_name',''));
   if v_qty>0 and nullif(item->>'product_id','') is not null then
     begin
       select * into v_product from public.products where id=(item->>'product_id')::uuid and property_id=p_property_id for update;
       if v_product.id is not null and not exists(select 1 from public.recipes r where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)) then
         if v_product.current_stock<v_qty then raise exception 'Insufficient stock for % (available %, required %).',v_product.name,v_product.current_stock,v_qty; end if;
         perform public.fn_apply_stock_movement(v_product.id,-v_qty,'POS Sale '||coalesce(p_order_number,''),'pos_sale',null);
       end if;
     exception when invalid_text_representation then null; end;
   end if;
 end loop;
 insert into public.pos_receipts(property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,waiter,items,subtotal,discount_amount,discount_id,discount_name,vat,total,payment_method,folio_charge_id,created_by,shift_id,pos_shift_id,idempotency_key)
 values(p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,p_waiter,coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),p_discount_id,p_discount_name,coalesce(p_vat,0),p_total,p_payment_method,v_folio_charge_id,auth.uid(),null,v_shift,v_key)
 returning * into v_receipt;
 if p_payment_method='split' then
   if jsonb_typeof(coalesce(p_payment_allocations,'null'::jsonb))<>'array' then raise exception 'Split payment allocations are required.'; end if;
   delete from public.pos_receipt_payments where receipt_id=v_receipt.id;
   for a in select value from jsonb_array_elements(p_payment_allocations) loop
     v_method:=lower(trim(coalesce(a->>'method',''))); v_amount:=round(coalesce((a->>'amount')::numeric,0),2); v_res:=nullif(a->>'reservation_id','')::uuid;
     if v_method not in ('cash','card','mpesa','bank','room') then raise exception 'Invalid split payment method: %',v_method; end if;
     if v_amount<=0 then raise exception 'Split payment amounts must be greater than zero.'; end if;
     if v_method='room' then
       if v_res is null or not exists(select 1 from public.reservations where id=v_res and property_id=p_property_id and status='checked-in') then raise exception 'Checked-in reservation required for room-charge allocation.'; end if;
       insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,v_res,'pos','POS split payment '||coalesce(p_order_number,v_receipt.id::text),v_amount) returning id into v_alloc_folio;
     else v_alloc_folio:=null; end if;
     v_sum:=v_sum+v_amount;
     insert into public.pos_receipt_payments(receipt_id,property_id,payment_method,amount,reservation_id,folio_charge_id,created_by) values(v_receipt.id,p_property_id,v_method,v_amount,v_res,v_alloc_folio,auth.uid());
   end loop;
   if round(v_sum,2)<>round(p_total,2) then raise exception 'Split payments total % does not equal receipt total %.',v_sum,p_total; end if;
 end if;
 return v_receipt;
exception when unique_violation then
 select * into v_receipt from public.pos_receipts where property_id=p_property_id and idempotency_key=v_key limit 1;
 if v_receipt.id is not null then return v_receipt; end if;
 raise;
end $function$

-- OBJECT: public.fn_record_stock_usage(p_property_id uuid, p_usage_date date, p_department text, p_product_id uuid, p_qty numeric, p_reference text, p_notes text)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_record_stock_usage(p_property_id uuid, p_usage_date date, p_department text, p_product_id uuid, p_qty numeric, p_reference text, p_notes text)
 RETURNS stock_usage
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.stock_usage;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if p_qty<=0 then raise exception 'Usage quantity must be greater than zero'; end if;
 if not exists(select 1 from public.products where id=p_product_id and property_id=p_property_id) then raise exception 'Product does not belong to property'; end if;
 perform public.fn_apply_stock_movement(p_product_id,-p_qty,coalesce(p_reference,'Stock usage'),'usage',null);
 insert into public.stock_usage(property_id,usage_date,department,product_id,qty,reference,notes,created_by)
 values(p_property_id,coalesce(p_usage_date,current_date),coalesce(nullif(trim(p_department),''),'General'),p_product_id,p_qty,p_reference,p_notes,auth.uid()) returning * into v;
 return v;
end $function$

-- OBJECT: public.fn_reverse_pos_stock(p_property_id uuid, p_items jsonb, p_ratio numeric, p_reference text)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: false
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_reverse_pos_stock(p_property_id uuid, p_items jsonb, p_ratio numeric, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare item jsonb; ing record; v_name text; v_qty numeric; v_needed numeric;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if p_ratio<=0 then return; end if;
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
  v_name:=trim(coalesce(item->>'name',item->>'item_name','')); v_qty:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0)*p_ratio;
  if v_name='' or v_qty<=0 then continue; end if;
  if exists(select 1 from public.recipes r where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)) then
   for ing in select ri.product_id,ri.qty,r.yield_qty from public.recipes r join public.recipe_ingredients ri on ri.recipe_id=r.id where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name) loop
    v_needed:=ing.qty*(v_qty/greatest(ing.yield_qty,0.001)); perform public.fn_apply_stock_movement(ing.product_id,v_needed,p_reference,'pos_reversal',null);
   end loop;
  elsif nullif(item->>'product_id','') is not null then
   begin perform public.fn_apply_stock_movement((item->>'product_id')::uuid,v_qty,p_reference,'pos_reversal',null); exception when invalid_text_representation then null; end;
  end if;
 end loop;
end $function$

-- OBJECT: public.fn_upsert_recipe(p_property_id uuid, p_menu_item_name text, p_yield_qty numeric, p_ingredients jsonb, p_notes text)
-- SECURITY DEFINER: true
-- LANGUAGE: plpgsql
-- CONFIG: ["search_path=public"]
-- EXECUTE authenticated: true
-- EXECUTE anon: false
CREATE OR REPLACE FUNCTION public.fn_upsert_recipe(p_property_id uuid, p_menu_item_name text, p_yield_qty numeric, p_ingredients jsonb, p_notes text DEFAULT NULL::text)
 RETURNS recipes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_recipe public.recipes; v_line jsonb; v_product uuid; v_qty numeric;
begin
if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
if nullif(trim(p_menu_item_name),'') is null then raise exception 'Menu item name is required'; end if;
insert into public.recipes(property_id,menu_item_name,yield_qty,notes) values(p_property_id,trim(p_menu_item_name),coalesce(p_yield_qty,1),p_notes)
on conflict(property_id,menu_item_name) do update set yield_qty=excluded.yield_qty,notes=excluded.notes,active=true returning * into v_recipe;
delete from public.recipe_ingredients where recipe_id=v_recipe.id;
for v_line in select value from jsonb_array_elements(coalesce(p_ingredients,'[]'::jsonb)) loop
v_product:=nullif(v_line->>'product_id','')::uuid; v_qty:=coalesce((v_line->>'qty')::numeric,0);
if v_product is null or v_qty<=0 then raise exception 'Invalid recipe ingredient'; end if;
if not exists(select 1 from public.products where id=v_product and property_id=p_property_id) then raise exception 'Ingredient does not belong to property'; end if;
insert into public.recipe_ingredients(recipe_id,product_id,qty) values(v_recipe.id,v_product,v_qty);
end loop; return v_recipe;
end $function$

