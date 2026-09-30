-- Itemized POS receipts, persisted server-side and linked to the folio.

create table if not exists public.pos_receipts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  room_number text,
  guest_name text,
  table_number text,
  order_number text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  vat numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'mpesa', 'room')),
  folio_charge_id uuid references public.folio_charges(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists pos_receipts_property_idx on public.pos_receipts(property_id, created_at desc);
create index if not exists pos_receipts_reservation_idx on public.pos_receipts(reservation_id);
create index if not exists pos_receipts_room_idx on public.pos_receipts(room_id);

alter table public.pos_receipts enable row level security;

drop policy if exists pos_receipts_select on public.pos_receipts;
create policy pos_receipts_select on public.pos_receipts for select using (public.can_backoffice(property_id));

drop policy if exists pos_receipts_insert on public.pos_receipts;
create policy pos_receipts_insert on public.pos_receipts for insert with check (
  public.can_backoffice(property_id)
  or public.property_role(property_id) in ('cashier', 'waiter')
  or public.current_staff_role(property_id) in ('hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff', 'fb_manager')
);

drop policy if exists pos_receipts_update on public.pos_receipts;
create policy pos_receipts_update on public.pos_receipts for update using (public.can_backoffice(property_id)) with check (public.can_backoffice(property_id));

drop policy if exists pos_receipts_delete on public.pos_receipts;
create policy pos_receipts_delete on public.pos_receipts for delete using (public.can_backoffice(property_id));

create or replace function public.fn_record_pos_sale(
  p_property_id uuid,
  p_table_number text,
  p_order_number text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_vat numeric,
  p_total numeric,
  p_payment_method text,
  p_reservation_id uuid default null
) returns public.pos_receipts
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
  v_res_property uuid;
  v_room_id uuid;
  v_room_number text;
  v_guest_name text;
  v_folio_charge_id uuid;
  v_receipt public.pos_receipts;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  if p_payment_method not in ('cash', 'card', 'mpesa', 'room') then
    raise exception 'Unknown payment method.';
  end if;
  if p_total <= 0 then
    raise exception 'Total must be greater than zero.';
  end if;

  if p_payment_method = 'room' then
    if p_reservation_id is null then
      raise exception 'Select which guest/room to charge.';
    end if;

    v_role := public.current_staff_role(p_property_id);
    if v_role is not null then
      if v_role not in ('hotel_admin', 'super_admin', 'cashier') then
        raise exception 'Only an authorised cashier can charge a restaurant bill to a room.';
      end if;
    elsif not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner', 'admin', 'manager', 'cashier')) then
      raise exception 'Only an authorised cashier or manager can charge a restaurant bill to a room.';
    end if;

    select r.property_id, r.room_id, rm.number::text, r.guest_name
      into v_res_property, v_room_id, v_room_number, v_guest_name
      from public.reservations r
      left join public.rooms rm on rm.id = r.room_id
      where r.id = p_reservation_id;

    if v_res_property is null or v_res_property <> p_property_id then
      raise exception 'Reservation not found.';
    end if;

    insert into public.folio_charges (property_id, reservation_id, source, description, amount)
      values (p_property_id, p_reservation_id, 'pos', coalesce(nullif(p_order_number, ''), 'POS sale') || ' — Table ' || coalesce(p_table_number, ''), p_total)
      returning id into v_folio_charge_id;
  end if;

  insert into public.pos_receipts (
    property_id, reservation_id, room_id, room_number, guest_name, table_number,
    order_number, items, subtotal, discount_amount, vat, total, payment_method,
    folio_charge_id, created_by
  ) values (
    p_property_id, p_reservation_id, v_room_id, v_room_number, v_guest_name, p_table_number,
    p_order_number, coalesce(p_items, '[]'::jsonb), coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0),
    coalesce(p_vat, 0), p_total, p_payment_method, v_folio_charge_id, auth.uid()
  ) returning * into v_receipt;

  return v_receipt;
end;
$$;
grant execute on function public.fn_record_pos_sale(uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text, uuid) to authenticated;
