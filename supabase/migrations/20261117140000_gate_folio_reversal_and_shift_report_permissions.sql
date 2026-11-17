CREATE OR REPLACE FUNCTION public.fn_reverse_folio_charge(p_property_id uuid, p_charge_id uuid, p_reason text)
 RETURNS folio_charges
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c public.folio_charges; rev public.folio_charges; manager boolean;
begin
  if not public.fn_employee_has_permission(p_property_id,'front_office.folio.post_charge') then raise exception 'Missing employee permission: front_office.folio.post_charge'; end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 select * into c from public.folio_charges where id=p_charge_id and property_id=p_property_id for update;
 if c.id is null then raise exception 'Folio charge not found.'; end if;
 manager:=coalesce(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager'),false);
 if not manager then raise exception 'Manager approval is required to reverse a posted charge.'; end if;
 if nullif(trim(p_reason),'') is null then raise exception 'A reversal reason is required.'; end if;
 if exists(select 1 from public.folio_charges where reversal_of_id=c.id) then raise exception 'This charge has already been reversed.'; end if;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount,category,quantity,unit_price,reference,source_module,created_by,reversal_of_id)
 values(c.property_id,c.reservation_id,'adjustment','Reversal: '||c.description,-c.amount,c.category,c.quantity,c.unit_price,
 'REV-'||upper(substr(gen_random_uuid()::text,1,8)),'folio',auth.uid(),c.id) returning * into rev;
 insert into public.audit_logs(actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id)
 values(auth.uid(),p_property_id,'folio_charge_reversed',to_jsonb(c),jsonb_build_object('reversal_id',rev.id,'reason',trim(p_reason)), 'folio_charge',c.id,c.reservation_id);
 return rev;
end; $function$
;

CREATE OR REPLACE FUNCTION public.fn_shift_report(p_shift_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.cashier_shifts; pr public.properties; v_opener text; v_closer text;
  v_methods jsonb; v_refunds jsonb; v_cash numeric := 0; v_cash_refunds numeric := 0;
  v_sales record; v_void record; v_adj jsonb; v_open_tables bigint; v_expected numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into s from public.cashier_shifts where id = p_shift_id;
  if not public.fn_employee_has_permission(s.property_id,'back_office.reports.view') then raise exception 'Missing employee permission: back_office.reports.view'; end if;
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
end $function$
;

notify pgrst, 'reload schema';
