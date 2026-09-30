-- Purchasing 2.0: approval and receiving workflow for purchase orders.
alter table public.purchase_orders
  add column if not exists status text not null default 'draft',
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
  alter table public.purchase_orders add constraint purchase_orders_status_check
    check (status in ('draft','ordered','partially_received','received','cancelled'));
exception when duplicate_object then null;
end $$;

create index if not exists purchase_orders_status_idx
  on public.purchase_orders(property_id, status, purchase_date desc);

create or replace function public.fn_receive_purchase_order(
  p_purchase_order_id uuid,
  p_received_lines jsonb default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_product public.products;
begin
  select * into v_po from public.purchase_orders
  where id = p_purchase_order_id for update;

  if not found then raise exception 'Purchase order not found'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(v_po.property_id)) then
    raise exception 'Not authorized for this property';
  end if;
  if v_po.status in ('received','cancelled') then
    raise exception 'Purchase order cannot be received in its current status';
  end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_received_lines, v_po.lines))
  loop
    v_product_id := nullif(v_line->>'product_id','')::uuid;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    if v_product_id is null or v_qty <= 0 then
      raise exception 'Each received line requires product_id and qty > 0';
    end if;

    select * into v_product from public.products
    where id = v_product_id and property_id = v_po.property_id
    for update;
    if not found then raise exception 'Product not found in this property'; end if;

    update public.products
      set current_stock = current_stock + v_qty,
          cost_price = coalesce(nullif((v_line->>'unit_cost')::numeric,0), cost_price),
          updated_at = now()
    where id = v_product_id;

    insert into public.stock_movements(property_id, product_id, type, qty, reason, user_id)
      values(v_po.property_id, v_product_id, 'in', v_qty,
             'Purchase order ' || coalesce(v_po.invoice_no, v_po.id::text), auth.uid());
  end loop;

  update public.purchase_orders
    set status = 'received', received_at = now(), received_by = auth.uid()
  where id = v_po.id
  returning * into v_po;

  return v_po;
end;
$$;

create or replace function public.fn_create_purchase_order(
  p_property_id uuid,
  p_supplier_id uuid,
  p_lines jsonb,
  p_invoice_no text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders;
  v_total numeric := 0;
  v_line jsonb;
  v_product_id uuid;
  v_qty numeric;
  v_cost numeric;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one purchase line is required';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_product_id := nullif(v_line->>'product_id','')::uuid;
    v_qty := coalesce((v_line->>'qty')::numeric, 0);
    v_cost := coalesce((v_line->>'unit_cost')::numeric, 0);
    if v_product_id is null or v_qty <= 0 or v_cost < 0 then
      raise exception 'Invalid purchase line';
    end if;
    if not exists (select 1 from public.products where id = v_product_id and property_id = p_property_id) then
      raise exception 'Product does not belong to this property';
    end if;
    v_total := v_total + (v_qty * v_cost);
  end loop;

  insert into public.purchase_orders(property_id, supplier_id, invoice_no, lines, total, status, created_by)
  values(p_property_id, p_supplier_id, nullif(trim(p_invoice_no),''), p_lines, v_total, 'ordered', auth.uid())
  returning * into v_po;

  return v_po;
end;
$$;

grant execute on function public.fn_create_purchase_order(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.fn_receive_purchase_order(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
