-- Phase 4: authoritative inventory ledger
alter table public.stock_movements add column if not exists source_type text;
alter table public.stock_movements add column if not exists source_id uuid;
create index if not exists stock_movements_property_product_created_idx on public.stock_movements(property_id,product_id,created_at desc);
create index if not exists stock_movements_source_idx on public.stock_movements(property_id,source_type,source_id);

do $$
declare r record; v_ledger numeric; v_delta numeric;
begin
 for r in select id,property_id,current_stock from public.products loop
  select coalesce(sum(case when type in ('in','opening','transfer_in','return','adjustment_in') then qty else -qty end),0) into v_ledger from public.stock_movements where product_id=r.id;
  v_delta:=round(coalesce(r.current_stock,0)-v_ledger,6);
  if abs(v_delta)>0.000001 then
   insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id,source_type)
   values(r.property_id,r.id,case when v_delta>0 then 'opening' else 'out' end,abs(v_delta),'Opening balance reconciliation',auth.uid(),'opening_balance');
  end if;
 end loop;
end $$;

create or replace function public.fn_apply_stock_movement(p_product_id uuid,p_change numeric,p_reason text,p_source_type text default null,p_source_id uuid default null)
returns public.products language plpgsql security definer set search_path=public as $$
declare v public.products; v_type text;
begin
 select * into v from public.products where id=p_product_id for update;
 if v.id is null then raise exception 'Product not found.'; end if;
 if not(public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not allowed.'; end if;
 if p_change=0 then return v; end if;
 if p_change<0 and v.current_stock+p_change<0 then raise exception 'Insufficient stock for % (available %, required %).',v.name,v.current_stock,abs(p_change); end if;
 v_type:=case when p_change>0 then 'in' else 'out' end;
 update public.products set current_stock=current_stock+p_change,updated_at=now() where id=p_product_id returning * into v;
 insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id,source_type,source_id)
 values(v.property_id,v.id,v_type,abs(p_change),nullif(trim(p_reason),''),auth.uid(),p_source_type,p_source_id);
 if v.current_stock<=0 then
  insert into public.low_stock_alerts(property_id,product_id,alert_type) values(v.property_id,v.id,'out_of_stock');
 elsif v.current_stock<=v.min_stock then
  insert into public.low_stock_alerts(property_id,product_id,alert_type) values(v.property_id,v.id,'low_stock');
 end if;
 return v;
end $$;

create or replace function public.fn_adjust_product_stock(p_product_id uuid,p_change numeric,p_reason text)
returns public.products language plpgsql security definer set search_path=public as $$
begin return public.fn_apply_stock_movement(p_product_id,p_change,p_reason,'manual_adjustment',null); end $$;

create or replace function public.fn_consume_recipe_stock(p_property_id uuid,p_items jsonb,p_reference text default 'POS sale')
returns jsonb language plpgsql security definer set search_path=public as $$
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
end $$;

create or replace function public.fn_reverse_pos_stock(p_property_id uuid,p_items jsonb,p_ratio numeric,p_reference text)
returns void language plpgsql security definer set search_path=public as $$
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
end $$;

create or replace function public.fn_create_and_receive_purchase(p_property_id uuid,p_supplier_id uuid,p_invoice_no text,p_purchase_date date,p_lines jsonb)
returns public.purchase_orders language plpgsql security definer set search_path=public as $$
declare v_po public.purchase_orders; l jsonb; pid uuid; qty numeric; cost numeric; total numeric:=0; v_product public.products; v_old_stock numeric; v_old_cost numeric;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'At least one purchase line is required'; end if;
 for l in select value from jsonb_array_elements(p_lines) loop
  pid:=nullif(l->>'product_id','')::uuid; qty:=coalesce((l->>'qty')::numeric,0); cost:=coalesce((l->>'unit_cost')::numeric,0);
  if pid is null or qty<=0 or cost<0 then raise exception 'Invalid purchase line'; end if;
  if not exists(select 1 from public.products where id=pid and property_id=p_property_id) then raise exception 'Product does not belong to this property'; end if;
  total:=total+qty*cost;
 end loop;
 insert into public.purchase_orders(property_id,supplier_id,invoice_no,purchase_date,lines,total,status,created_by,received_at,received_by)
 values(p_property_id,p_supplier_id,nullif(trim(p_invoice_no),''),coalesce(p_purchase_date,current_date),p_lines,total,'received',auth.uid(),now(),auth.uid()) returning * into v_po;
 for l in select value from jsonb_array_elements(p_lines) loop
  pid:=(l->>'product_id')::uuid; qty:=(l->>'qty')::numeric; cost:=coalesce((l->>'unit_cost')::numeric,0);
  select current_stock,cost_price into v_old_stock,v_old_cost from public.products where id=pid and property_id=p_property_id for update;
  perform public.fn_apply_stock_movement(pid,qty,'GRN / Purchase '||coalesce(v_po.invoice_no,v_po.id::text),'purchase',v_po.id);
  if cost>0 then
   update public.products set cost_price=case when coalesce(v_old_stock,0)+qty>0 then round(((coalesce(v_old_stock,0)*coalesce(v_old_cost,0))+(qty*cost))/(coalesce(v_old_stock,0)+qty),4) else cost end,updated_at=now() where id=pid;
  end if;
 end loop;
 return v_po;
end $$;

create or replace function public.fn_record_stock_usage(p_property_id uuid,p_usage_date date,p_department text,p_product_id uuid,p_qty numeric,p_reference text,p_notes text)
returns public.stock_usage language plpgsql security definer set search_path=public as $$
declare v public.stock_usage;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if p_qty<=0 then raise exception 'Usage quantity must be greater than zero'; end if;
 if not exists(select 1 from public.products where id=p_product_id and property_id=p_property_id) then raise exception 'Product does not belong to property'; end if;
 perform public.fn_apply_stock_movement(p_product_id,-p_qty,coalesce(p_reference,'Stock usage'),'usage',null);
 insert into public.stock_usage(property_id,usage_date,department,product_id,qty,reference,notes,created_by)
 values(p_property_id,coalesce(p_usage_date,current_date),coalesce(nullif(trim(p_department),''),'General'),p_product_id,p_qty,p_reference,p_notes,auth.uid()) returning * into v;
 return v;
end $$;

revoke all on function public.fn_apply_stock_movement(uuid,numeric,text,text,uuid) from public,anon,authenticated;
revoke insert,update,delete on public.stock_movements from public,anon,authenticated;
revoke insert,update,delete on public.stock_usage from public,anon,authenticated;
grant select on public.stock_movements to authenticated;
grant select on public.stock_usage to authenticated;
grant execute on function public.fn_adjust_product_stock(uuid,numeric,text) to authenticated;
revoke all on function public.fn_consume_recipe_stock(uuid,jsonb,text) from public,anon;\ngrant execute on function public.fn_consume_recipe_stock(uuid,jsonb,text) to authenticated;
revoke all on function public.fn_create_and_receive_purchase(uuid,uuid,text,date,jsonb) from public,anon;\ngrant execute on function public.fn_create_and_receive_purchase(uuid,uuid,text,date,jsonb) to authenticated;
revoke all on function public.fn_record_stock_usage(uuid,date,text,uuid,numeric,text,text) from public,anon;\ngrant execute on function public.fn_record_stock_usage(uuid,date,text,uuid,numeric,text,text) to authenticated;

create or replace view public.inventory_stock_history as
select sm.id,sm.property_id,sm.product_id,p.name product_name,p.sku,p.category,p.unit,sm.type,sm.qty,
case when sm.type in ('in','opening','transfer_in','return','adjustment_in') then sm.qty else -sm.qty end signed_qty,
sm.reason,sm.source_type,sm.source_id,sm.user_id,sm.created_at
from public.stock_movements sm join public.products p on p.id=sm.product_id;

create or replace function public.fn_inventory_valuation(p_property_id uuid)
returns table(product_id uuid,sku text,name text,category text,unit text,current_stock numeric,cost_price numeric,stock_value numeric)
language sql security invoker set search_path=public as $$
select p.id,p.sku,p.name,p.category,p.unit,p.current_stock,p.cost_price,round(p.current_stock*p.cost_price,2)
from public.products p where p.property_id=p_property_id order by p.category,p.name
$$;

create or replace function public.fn_inventory_reconciliation(p_property_id uuid)
returns table(product_id uuid,name text,current_stock numeric,ledger_stock numeric,difference numeric)
language sql security invoker set search_path=public as $$
select p.id,p.name,p.current_stock,coalesce(sum(case when sm.type in ('in','opening','transfer_in','return','adjustment_in') then sm.qty else -sm.qty end),0) ledger_stock,
round(p.current_stock-coalesce(sum(case when sm.type in ('in','opening','transfer_in','return','adjustment_in') then sm.qty else -sm.qty end),0),6) difference
from public.products p left join public.stock_movements sm on sm.product_id=p.id
where p.property_id=p_property_id group by p.id,p.name,p.current_stock
order by abs(round(p.current_stock-coalesce(sum(case when sm.type in ('in','opening','transfer_in','return','adjustment_in') then sm.qty else -sm.qty end),0),6)) desc,p.name
$$;
grant execute on function public.fn_inventory_valuation(uuid) to authenticated;
grant execute on function public.fn_inventory_reconciliation(uuid) to authenticated;