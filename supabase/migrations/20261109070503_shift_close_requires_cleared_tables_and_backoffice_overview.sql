-- Already APPLIED to Supabase project mszogmazldxjsiytrlxr (OliTechs PMS+POS).
-- Kept here so the repo's version control matches the live database. Do NOT re-run on production.

-- 1. Closing a cashier shift now requires every table on the floor plan to be cleared.
create or replace function public.fn_close_cashier_shift(p_shift_id uuid, p_closing_cash_count numeric, p_notes text default null)
 returns cashier_shifts
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare s public.cashier_shifts; x jsonb; expected numeric; variance numeric; manager boolean; open_n integer; open_list text;
begin
if p_closing_cash_count<0 then raise exception 'Closing cash count cannot be negative.'; end if;
select cs.* into s from public.cashier_shifts cs where cs.id=p_shift_id for update; if s.id is null then raise exception 'Cashier shift not found.'; end if;
if s.status<>'open' then raise exception 'Cashier shift is already closed.'; end if;
if not(public.is_platform_owner() or s.opened_by=auth.uid() or public.property_role(s.property_id) in ('owner','admin','manager') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager')) then raise exception 'Not allowed.'; end if;

select count(*), string_agg('Table '||coalesce(t.table_number,'?')||' ('||t.status||')', ', ' order by t.table_number)
  into open_n, open_list
  from public.pos_table_sessions t
  where t.property_id=s.property_id and t.status<>'closed';
if open_n>0 then
  raise exception 'Cannot close shift: % table(s) still open on the floor plan: %. Settle or void them first.', open_n, open_list;
end if;

x:=public.fn_cashier_shift_summary(p_shift_id); expected:=coalesce((x->>'expected_cash')::numeric,0); variance:=p_closing_cash_count-expected;
manager:=public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','fb_manager');
if abs(variance)>500 and not manager then raise exception 'Manager approval is required for a cash variance above KES 500.'; end if;
update public.cashier_shifts set expected_cash=expected,closing_cash_count=p_closing_cash_count,variance=variance,status='closed',closed_at=now(),closing_notes=p_notes,
variance_approved_by=case when abs(variance)>500 and manager then auth.uid() else variance_approved_by end,
variance_approved_at=case when abs(variance)>500 and manager then now() else variance_approved_at end
where id=p_shift_id returning cashier_shifts.* into s;
insert into public.audit_logs(actor_id,property_id,action,new_value) values(auth.uid(),s.property_id,'cashier_shift_closed',jsonb_build_object('shift_id',s.id,'expected_cash',expected,'closing_cash',p_closing_cash_count,'variance',variance,'variance_approved_by',s.variance_approved_by));
return s;
end $function$;

-- 2. Read-only shift list for Back Office (no open/close, no row locks).
create or replace function public.fn_shift_overview(
  p_property_id uuid,
  p_from date default ((now() at time zone 'Africa/Nairobi')::date - 30),
  p_to date default ((now() at time zone 'Africa/Nairobi')::date)
)
returns table(
  shift_id uuid, status text, opened_at timestamptz, closed_at timestamptz,
  opened_by_name text, opening_float numeric, closing_cash_count numeric,
  expected_cash numeric, variance numeric, receipts_count bigint, total_sales numeric,
  open_tables_now bigint
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner()
          or public.property_role(p_property_id) in ('owner','admin','manager')
          or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then
    raise exception 'Not allowed.';
  end if;

  return query
  select cs.id, cs.status, cs.opened_at, cs.closed_at,
         coalesce(pr.full_name, pr.email), cs.opening_float, cs.closing_cash_count,
         cs.expected_cash, cs.variance,
         coalesce(r.n,0), coalesce(r.total,0),
         (select count(*) from public.pos_table_sessions t where t.property_id=p_property_id and t.status<>'closed')
  from public.cashier_shifts cs
  left join public.profiles pr on pr.id = cs.opened_by
  left join lateral (
    select count(*) n, sum(x.total) total
    from public.pos_receipts x where x.shift_id = cs.id and x.status = 'posted'
  ) r on true
  where cs.property_id = p_property_id
    and (cs.status = 'open'
         or (cs.opened_at at time zone 'Africa/Nairobi')::date between p_from and p_to)
  order by cs.opened_at desc;
end $function$;

revoke execute on function public.fn_shift_overview(uuid,date,date) from public, anon;
grant execute on function public.fn_shift_overview(uuid,date,date) to authenticated;
