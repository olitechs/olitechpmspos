-- Phase 4 GRN / receiving hardening.
-- Live schema was applied through Supabase MCP before this migration parity file was committed.

create table if not exists public.goods_receipts(
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
 grn_no text not null,
 received_at timestamptz not null default now(),
 received_by uuid references public.profiles(id) on delete set null,
 notes text
);
create unique index if not exists goods_receipts_po_grn_idx on public.goods_receipts(purchase_order_id,grn_no);
create table if not exists public.goods_receipt_lines(
 id uuid primary key default gen_random_uuid(),
 goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 qty numeric(14,3) not null check(qty>0),
 unit_cost numeric(14,4) not null default 0
);
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
drop policy if exists goods_receipts_select on public.goods_receipts;
create policy goods_receipts_select on public.goods_receipts for select to authenticated using(is_platform_owner() or is_member_of_property(property_id));
drop policy if exists goods_receipt_lines_select on public.goods_receipt_lines;
create policy goods_receipt_lines_select on public.goods_receipt_lines for select to authenticated using(exists(select 1 from public.goods_receipts g where g.id=goods_receipt_id and (is_platform_owner() or is_member_of_property(g.property_id))));
revoke all on public.goods_receipts,public.goods_receipt_lines from anon,authenticated;
grant select on public.goods_receipts,public.goods_receipt_lines to authenticated;

-- fn_receive_purchase_order now creates an auditable GRN, prevents over-receiving,
-- supports partial receipt status, and routes stock changes through fn_apply_stock_movement.

create or replace function public.fn_receive_purchase_order(p_purchase_order_id uuid,p_received_lines jsonb default null)
returns public.purchase_orders language plpgsql security definer set search_path=public as $$
declare po public.purchase_orders; line jsonb; pid uuid; qty numeric; cost numeric; ordered numeric; already numeric; remaining numeric; grn public.goods_receipts; grnno text; old_stock numeric; old_cost numeric; all_received boolean:=true; x jsonb;
begin
 select * into po from public.purchase_orders where id=p_purchase_order_id for update;
 if not found then raise exception 'Purchase order not found'; end if;
 if not(public.is_platform_owner() or public.is_member_of_property(po.property_id)) then raise exception 'Not authorized for this property'; end if;
 if po.status in ('received','cancelled') then raise exception 'Purchase order cannot be received in its current status'; end if;
 if coalesce(jsonb_array_length(p_received_lines),0)=0 then p_received_lines:=po.lines; end if;
 grnno:='GRN-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6);
 insert into public.goods_receipts(property_id,purchase_order_id,grn_no,received_by) values(po.property_id,po.id,grnno,auth.uid()) returning * into grn;
 for line in select value from jsonb_array_elements(p_received_lines) loop
  pid:=nullif(line->>'product_id','')::uuid; qty:=coalesce((line->>'qty')::numeric,0); cost:=coalesce((line->>'unit_cost')::numeric,0);
  if pid is null or qty<=0 then raise exception 'Each received line requires product_id and qty > 0'; end if;
  select coalesce((x->>'qty')::numeric,0) into ordered from jsonb_array_elements(po.lines) x where (x->>'product_id')=pid::text limit 1;
  if ordered is null then raise exception 'Product is not on this purchase order'; end if;
  select coalesce(sum(l.qty),0) into already from public.goods_receipt_lines l join public.goods_receipts g on g.id=l.goods_receipt_id where g.purchase_order_id=po.id and l.product_id=pid;
  remaining:=ordered-already;
  if qty>remaining then raise exception 'Received quantity for product exceeds ordered quantity'; end if;
  select current_stock,cost_price into old_stock,old_cost from public.products where id=pid and property_id=po.property_id for update;
  perform public.fn_apply_stock_movement(pid,qty,'GRN '||grn.grn_no,'purchase',grn.id);
  if cost>0 then update public.products set cost_price=case when coalesce(old_stock,0)+qty>0 then round(((coalesce(old_stock,0)*coalesce(old_cost,0))+(qty*cost))/(coalesce(old_stock,0)+qty),4) else cost end,updated_at=now() where id=pid; end if;
  insert into public.goods_receipt_lines(goods_receipt_id,product_id,qty,unit_cost) values(grn.id,pid,qty,cost);
 end loop;
 for x in select value from jsonb_array_elements(po.lines) loop
  pid:=nullif(x->>'product_id','')::uuid; ordered:=coalesce((x->>'qty')::numeric,0);
  select coalesce(sum(l.qty),0) into already from public.goods_receipt_lines l join public.goods_receipts g on g.id=l.goods_receipt_id where g.purchase_order_id=po.id and l.product_id=pid;
  if already<ordered then all_received:=false; end if;
 end loop;
 update public.purchase_orders set status=case when all_received then 'received' else 'partial' end,received_at=case when all_received then now() else received_at end,received_by=auth.uid() where id=po.id returning * into po;
 return po;
end $$;
revoke all on function public.fn_receive_purchase_order(uuid,jsonb) from public,anon;
grant execute on function public.fn_receive_purchase_order(uuid,jsonb) to authenticated;
