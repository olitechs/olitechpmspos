-- Persist the exact property VAT treatment with every completed POS sale.
alter table public.pos_receipts
  add column if not exists vat_snapshot jsonb;

-- Keep the existing transactional sale function and its stock, folio,
-- split-payment and idempotency behavior intact. This wrapper adds only the
-- immutable tax snapshot within the same database transaction.
create or replace function public.fn_record_pos_sale_with_vat_snapshot(
  p_property_id uuid,
  p_table_number text,
  p_order_number text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_vat numeric,
  p_total numeric,
  p_payment_method text,
  p_reservation_id uuid default null,
  p_shift_id uuid default null,
  p_waiter text default null,
  p_discount_id uuid default null,
  p_discount_name text default null,
  p_idempotency_key text default null,
  p_payment_allocations jsonb default null,
  p_vat_snapshot jsonb default null
) returns public.pos_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.pos_receipts;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  v_receipt := public.fn_record_pos_sale(
    p_property_id,
    p_table_number,
    p_order_number,
    p_items,
    p_subtotal,
    p_discount_amount,
    p_vat,
    p_total,
    p_payment_method,
    p_reservation_id,
    p_shift_id,
    p_waiter,
    p_discount_id,
    p_discount_name,
    p_idempotency_key,
    p_payment_allocations
  );

  update public.pos_receipts
  set vat_snapshot = coalesce(vat_snapshot, p_vat_snapshot)
  where id = v_receipt.id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke all on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb
) from public, anon;
grant execute on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb
) to authenticated;

notify pgrst, 'reload schema';
