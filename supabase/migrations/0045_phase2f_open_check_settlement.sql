-- OliTechs PMS/POS — Phase 2F open-check settlement integrity
-- Adds atomic settlement, persisted payment allocations and table-session linkage.
-- Existing POS/KDS/printer/PMS workflows remain intact.

alter table public.pos_receipts
  add column if not exists table_session_id uuid references public.pos_table_sessions(id) on delete set null;

create unique index if not exists pos_receipts_table_session_unique
  on public.pos_receipts(table_session_id)
  where table_session_id is not null;

alter table public.pos_receipts
  drop constraint if exists pos_receipts_payment_method_check;

alter table public.pos_receipts
  add constraint pos_receipts_payment_method_check
  check (payment_method in ('cash','card','mpesa','room','split'));

create table if not exists public.pos_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  pos_receipt_id uuid not null references public.pos_receipts(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  method text not null check (method in ('cash','card','mpesa','room')),
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_payment_allocations_property_idx
  on public.pos_payment_allocations(property_id, created_at desc);
create index if not exists pos_payment_allocations_receipt_idx
  on public.pos_payment_allocations(pos_receipt_id);

alter table public.pos_payment_allocations enable row level security;

drop policy if exists pos_payment_allocations_select on public.pos_payment_allocations;
create policy pos_payment_allocations_select
  on public.pos_payment_allocations for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_payment_allocations_insert on public.pos_payment_allocations;
create policy pos_payment_allocations_insert
  on public.pos_payment_allocations for insert
  with check (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_settle_pos_table_session(
  p_property_id uuid,
  p_table_session_id uuid,
  p_table_number text,
  p_order_number text,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_vat numeric,
  p_total numeric,
  p_allocations jsonb
) returns public.pos_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.pos_table_sessions;
  v_receipt public.pos_receipts;
  v_shift_id uuid;
  v_reservation public.reservations;
  v_folio_charge_id uuid;
  v_method text;
  v_allocation jsonb;
  v_amount numeric;
  v_sum numeric := 0;
  v_allocation_count integer := 0;
  v_room_count integer := 0;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  if p_total <= 0 then
    raise exception 'Total must be greater than zero.';
  end if;

  select * into v_session
  from public.pos_table_sessions
  where id = p_table_session_id
    and property_id = p_property_id
  for update;

  if v_session.id is null then
    raise exception 'Open table session not found.';
  end if;

  if v_session.status = 'closed' then
    select * into v_receipt
    from public.pos_receipts
    where table_session_id = p_table_session_id
    order by created_at desc
    limit 1;
    if v_receipt.id is not null then
      return v_receipt;
    end if;
    raise exception 'Table session is already closed.';
  end if;

  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'Payment allocations must be an array.';
  end if;

  for v_allocation in select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_method := lower(trim(coalesce(v_allocation->>'method','')));
    v_amount := round(coalesce((v_allocation->>'amount')::numeric, 0), 2);

    if v_method not in ('cash','card','mpesa','room') then
      raise exception 'Invalid payment method.';
    end if;
    if v_amount <= 0 then
      raise exception 'Payment allocation must be greater than zero.';
    end if;

    v_sum := v_sum + v_amount;
    v_allocation_count := v_allocation_count + 1;

    if v_method = 'room' then
      v_room_count := v_room_count + 1;
      if v_allocation->>'reservationId' is null or nullif(trim(v_allocation->>'reservationId'),'') is null then
        raise exception 'Select a checked-in guest for the room charge.';
      end if;
    end if;
  end loop;

  if v_allocation_count = 0 then
    raise exception 'At least one payment method is required.';
  end if;

  if abs(v_sum - round(p_total, 2)) > 0.009 then
    raise exception 'Payment allocations must equal the total due.';
  end if;

  if v_room_count > 0 then
    if v_room_count > 1 then
      raise exception 'Only one room folio allocation is supported per settlement.';
    end if;

    v_allocation := (
      select value
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
      where lower(trim(coalesce(value->>'method',''))) = 'room'
      limit 1
    );

    select r.*
      into v_reservation
      from public.reservations r
      where r.id = (v_allocation->>'reservationId')::uuid
        and r.property_id = p_property_id
        and r.status = 'checked-in'
      for update;

    if v_reservation.id is null then
      raise exception 'The selected room is not attached to an active checked-in stay.';
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
    where lower(trim(coalesce(a->>'method',''))) in ('cash','card','mpesa')
  ) then
    select id into v_shift_id
    from public.cashier_shifts
    where property_id = p_property_id
      and opened_by = auth.uid()
      and status = 'open'
    order by opened_at desc
    limit 1;

    if v_shift_id is null then
      raise exception 'Open a cashier shift before recording a cash, card or M-Pesa payment.';
    end if;
  end if;

  if v_room_count = 1 then
    v_allocation := (
      select value
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
      where lower(trim(coalesce(value->>'method',''))) = 'room'
      limit 1
    );

    insert into public.folio_charges (
      property_id, reservation_id, source, description, amount
    ) values (
      p_property_id,
      v_reservation.id,
      'pos',
      coalesce(nullif(trim(p_order_number), ''), 'POS sale') || ' — Table ' || coalesce(p_table_number, ''),
      round((v_allocation->>'amount')::numeric, 2)
    )
    returning id into v_folio_charge_id;
  end if;

  insert into public.pos_receipts (
    property_id,
    reservation_id,
    room_id,
    room_number,
    guest_name,
    table_number,
    order_number,
    table_session_id,
    items,
    subtotal,
    discount_amount,
    vat,
    total,
    payment_method,
    folio_charge_id,
    created_by,
    shift_id
  ) values (
    p_property_id,
    case when v_room_count = 1 then v_reservation.id else null end,
    case when v_room_count = 1 then v_reservation.room_id else null end,
    null,
    case when v_room_count = 1 then v_reservation.guest_name else null end,
    p_table_number,
    p_order_number,
    p_table_session_id,
    coalesce(p_items, '[]'::jsonb),
    coalesce(p_subtotal, 0),
    coalesce(p_discount_amount, 0),
    coalesce(p_vat, 0),
    round(p_total, 2),
    case when v_allocation_count > 1 then 'split' else (
      select lower(trim(value->>'method'))
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
      limit 1
    ) end,
    v_folio_charge_id,
    auth.uid(),
    v_shift_id
  )
  returning * into v_receipt;

  for v_allocation in select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    insert into public.pos_payment_allocations (
      property_id, pos_receipt_id, reservation_id, method, amount, created_by
    ) values (
      p_property_id,
      v_receipt.id,
      case when lower(trim(v_allocation->>'method')) = 'room' then (v_allocation->>'reservationId')::uuid else null end,
      lower(trim(v_allocation->>'method')),
      round((v_allocation->>'amount')::numeric, 2),
      auth.uid()
    );
  end loop;

  update public.pos_table_sessions
  set status = 'closed',
      closed_at = now(),
      updated_at = now()
  where id = p_table_session_id;

  return v_receipt;
end;
$$;

grant execute on function public.fn_settle_pos_table_session(
  uuid,uuid,text,text,jsonb,numeric,numeric,numeric,jsonb
) to authenticated;

create or replace function public.fn_list_pos_payment_allocations(
  p_property_id uuid,
  p_receipt_id uuid
) returns setof public.pos_payment_allocations
language sql
security definer
stable
set search_path = public
as $$
  select *
  from public.pos_payment_allocations
  where property_id = p_property_id
    and pos_receipt_id = p_receipt_id
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
  order by created_at asc;
$$;

grant execute on function public.fn_list_pos_payment_allocations(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';
