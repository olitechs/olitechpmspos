-- Phase 2: immutable issuance-time POS receipt document snapshots.
--
-- The active split-tender sale overload (16 arguments) does not allocate a
-- receipt number. The older 10-argument overload does. Keep the sale ledger
-- function untouched and repair numbering/snapshot capture in both active
-- VAT wrapper overloads, in the same transaction as the sale.
--
-- Existing receipts are deliberately not backfilled: current company settings
-- cannot prove what their historical printed header/footer contained.

begin;

alter table public.pos_receipts
  add column if not exists receipt_document_snapshot jsonb;

comment on column public.pos_receipts.receipt_document_snapshot is
  'Immutable issuance-time company and POS receipt document snapshot. NULL on legacy receipts until a trustworthy source exists.';

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
  v_company_snapshot jsonb;
  v_payment_snapshot jsonb;
  v_receipt_number text;
  v_is_new boolean := false;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  -- Lock the current company-settings row while the sale is committed so a
  -- concurrent settings edit cannot change the values halfway through issue.
  select jsonb_build_object(
    'property_name', ps.property_name,
    'logo_url', ps.logo_url,
    'address_line1', ps.address_line1,
    'address_line2', ps.address_line2,
    'phone', ps.phone,
    'email', ps.email,
    'website', ps.website,
    'kra_pin', ps.kra_pin,
    'extra_header_line', ps.extra_header_line,
    'footer_line1', ps.footer_line1,
    'footer_line2', ps.footer_line2
  )
  into v_company_snapshot
  from public.property_settings ps
  where ps.property_id = p_property_id
  for share;

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

  -- New rows use now()/transaction_timestamp() as created_at. A row returned
  -- by the idempotency path was created in an earlier transaction and must not
  -- receive a newly reconstructed historical company snapshot.
  v_is_new := coalesce(v_receipt.created_at >= transaction_timestamp(), false);

  if v_is_new and v_receipt.receipt_number is null then
    v_receipt_number := public.fn_allocate_document_number(p_property_id, 'receipt', null);
  else
    v_receipt_number := v_receipt.receipt_number;
  end if;

  update public.pos_receipts
  set receipt_number = coalesce(receipt_number, v_receipt_number),
      vat_snapshot = coalesce(vat_snapshot, p_vat_snapshot)
  where id = v_receipt.id
  returning * into v_receipt;

  if v_is_new and v_receipt.receipt_document_snapshot is null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'payment_method', rp.payment_method,
          'amount', rp.amount,
          'reservation_id', rp.reservation_id,
          'folio_charge_id', rp.folio_charge_id,
          'created_at', rp.created_at
        ) order by rp.created_at, rp.id
      ),
      case
        when v_receipt.payment_method <> 'split' then jsonb_build_array(
          jsonb_build_object(
            'payment_method', v_receipt.payment_method,
            'amount', v_receipt.total,
            'reservation_id', v_receipt.reservation_id,
            'folio_charge_id', v_receipt.folio_charge_id
          )
        )
        else '[]'::jsonb
      end
    )
    into v_payment_snapshot
    from public.pos_receipt_payments rp
    where rp.receipt_id = v_receipt.id
      and rp.property_id = p_property_id;

    update public.pos_receipts
    set receipt_document_snapshot = jsonb_build_object(
      'schema_version', 1,
      'captured_at', clock_timestamp(),
      'company', v_company_snapshot,
      'receipt', jsonb_build_object(
        'id', v_receipt.id,
        'receipt_number', v_receipt.receipt_number,
        'receipt_book', v_receipt.receipt_book,
        'receipt_status', v_receipt.receipt_status,
        'created_at', v_receipt.created_at,
        'order_number', v_receipt.order_number,
        'table_number', v_receipt.table_number,
        'waiter', v_receipt.waiter,
        'covers', v_receipt.covers,
        'guest_name', v_receipt.guest_name,
        'room_id', v_receipt.room_id,
        'room_number', v_receipt.room_number,
        'reservation_id', v_receipt.reservation_id,
        'folio_charge_id', v_receipt.folio_charge_id,
        'shift_id', v_receipt.shift_id,
        'pos_shift_id', v_receipt.pos_shift_id,
        'items', v_receipt.items,
        'subtotal', v_receipt.subtotal,
        'discount_amount', v_receipt.discount_amount,
        'discount_id', v_receipt.discount_id,
        'discount_name', v_receipt.discount_name,
        'vat', v_receipt.vat,
        'vat_snapshot', v_receipt.vat_snapshot,
        'total', v_receipt.total,
        'payment_method', v_receipt.payment_method,
        'created_by', v_receipt.created_by
      ),
      'payment_allocations', coalesce(v_payment_snapshot, '[]'::jsonb)
    )
    where id = v_receipt.id
      and receipt_document_snapshot is null
    returning * into v_receipt;
  end if;

  return v_receipt;
end;
$$;

revoke all on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb
) from public, anon;
grant execute on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb
) to authenticated;

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
  p_vat_snapshot jsonb default null,
  p_covers integer default 1
) returns public.pos_receipts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.pos_receipts;
  v_company_snapshot jsonb;
  v_payment_snapshot jsonb;
  v_receipt_number text;
  v_is_new boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not (
    public.is_platform_owner()
    or public.is_member_of_property(p_property_id)
  ) then
    raise exception 'Not allowed.';
  end if;

  if p_covers is null or p_covers < 1 or p_covers > 1000 then
    raise exception 'Covers must be between 1 and 1000.';
  end if;

  select jsonb_build_object(
    'property_name', ps.property_name,
    'logo_url', ps.logo_url,
    'address_line1', ps.address_line1,
    'address_line2', ps.address_line2,
    'phone', ps.phone,
    'email', ps.email,
    'website', ps.website,
    'kra_pin', ps.kra_pin,
    'extra_header_line', ps.extra_header_line,
    'footer_line1', ps.footer_line1,
    'footer_line2', ps.footer_line2
  )
  into v_company_snapshot
  from public.property_settings ps
  where ps.property_id = p_property_id
  for share;

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

  v_is_new := coalesce(v_receipt.created_at >= transaction_timestamp(), false);

  if v_is_new and v_receipt.receipt_number is null then
    v_receipt_number := public.fn_allocate_document_number(p_property_id, 'receipt', null);
  else
    v_receipt_number := v_receipt.receipt_number;
  end if;

  update public.pos_receipts
  set receipt_number = coalesce(receipt_number, v_receipt_number),
      vat_snapshot = coalesce(vat_snapshot, p_vat_snapshot),
      covers = greatest(1, least(p_covers, 1000))
  where id = v_receipt.id
  returning * into v_receipt;

  if v_is_new and v_receipt.receipt_document_snapshot is null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'payment_method', rp.payment_method,
          'amount', rp.amount,
          'reservation_id', rp.reservation_id,
          'folio_charge_id', rp.folio_charge_id,
          'created_at', rp.created_at
        ) order by rp.created_at, rp.id
      ),
      case
        when v_receipt.payment_method <> 'split' then jsonb_build_array(
          jsonb_build_object(
            'payment_method', v_receipt.payment_method,
            'amount', v_receipt.total,
            'reservation_id', v_receipt.reservation_id,
            'folio_charge_id', v_receipt.folio_charge_id
          )
        )
        else '[]'::jsonb
      end
    )
    into v_payment_snapshot
    from public.pos_receipt_payments rp
    where rp.receipt_id = v_receipt.id
      and rp.property_id = p_property_id;

    update public.pos_receipts
    set receipt_document_snapshot = jsonb_build_object(
      'schema_version', 1,
      'captured_at', clock_timestamp(),
      'company', v_company_snapshot,
      'receipt', jsonb_build_object(
        'id', v_receipt.id,
        'receipt_number', v_receipt.receipt_number,
        'receipt_book', v_receipt.receipt_book,
        'receipt_status', v_receipt.receipt_status,
        'created_at', v_receipt.created_at,
        'order_number', v_receipt.order_number,
        'table_number', v_receipt.table_number,
        'waiter', v_receipt.waiter,
        'covers', v_receipt.covers,
        'guest_name', v_receipt.guest_name,
        'room_id', v_receipt.room_id,
        'room_number', v_receipt.room_number,
        'reservation_id', v_receipt.reservation_id,
        'folio_charge_id', v_receipt.folio_charge_id,
        'shift_id', v_receipt.shift_id,
        'pos_shift_id', v_receipt.pos_shift_id,
        'items', v_receipt.items,
        'subtotal', v_receipt.subtotal,
        'discount_amount', v_receipt.discount_amount,
        'discount_id', v_receipt.discount_id,
        'discount_name', v_receipt.discount_name,
        'vat', v_receipt.vat,
        'vat_snapshot', v_receipt.vat_snapshot,
        'total', v_receipt.total,
        'payment_method', v_receipt.payment_method,
        'created_by', v_receipt.created_by
      ),
      'payment_allocations', coalesce(v_payment_snapshot, '[]'::jsonb)
    )
    where id = v_receipt.id
      and receipt_document_snapshot is null
    returning * into v_receipt;
  end if;

  return v_receipt;
end;
$$;

revoke all on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb,integer
) from public, anon;
grant execute on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb,integer
) to authenticated;

notify pgrst, 'reload schema';

commit;
