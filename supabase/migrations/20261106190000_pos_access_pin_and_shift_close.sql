-- Property-level POS access PIN, shift close safeguards and daily sales reporting.
-- The initial PIN is intentionally the requested default 1234. Property admins
-- should replace it from POS Settings before normal operations.

create table if not exists public.pos_access_credentials (
  property_id uuid primary key references public.properties(id) on delete cascade,
  pin_hash text not null,
  is_default boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_access_pin_attempts (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (property_id, user_id)
);

alter table public.pos_access_credentials enable row level security;
alter table public.pos_access_pin_attempts enable row level security;
revoke all on table public.pos_access_credentials from public, anon, authenticated;
revoke all on table public.pos_access_pin_attempts from public, anon, authenticated;

-- Keep the PIN hash private; no client-facing table policy is intentionally added.
insert into public.pos_access_credentials(property_id, pin_hash, is_default)
select p.id, extensions.crypt('1234', extensions.gen_salt('bf')), true
from public.properties p
on conflict (property_id) do nothing;

create or replace function public.fn_seed_property_pos_access_pin()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.pos_access_credentials(property_id, pin_hash, is_default)
  values (new.id, extensions.crypt('1234', extensions.gen_salt('bf')), true)
  on conflict (property_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_seed_property_pos_access_pin on public.properties;
create trigger trg_seed_property_pos_access_pin
after insert on public.properties
for each row execute function public.fn_seed_property_pos_access_pin();

create or replace function public.fn_verify_pos_access_pin(
  p_property_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_credential public.pos_access_credentials;
  v_attempt public.pos_access_pin_attempts;
  v_ok boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  delete from public.pos_access_pin_attempts
  where property_id = p_property_id
    and user_id = auth.uid()
    and locked_until is not null
    and locked_until <= now();

  select * into v_attempt
  from public.pos_access_pin_attempts
  where property_id = p_property_id and user_id = auth.uid()
  for update;

  if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    return jsonb_build_object('ok', false, 'locked_until', v_attempt.locked_until,
      'message', 'Too many incorrect PIN attempts. Try again after the lock expires.');
  end if;

  select * into v_credential
  from public.pos_access_credentials
  where property_id = p_property_id;

  if v_credential.property_id is null then
    raise exception 'POS access PIN is not configured. Ask the property administrator.';
  end if;

  if p_pin ~ '^[0-9]{4}$' then
    v_ok := extensions.crypt(p_pin, v_credential.pin_hash) = v_credential.pin_hash;
  end if;

  if v_ok then
    delete from public.pos_access_pin_attempts
    where property_id = p_property_id and user_id = auth.uid();
    return jsonb_build_object('ok', true, 'is_default', v_credential.is_default);
  end if;

  insert into public.pos_access_pin_attempts(property_id, user_id, failed_attempts, locked_until, updated_at)
  values (p_property_id, auth.uid(), 1, null, now())
  on conflict (property_id, user_id) do update
  set failed_attempts = public.pos_access_pin_attempts.failed_attempts + 1,
      locked_until = case
        when public.pos_access_pin_attempts.failed_attempts + 1 >= 5
          then now() + interval '15 minutes'
        else null
      end,
      updated_at = now()
  returning * into v_attempt;

  return jsonb_build_object(
    'ok', false,
    'attempts_remaining', greatest(0, 5 - v_attempt.failed_attempts),
    'locked_until', v_attempt.locked_until,
    'message', case when v_attempt.locked_until is not null
      then 'Too many incorrect PIN attempts. Try again in 15 minutes.'
      else 'Incorrect POS PIN. Try again.' end
  );
end;
$$;

create or replace function public.fn_pos_access_pin_status(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_credential public.pos_access_credentials;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin')
  ) then raise exception 'Only the property owner or administrator can manage the POS PIN.'; end if;

  select * into v_credential
  from public.pos_access_credentials
  where property_id = p_property_id;

  return jsonb_build_object(
    'configured', v_credential.property_id is not null,
    'is_default', coalesce(v_credential.is_default, true),
    'updated_at', v_credential.updated_at
  );
end;
$$;

create or replace function public.fn_reset_pos_access_pin(
  p_property_id uuid,
  p_new_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin')
  ) then raise exception 'Only the property owner or administrator can reset the POS PIN.'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'POS PIN must contain exactly four digits.';
  end if;

  insert into public.pos_access_credentials(property_id, pin_hash, is_default, updated_by, updated_at)
  values (p_property_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf')), false, auth.uid(), now())
  on conflict (property_id) do update
  set pin_hash = excluded.pin_hash,
      is_default = false,
      updated_by = auth.uid(),
      updated_at = now();

  delete from public.pos_access_pin_attempts where property_id = p_property_id;
  return jsonb_build_object('ok', true, 'is_default', false);
end;
$$;

revoke all on function public.fn_verify_pos_access_pin(uuid, text) from public, anon;
revoke all on function public.fn_pos_access_pin_status(uuid) from public, anon;
revoke all on function public.fn_reset_pos_access_pin(uuid, text) from public, anon;
grant execute on function public.fn_verify_pos_access_pin(uuid, text) to authenticated;
grant execute on function public.fn_pos_access_pin_status(uuid) to authenticated;
grant execute on function public.fn_reset_pos_access_pin(uuid, text) to authenticated;

-- Preserve actual guest covers on the receipt so the closing report can count
-- diners rather than guessing from the number of receipts.
alter table public.pos_receipts
  add column if not exists covers integer not null default 1
  check (covers between 1 and 1000);

alter table public.pos_shifts
  add column if not exists counted_cash numeric(12,2),
  add column if not exists cash_variance numeric(12,2),
  add column if not exists total_sales numeric(12,2) not null default 0,
  add column if not exists total_receipts integer not null default 0,
  add column if not exists total_covers integer not null default 0;

-- The sale writer stores the active shift in pos_shift_id (shift_id is retained
-- for legacy rows). Extend the wrapper to persist the cover count atomically.
drop function if exists public.fn_record_pos_sale_with_vat_snapshot(
  uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text,
  uuid, uuid, text, uuid, text, text, jsonb, jsonb
);

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
)
returns public.pos_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.pos_receipts;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  if p_covers is null or p_covers < 1 or p_covers > 1000 then
    raise exception 'Guest covers must be between 1 and 1000.';
  end if;

  v_receipt := public.fn_record_pos_sale(
    p_property_id, p_table_number, p_order_number, p_items, p_subtotal,
    p_discount_amount, p_vat, p_total, p_payment_method, p_reservation_id,
    p_shift_id, p_waiter, p_discount_id, p_discount_name,
    p_idempotency_key, p_payment_allocations
  );

  update public.pos_receipts
  set vat_snapshot = coalesce(vat_snapshot, p_vat_snapshot),
      covers = greatest(1, least(p_covers, 1000))
  where id = v_receipt.id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

revoke all on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text,
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, integer
) from public, anon;
grant execute on function public.fn_record_pos_sale_with_vat_snapshot(
  uuid, text, text, jsonb, numeric, numeric, numeric, numeric, text,
  uuid, uuid, text, uuid, text, text, jsonb, jsonb, integer
) to authenticated;

-- Close only after every table session has been settled and cleared.
-- Reconcile split payments from pos_receipt_payments and read both shift
-- columns so historical receipts remain reportable.
drop function if exists public.fn_close_pos_shift(uuid, numeric, text, boolean);
create or replace function public.fn_close_pos_shift(
  p_shift_id uuid,
  p_counted_cash numeric,
  p_notes text default null,
  p_manager_approved boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shift public.pos_shifts;
  v_cash numeric := 0;
  v_mpesa numeric := 0;
  v_card numeric := 0;
  v_room numeric := 0;
  v_bank numeric := 0;
  v_other numeric := 0;
  v_total numeric := 0;
  v_count integer := 0;
  v_covers integer := 0;
  v_expected numeric := 0;
  v_variance numeric := 0;
  v_open_tables text;
begin
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Counted cash cannot be negative.';
  end if;

  select * into v_shift
  from public.pos_shifts
  where id = p_shift_id
  for update;

  if v_shift.id is null then raise exception 'Shift not found.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(v_shift.property_id) in ('owner', 'admin', 'manager', 'cashier')
    or public.current_staff_role(v_shift.property_id) in ('hotel_admin', 'super_admin', 'cashier', 'fb_manager')
  ) then raise exception 'Only cashier, manager or admin can close a shift.'; end if;
  if v_shift.status <> 'open' then raise exception 'Shift is already closed.'; end if;

  select string_agg(
    'Table ' || coalesce(nullif(table_number, ''), table_key),
    ', ' order by table_number
  )
  into v_open_tables
  from public.pos_table_sessions
  where property_id = v_shift.property_id
    and status <> 'closed';

  if v_open_tables is not null then
    raise exception 'Cannot close the shift. Clear or settle these tables first: %', v_open_tables;
  end if;

  if exists (
    select 1
    from public.pos_receipts r
    left join (
      select receipt_id, sum(amount) as allocated_amount
      from public.pos_receipt_payments
      where property_id = v_shift.property_id
      group by receipt_id
    ) a on a.receipt_id = r.id
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method = 'split'
      and abs(coalesce(a.allocated_amount, 0) - r.total) > 0.01
  ) then
    raise exception 'Cannot close the shift: one or more split-payment receipts do not reconcile to their receipt totals.';
  end if;

  with method_rows as (
    select
      r.id as receipt_id,
      case
        when r.payment_method = 'room' then 'room_charge'
        when r.payment_method in ('cash', 'mpesa', 'card', 'bank', 'room_charge', 'other') then r.payment_method
        else 'other'
      end as payment_method,
      r.total as amount
    from public.pos_receipts r
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method <> 'split'

    union all

    select
      r.id as receipt_id,
      case
        when rp.payment_method = 'room' then 'room_charge'
        when rp.payment_method in ('cash', 'mpesa', 'card', 'bank', 'room_charge', 'other') then rp.payment_method
        else 'other'
      end as payment_method,
      rp.amount
    from public.pos_receipts r
    join public.pos_receipt_payments rp
      on rp.receipt_id = r.id and rp.property_id = r.property_id
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method = 'split'
  )
  select
    coalesce(sum(amount) filter (where payment_method = 'cash'), 0),
    coalesce(sum(amount) filter (where payment_method = 'mpesa'), 0),
    coalesce(sum(amount) filter (where payment_method = 'card'), 0),
    coalesce(sum(amount) filter (where payment_method = 'room_charge'), 0),
    coalesce(sum(amount) filter (where payment_method = 'bank'), 0),
    coalesce(sum(amount) filter (where payment_method = 'other'), 0)
  into v_cash, v_mpesa, v_card, v_room, v_bank, v_other
  from method_rows;

  select count(*), coalesce(sum(covers), 0)
  into v_count, v_covers
  from public.pos_receipts
  where property_id = v_shift.property_id
    and (pos_shift_id = p_shift_id or shift_id = p_shift_id)
    and status = 'posted';

  v_total := v_cash + v_mpesa + v_card + v_room + v_bank + v_other;
  v_expected := v_shift.opening_cash + v_cash;
  v_variance := p_counted_cash - v_expected;

  if abs(v_variance) > 500 and (
    not p_manager_approved
    or not (
      public.is_platform_owner()
      or public.property_role(v_shift.property_id) in ('owner', 'admin', 'manager')
      or public.current_staff_role(v_shift.property_id) in ('hotel_admin', 'super_admin', 'fb_manager', 'manager', 'admin', 'owner')
    )
  ) then
    raise exception 'Manager approval is required for a cash variance above KES 500.';
  end if;

  update public.pos_shifts
  set closed_by = auth.uid(),
      closed_at = now(),
      status = 'closed',
      notes = coalesce(p_notes, notes),
      counted_cash = p_counted_cash,
      cash_variance = v_variance,
      total_sales = v_total,
      total_receipts = v_count,
      total_covers = v_covers
  where id = p_shift_id
  returning * into v_shift;

  delete from public.pos_shift_payments where shift_id = p_shift_id;

  with method_rows as (
    select r.id as receipt_id,
      case
        when r.payment_method = 'room' then 'room_charge'
        when r.payment_method in ('cash', 'mpesa', 'card', 'bank', 'other') then r.payment_method
        else 'other'
      end as payment_method,
      r.total as amount
    from public.pos_receipts r
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method <> 'split'
    union all
    select r.id as receipt_id,
      case
        when rp.payment_method = 'room' then 'room_charge'
        when rp.payment_method in ('cash', 'mpesa', 'card', 'bank', 'other') then rp.payment_method
        else 'other'
      end as payment_method,
      rp.amount
    from public.pos_receipts r
    join public.pos_receipt_payments rp
      on rp.receipt_id = r.id and rp.property_id = r.property_id
    where r.property_id = v_shift.property_id
      and (r.pos_shift_id = p_shift_id or r.shift_id = p_shift_id)
      and r.status = 'posted'
      and r.payment_method = 'split'
  ),
  methods(payment_method) as (
    values ('cash'), ('mpesa'), ('card'), ('bank'), ('room_charge'), ('other')
  )
  insert into public.pos_shift_payments(shift_id, payment_method, amount, transaction_count)
  select p_shift_id, methods.payment_method,
    coalesce(sum(method_rows.amount), 0),
    count(distinct method_rows.receipt_id)
  from methods
  left join method_rows using (payment_method)
  group by methods.payment_method;

  return jsonb_build_object(
    'shift', to_jsonb(v_shift),
    'opening_cash', v_shift.opening_cash,
    'cash', v_cash,
    'mpesa', v_mpesa,
    'card', v_card,
    'bank', v_bank,
    'room_charge', v_room,
    'other', v_other,
    'total_sales', v_total,
    'total_transactions', v_count,
    'total_covers', v_covers,
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'variance', v_variance
  );
end;
$$;

revoke all on function public.fn_close_pos_shift(uuid, numeric, text, boolean) from public, anon;
grant execute on function public.fn_close_pos_shift(uuid, numeric, text, boolean) to authenticated;

notify pgrst, 'reload schema';
