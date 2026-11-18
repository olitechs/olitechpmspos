-- Already APPLIED to Supabase project mszogmazldxjsiytrlxr (OliTechs PMS+POS).
-- Kept here so the repo's version control matches the live database. Do NOT re-run on production.

-- ===== Schema =====
alter table public.cashier_shifts add column if not exists shift_no integer;
alter table public.cashier_shifts add column if not exists closed_by uuid references auth.users(id);

update public.cashier_shifts cs set shift_no = q.rn
from (select id, row_number() over (partition by property_id order by opened_at) rn from public.cashier_shifts) q
where q.id = cs.id and cs.shift_no is null;

create unique index if not exists cashier_shifts_property_shift_no_key on public.cashier_shifts(property_id, shift_no);
-- Only one open shift per property at a time (Loyverse style)
create unique index if not exists cashier_shifts_one_open_per_property on public.cashier_shifts(property_id) where status = 'open';

create or replace function public.trg_cashier_shift_no() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.shift_no is null then
    select coalesce(max(shift_no),0)+1 into new.shift_no from public.cashier_shifts where property_id = new.property_id;
  end if;
  return new;
end $$;
revoke execute on function public.trg_cashier_shift_no() from public, anon, authenticated;
drop trigger if exists cashier_shifts_set_no on public.cashier_shifts;
create trigger cashier_shifts_set_no before insert on public.cashier_shifts for each row execute function public.trg_cashier_shift_no();

-- ===== Open shift =====
create or replace function public.fn_open_cashier_shift(p_property_id uuid, p_opening_float numeric default 0)
returns cashier_shifts language plpgsql security definer set search_path to 'public' as $$
declare v_shift public.cashier_shifts; v_open public.cashier_shifts; v_staff_id uuid; v_role text; v_by text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_opening_float is null or p_opening_float < 0 then raise exception 'Opening float cannot be negative.'; end if;

  v_role := public.current_staff_role(p_property_id);
  if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then
    raise exception 'Only authorised cashier staff can open a shift.';
  end if;
  if v_role is null and not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only authorised cashier staff can open a shift.';
  end if;

  select * into v_open from public.cashier_shifts where property_id = p_property_id and status = 'open' limit 1;
  if v_open.id is not null then
    select coalesce(full_name, email) into v_by from public.profiles where id = v_open.opened_by;
    raise exception 'Shift #% is already open (opened by % on %). Close it before opening a new one.',
      v_open.shift_no, coalesce(v_by,'another user'), to_char(v_open.opened_at at time zone 'Africa/Nairobi','DD Mon YYYY HH24:MI');
  end if;

  v_staff_id := public.current_staff_id(p_property_id);
  begin
    insert into public.cashier_shifts(property_id, staff_id, opened_by, opening_float)
    values (p_property_id, v_staff_id, auth.uid(), p_opening_float) returning * into v_shift;
  exception when unique_violation then
    raise exception 'A shift is already open for this property. Close it before opening a new one.';
  end;

  insert into public.audit_logs(actor_id, property_id, action, new_value)
  values (auth.uid(), p_property_id, 'cashier_shift_opened',
          jsonb_build_object('shift_id', v_shift.id, 'shift_no', v_shift.shift_no, 'opening_float', p_opening_float));
  return v_shift;
end $$;

-- ===== Close shift (fixes ambiguous-column bug; blocks while tables are open) =====
create or replace function public.fn_close_cashier_shift(p_shift_id uuid, p_closing_cash_count numeric, p_notes text default null)
returns cashier_shifts language plpgsql security definer set search_path to 'public' as $$
declare
  s public.cashier_shifts; x jsonb; v_expected numeric; v_variance numeric; v_manager boolean;
  v_open_n integer; v_open_list text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_closing_cash_count is null or p_closing_cash_count < 0 then raise exception 'Closing cash count cannot be negative.'; end if;

  select cs.* into s from public.cashier_shifts cs where cs.id = p_shift_id for update;
  if s.id is null then raise exception 'Shift not found.'; end if;
  if s.status <> 'open' then raise exception 'Shift is already closed.'; end if;

  if not (public.is_platform_owner() or s.opened_by = auth.uid()
          or public.property_role(s.property_id) in ('owner','admin','manager','cashier')
          or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager','cashier')) then
    raise exception 'Not allowed.';
  end if;

  select count(*), string_agg('Table '||coalesce(t.table_number,'?')||' ('||t.status||')', ', ' order by t.table_number)
    into v_open_n, v_open_list
  from public.pos_table_sessions t where t.property_id = s.property_id and t.status <> 'closed';
  if v_open_n > 0 then
    raise exception 'Cannot close shift: % table(s) still open on the floor plan: %. Settle or void them first.', v_open_n, v_open_list;
  end if;

  x := public.fn_cashier_shift_summary(p_shift_id);
  v_expected := coalesce((x->>'expected_cash')::numeric, 0);
  v_variance := p_closing_cash_count - v_expected;
  v_manager := public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager')
               or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager');
  if abs(v_variance) > 500 and not v_manager then
    raise exception 'Manager approval is required for a cash variance above KES 500.';
  end if;

  update public.cashier_shifts cs set
    expected_cash = v_expected,
    closing_cash_count = p_closing_cash_count,
    variance = v_variance,
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    closing_notes = p_notes,
    variance_approved_by = case when abs(v_variance) > 500 and v_manager then auth.uid() else cs.variance_approved_by end,
    variance_approved_at = case when abs(v_variance) > 500 and v_manager then now() else cs.variance_approved_at end
  where cs.id = p_shift_id returning cs.* into s;

  insert into public.audit_logs(actor_id, property_id, action, new_value)
  values (auth.uid(), s.property_id, 'cashier_shift_closed',
          jsonb_build_object('shift_id', s.id, 'shift_no', s.shift_no, 'expected_cash', v_expected,
                             'closing_cash', p_closing_cash_count, 'variance', v_variance,
                             'variance_approved_by', s.variance_approved_by));
  return s;
end $$;

-- ===== Current shift (for the POS "Shifts" button and the no-shift banner) =====
create or replace function public.fn_current_shift(p_property_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare s public.cashier_shifts; v_by text; v_tables bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  select * into s from public.cashier_shifts where property_id = p_property_id and status = 'open' limit 1;
  select count(*) into v_tables from public.pos_table_sessions where property_id = p_property_id and status <> 'closed';
  if s.id is null then
    return jsonb_build_object('open', false, 'open_tables', v_tables);
  end if;
  select coalesce(full_name, email) into v_by from public.profiles where id = s.opened_by;
  return jsonb_build_object('open', true, 'shift_id', s.id, 'shift_no', s.shift_no, 'opened_at', s.opened_at,
                            'opened_by', s.opened_by, 'opened_by_name', v_by, 'opening_float', s.opening_float,
                            'open_tables', v_tables, 'can_close_now', v_tables = 0);
end $$;

-- ===== Printable shift report (Loyverse style) =====
create or replace function public.fn_shift_report(p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  s public.cashier_shifts; pr public.properties; v_opener text; v_closer text;
  v_methods jsonb; v_refunds jsonb; v_cash numeric := 0; v_cash_refunds numeric := 0;
  v_sales record; v_void record; v_adj jsonb; v_open_tables bigint; v_expected numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into s from public.cashier_shifts where id = p_shift_id;
  if s.id is null then raise exception 'Shift not found.'; end if;
  if not (public.is_platform_owner() or s.opened_by = auth.uid()
          or public.property_role(s.property_id) in ('owner','admin','manager','cashier')
          or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then
    raise exception 'Not allowed.';
  end if;
  select * into pr from public.properties where id = s.property_id;
  select coalesce(full_name, email) into v_opener from public.profiles where id = s.opened_by;
  select coalesce(full_name, email) into v_closer from public.profiles where id = s.closed_by;

  -- Sales by payment method (split bills counted by their allocations)
  with direct as (
    select r.payment_method m, count(*) n, sum(r.total) amt
    from public.pos_receipts r where r.shift_id = s.id and r.status = 'posted' and r.payment_method <> 'split' group by 1
  ), split as (
    select rp.payment_method m, count(*) n, sum(rp.amount) amt
    from public.pos_receipt_payments rp join public.pos_receipts r on r.id = rp.receipt_id
    where r.shift_id = s.id and r.status = 'posted' group by 1
  ), allm as (
    select m, sum(n) n, sum(amt) amt from (select * from direct union all select * from split) u group by m
  )
  select coalesce(jsonb_object_agg(m, jsonb_build_object('count', n, 'amount', amt)), '{}'::jsonb) into v_methods from allm;
  v_cash := coalesce((v_methods->'cash'->>'amount')::numeric, 0);

  select count(*) n, coalesce(sum(subtotal),0) subtotal, coalesce(sum(discount_amount),0) discounts,
         coalesce(sum(vat),0) vat, coalesce(sum(total),0) total
    into v_sales from public.pos_receipts where shift_id = s.id and status = 'posted';
  select count(*) n, coalesce(sum(total),0) total into v_void from public.pos_receipts where shift_id = s.id and status = 'voided';

  select coalesce(jsonb_object_agg(adjustment_type, jsonb_build_object('count', n, 'amount', amt)), '{}'::jsonb) into v_adj
  from (select adjustment_type, count(*) n, sum(amount) amt from public.cashier_adjustments
        where shift_id = s.id and status = 'approved' group by 1) a;

  select coalesce(jsonb_object_agg(settlement_method, amt), '{}'::jsonb), coalesce(sum(amt) filter (where settlement_method = 'cash'), 0)
    into v_refunds, v_cash_refunds
  from (select cr.settlement_method, sum(cr.amount) amt from public.cashier_refunds cr
        join public.cashier_adjustments ca on ca.id = cr.adjustment_id
        where ca.shift_id = s.id and ca.status = 'approved' group by 1) q;

  select count(*) into v_open_tables from public.pos_table_sessions where property_id = s.property_id and status <> 'closed';
  v_expected := s.opening_float + v_cash - v_cash_refunds;

  return jsonb_build_object(
    'shift', jsonb_build_object('id', s.id, 'shift_no', s.shift_no, 'status', s.status, 'opened_at', s.opened_at,
              'closed_at', s.closed_at, 'opened_by_name', v_opener, 'closed_by_name', v_closer, 'notes', s.closing_notes),
    'property', jsonb_build_object('name', pr.name, 'business_name', pr.business_name, 'currency', pr.currency),
    'sales', jsonb_build_object('receipts', v_sales.n, 'before_discount', v_sales.subtotal, 'discounts', v_sales.discounts,
              'vat', v_sales.vat, 'total', v_sales.total),
    'by_payment_method', v_methods,
    'voids', jsonb_build_object('voided_receipts', v_void.n, 'voided_total', v_void.total),
    'adjustments_approved', v_adj,
    'refunds_by_method', v_refunds,
    'cash_drawer', jsonb_build_object('opening_float', s.opening_float, 'cash_sales', v_cash, 'cash_refunds', v_cash_refunds,
              'expected_cash', case when s.status = 'closed' then s.expected_cash else v_expected end,
              'counted_cash', s.closing_cash_count, 'variance', s.variance, 'variance_approved_by', s.variance_approved_by),
    'open_tables_now', v_open_tables,
    'generated_at', now()
  );
end $$;

-- ===== Back Office read-only list (replace earlier version: adds shift_no / closer) =====
drop function if exists public.fn_shift_overview(uuid,date,date);
create function public.fn_shift_overview(
  p_property_id uuid,
  p_from date default ((now() at time zone 'Africa/Nairobi')::date - 30),
  p_to date default ((now() at time zone 'Africa/Nairobi')::date)
) returns table(shift_id uuid, shift_no integer, status text, opened_at timestamptz, closed_at timestamptz,
  opened_by_name text, closed_by_name text, opening_float numeric, closing_cash_count numeric,
  expected_cash numeric, variance numeric, receipts_count bigint, total_sales numeric, open_tables_now bigint)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager')
          or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then
    raise exception 'Not allowed.';
  end if;
  return query
  select cs.id, cs.shift_no, cs.status, cs.opened_at, cs.closed_at,
         coalesce(po.full_name, po.email), coalesce(pc.full_name, pc.email),
         cs.opening_float, cs.closing_cash_count, cs.expected_cash, cs.variance,
         coalesce(r.n,0), coalesce(r.total,0),
         (select count(*) from public.pos_table_sessions t where t.property_id = p_property_id and t.status <> 'closed')
  from public.cashier_shifts cs
  left join public.profiles po on po.id = cs.opened_by
  left join public.profiles pc on pc.id = cs.closed_by
  left join lateral (select count(*) n, sum(x.total) total from public.pos_receipts x where x.shift_id = cs.id and x.status = 'posted') r on true
  where cs.property_id = p_property_id
    and (cs.status = 'open' or (cs.opened_at at time zone 'Africa/Nairobi')::date between p_from and p_to)
  order by cs.opened_at desc;
end $$;

-- ===== Grants =====
revoke execute on function public.fn_current_shift(uuid), public.fn_shift_report(uuid), public.fn_shift_overview(uuid,date,date) from public, anon;
grant execute on function public.fn_current_shift(uuid), public.fn_shift_report(uuid), public.fn_shift_overview(uuid,date,date) to authenticated;
