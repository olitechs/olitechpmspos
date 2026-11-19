-- Phase 1: master data and receipt integrity for the Visiwa document workflow.
--
-- Additive and idempotent. Nothing is dropped, truncated or rewritten. The
-- Visiwa-specific seed only runs when a property named like Visiwa exists, and
-- every seed insert uses "on conflict do nothing" so existing inventory,
-- room types, rates and numbering are never overwritten.

begin;

-- ---------------------------------------------------------------------------
-- Revenue departments (FOOD, BEVERAGES, SPA, ... F/E, INTEREST, TRANSFER)
-- ---------------------------------------------------------------------------
create table if not exists public.revenue_departments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  code text not null,
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  hidden_when_empty boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, code)
);
create index if not exists revenue_departments_property_idx
  on public.revenue_departments(property_id, active, sort_order);

alter table public.revenue_departments enable row level security;

drop policy if exists revenue_departments_select on public.revenue_departments;
create policy revenue_departments_select on public.revenue_departments
  for select using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists revenue_departments_write on public.revenue_departments;
create policy revenue_departments_write on public.revenue_departments
  for all using (public.is_platform_owner() or public.can_backoffice(property_id))
  with check (public.is_platform_owner() or public.can_backoffice(property_id));

-- Default department catalogue for every property, including Visiwa. Codes are
-- stable; names and visibility can be edited per property later.
insert into public.revenue_departments(property_id, code, name, sort_order, hidden_when_empty)
select p.id, d.code, d.name, d.sort_order, d.hidden_when_empty
from public.properties p
cross join (values
  ('accommodation', 'Accommodation', 10, false),
  ('food', 'Food', 20, false),
  ('beverages', 'Beverages', 30, false),
  ('spa', 'Spa', 40, true),
  ('laundry', 'Laundry', 50, true),
  ('sunbeds', 'Sunbeds', 60, true),
  ('transfer', 'Transfer', 70, true),
  ('extras', 'Extras', 80, true),
  ('foreign_exchange', 'F/E', 90, true),
  ('interest', 'Interest', 100, true)
) as d(code, name, sort_order, hidden_when_empty)
on conflict (property_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- Board supplements, keyed to the meal plan already stored on reservations
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'room_types_id_property_key'
      and conrelid = 'public.room_types'::regclass
  ) then
    alter table public.room_types
      add constraint room_types_id_property_key unique (id, property_id);
  end if;
end $$;

create table if not exists public.board_supplements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  meal_plan text not null check (meal_plan in ('bb', 'half_board', 'full_board')),
  room_type_id uuid,
  nightly_amount numeric(12,2) not null default 0 check (nightly_amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_supplements_room_type_property_fk
    foreign key (room_type_id, property_id)
    references public.room_types(id, property_id) on delete cascade
);
create unique index if not exists board_supplements_property_plan_type_uidx
  on public.board_supplements(
    property_id,
    meal_plan,
    coalesce(room_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.board_supplements enable row level security;

drop policy if exists board_supplements_select on public.board_supplements;
create policy board_supplements_select on public.board_supplements
  for select using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists board_supplements_write on public.board_supplements;
create policy board_supplements_write on public.board_supplements
  for all using (public.is_platform_owner() or public.can_backoffice(property_id))
  with check (public.is_platform_owner() or public.can_backoffice(property_id));

-- ---------------------------------------------------------------------------
-- Permission catalogue and per-property role overrides
-- ---------------------------------------------------------------------------
create table if not exists public.permission_catalog (
  code text primary key,
  module text not null,
  description text not null
);

insert into public.permission_catalog(code, module, description) values
  ('folio.post', 'folio', 'Post a charge to a guest folio'),
  ('folio.settle', 'folio', 'Take payment and settle a folio'),
  ('folio.void', 'folio', 'Reverse or void a folio charge'),
  ('folio.override_unpaid_checkout', 'folio', 'Check out a guest with an open balance'),
  ('receipts.void', 'pos', 'Void a POS receipt while keeping its number'),
  ('reports.daily_sales.view', 'reports', 'View the daily sales summary'),
  ('reports.daily_sales.export', 'reports', 'Export the daily sales summary'),
  ('nightaudit.run', 'night_audit', 'Run and close the nightly audit'),
  ('reservations.import', 'reservations', 'Import channel reservation spreadsheets'),
  ('rooming.view', 'front_office', 'View and print the rooming list')
on conflict (code) do nothing;

create table if not exists public.property_role_permissions (
  property_id uuid not null references public.properties(id) on delete cascade,
  role text not null,
  permission text not null references public.permission_catalog(code) on delete cascade,
  allowed boolean not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (property_id, role, permission)
);

alter table public.property_role_permissions enable row level security;

drop policy if exists property_role_permissions_select on public.property_role_permissions;
create policy property_role_permissions_select on public.property_role_permissions
  for select using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists property_role_permissions_write on public.property_role_permissions;
create policy property_role_permissions_write on public.property_role_permissions
  for all using (public.is_platform_owner() or public.can_backoffice(property_id))
  with check (public.is_platform_owner() or public.can_backoffice(property_id));

create or replace function public.fn_has_permission(p_property_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_allowed boolean;
  v_manager boolean;
begin
  if p_property_id is null or nullif(trim(p_permission), '') is null then
    return false;
  end if;
  if public.is_platform_owner() then
    return true;
  end if;
  if not public.is_member_of_property(p_property_id) then
    return false;
  end if;

  v_role := coalesce(public.current_staff_role(p_property_id), public.property_role(p_property_id), '');
  if v_role = '' then
    return false;
  end if;

  select allowed into v_allowed
    from public.property_role_permissions
    where property_id = p_property_id
      and role = v_role
      and permission = p_permission;
  if found then
    return v_allowed;
  end if;

  v_manager := v_role in (
    'owner', 'admin', 'manager', 'general_manager', 'hotel_admin', 'super_admin',
    'property_manager', 'front_office_manager'
  );

  return case
    when p_permission in ('folio.post', 'folio.settle', 'reports.daily_sales.view', 'rooming.view')
      then v_manager or v_role in ('cashier', 'reception', 'receptionist', 'front_desk', 'fb_manager')
    when p_permission in (
      'folio.void', 'folio.override_unpaid_checkout', 'receipts.void',
      'reports.daily_sales.export', 'nightaudit.run', 'reservations.import'
    ) then v_manager
    else false
  end;
end;
$$;

grant execute on function public.fn_has_permission(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Document numbering: one locked sequence per property and document book
-- ---------------------------------------------------------------------------
create table if not exists public.property_document_sequences (
  property_id uuid not null references public.properties(id) on delete cascade,
  book text not null,
  prefix text not null default 'DOC',
  next_number bigint not null default 1 check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (property_id, book)
);

alter table public.property_document_sequences enable row level security;

drop policy if exists property_document_sequences_select on public.property_document_sequences;
create policy property_document_sequences_select on public.property_document_sequences
  for select using (public.is_platform_owner() or public.can_backoffice(property_id));

create or replace function public.fn_allocate_document_number(
  p_property_id uuid,
  p_book text,
  p_prefix text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number bigint;
begin
  if p_property_id is null or nullif(trim(p_book), '') is null then
    raise exception 'A property and document book are required.';
  end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Access denied.';
  end if;

  insert into public.property_document_sequences(property_id, book, prefix, next_number)
  values (p_property_id, trim(p_book), coalesce(nullif(trim(p_prefix), ''), 'DOC'), 1)
  on conflict (property_id, book) do nothing;

  update public.property_document_sequences
    set next_number = next_number + 1,
        prefix = coalesce(nullif(trim(p_prefix), ''), prefix),
        updated_at = now()
    where property_id = p_property_id
      and book = trim(p_book)
    returning next_number - 1, prefix into v_number, v_prefix;

  return v_prefix || '-' || v_number::text;
end;
$$;

grant execute on function public.fn_allocate_document_number(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Receipt identity: number, book, status and void audit
-- ---------------------------------------------------------------------------
alter table public.pos_receipts
  add column if not exists receipt_number text,
  add column if not exists receipt_book text not null default 'receipt',
  add column if not exists receipt_status text not null default 'posted',
  add column if not exists void_reason text,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists voided_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pos_receipts_receipt_status_check'
      and conrelid = 'public.pos_receipts'::regclass
  ) then
    alter table public.pos_receipts
      add constraint pos_receipts_receipt_status_check
      check (receipt_status in ('posted', 'void'));
  end if;
end $$;

-- The duplicate receipt numbers in the manual daily sales sheets came from
-- typing numbers by hand. The database now refuses two live receipts with the
-- same number in the same book for one property.
create unique index if not exists pos_receipts_property_book_number_uidx
  on public.pos_receipts(property_id, receipt_book, receipt_number)
  where receipt_number is not null;

create index if not exists pos_receipts_property_status_created_idx
  on public.pos_receipts(property_id, receipt_status, created_at desc);

-- Replace the sale RPC so every new receipt is numbered inside the same
-- transaction that records it. Signature and behaviour are otherwise unchanged.
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
  v_receipt_number text;
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

  v_receipt_number := public.fn_allocate_document_number(p_property_id, 'receipt', null);
  update public.pos_receipts
    set receipt_number = v_receipt_number
    where id = v_receipt.id
    returning * into v_receipt;

  return v_receipt;
end;
$$;
grant execute on function public.fn_record_pos_sale(uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text, uuid) to authenticated;

create or replace function public.fn_void_pos_receipt(
  p_property_id uuid,
  p_receipt_id uuid,
  p_reason text
) returns public.pos_receipts
language plpgsql security definer set search_path = public
as $$
declare
  r public.pos_receipts;
  v_reason text;
begin
  if not public.fn_has_permission(p_property_id, 'receipts.void') then
    raise exception 'Receipt void permission required.';
  end if;

  v_reason := nullif(trim(p_reason), '');
  if v_reason is null then
    raise exception 'A reason is required to void a receipt.';
  end if;

  select * into r
    from public.pos_receipts
    where id = p_receipt_id and property_id = p_property_id
    for update;

  if r.id is null then
    raise exception 'Receipt not found.';
  end if;
  if r.receipt_status = 'void' then
    raise exception 'Receipt is already void.';
  end if;
  if r.folio_charge_id is not null then
    raise exception 'Reverse the folio charge before voiding this receipt.';
  end if;

  update public.pos_receipts
    set receipt_status = 'void',
        void_reason = v_reason,
        voided_by = auth.uid(),
        voided_at = now()
    where id = r.id
    returning * into r;

  insert into public.audit_logs(
    actor_id, property_id, action, old_value, new_value, entity_type, entity_id, related_reservation_id
  ) values (
    auth.uid(), p_property_id, 'pos_receipt_voided',
    jsonb_build_object('receipt_number', r.receipt_number, 'total', r.total, 'status', 'posted'),
    jsonb_build_object('receipt_number', r.receipt_number, 'total', r.total, 'status', 'void', 'reason', v_reason),
    'pos_receipt', r.id, r.reservation_id
  );

  return r;
end;
$$;

grant execute on function public.fn_void_pos_receipt(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Visiwa master data seed (only when the property exists; never overwrites)
-- ---------------------------------------------------------------------------
do $$
declare
  v_property uuid;
begin
  select id into v_property
    from public.properties
    where name ilike '%visiwa%'
    order by created_at
    limit 1;

  if v_property is null then
    return;
  end if;

  insert into public.room_types(property_id, code, name, max_occupancy, base_rate)
  values
    (v_property, 'DOUBLE_STANDARD', 'Double Standard', 2, 0),
    (v_property, 'DOUBLE_GARDEN', 'Double Garden', 2, 0),
    (v_property, 'COTTAGE_FAMILY', 'Cottage Family', 5, 0)
  on conflict (property_id, code) do nothing;

  -- 28 rooms: 1-26 plus 31 and 32. Existing rooms keep their type, rate and status.
  insert into public.rooms(property_id, number, capacity, status)
  select v_property, n, 2, 'available'::public.room_status
  from (
    select generate_series(1, 26) as n
    union all select 31
    union all select 32
  ) as s
  on conflict (property_id, number) do nothing;

  update public.rooms r
    set room_type_id = t.id, room_type = t.name
    from public.room_types t
    where r.property_id = v_property
      and t.property_id = v_property
      and t.code = 'DOUBLE_STANDARD'
      and r.number = 13
      and r.room_type_id is null;

  update public.rooms r
    set room_type_id = t.id, room_type = t.name
    from public.room_types t
    where r.property_id = v_property
      and t.property_id = v_property
      and t.code = 'DOUBLE_GARDEN'
      and r.number = 17
      and r.room_type_id is null;

  -- The manual book reached 13-3950. New receipts continue at 13-3951 so the
  -- historical import in Phase 6 can keep its original numbers without collision.
  insert into public.property_document_sequences(property_id, book, prefix, next_number)
  values (v_property, 'receipt', '13', 3951)
  on conflict (property_id, book) do nothing;
end $$;

notify pgrst, 'reload schema';

commit;
