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

create table if not exists public.pos_check_audit_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  table_session_id uuid references public.pos_table_sessions(id) on delete set null,
  pos_receipt_id uuid references public.pos_receipts(id) on delete set null,
  event_type text not null check (event_type in ('opened','items_added','round_fired','bill_printed','settled','reopened','voided')),
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_check_audit_property_idx
  on public.pos_check_audit_events(property_id, created_at desc);
create index if not exists pos_check_audit_session_idx
  on public.pos_check_audit_events(table_session_id, created_at desc);

alter table public.pos_check_audit_events enable row level security;

drop policy if exists pos_check_audit_select on public.pos_check_audit_events;
create policy pos_check_audit_select
  on public.pos_check_audit_events for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

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
  v_room_number text;
  v_method text;
  v_allocation jsonb;
  v_amount numeric;
  v_sum numeric := 0;
  v_session_subtotal numeric := 0;
  v_expected_vat numeric := 0;
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

  select coalesce(sum(
    coalesce((line->>'price')::numeric, 0) * coalesce((line->>'qty')::numeric, 0)
  ), 0)
    into v_session_subtotal
  from jsonb_array_elements(coalesce(v_session.order_lines, '[]'::jsonb)) line;

  if abs(round(coalesce(p_subtotal,0),2) - round(v_session_subtotal,2)) > 0.009 then
    raise exception 'Settlement subtotal does not match the persisted open check.';
  end if;

  if coalesce(p_discount_amount,0) < 0 or coalesce(p_discount_amount,0) > v_session_subtotal then
    raise exception 'Invalid discount amount.';
  end if;

  v_expected_vat := round((v_session_subtotal - coalesce(p_discount_amount,0)) * 0.16, 2);
  if abs(round(coalesce(p_vat,0),2) - v_expected_vat) > 0.009 then
    raise exception 'Settlement VAT does not match the current tax calculation.';
  end if;

  if abs(round(p_total,2) - round(v_session_subtotal - coalesce(p_discount_amount,0) + coalesce(p_vat,0),2)) > 0.009 then
    raise exception 'Settlement total does not match the persisted open check.';
  end if;


