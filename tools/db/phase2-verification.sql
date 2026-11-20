-- Phase 2 folio migration — post-apply verification, read only.
-- Raises if any expected object is missing, then prints the evidence.
\set ON_ERROR_STOP on

do $$
declare
  v_count integer;
  v_text text;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema = 'public' and table_name = 'folio_charges'
     and column_name in ('business_date','ticket_number','board_plan','department_id','receipt_id','cashier_id','voided_at','voided_by','void_reason');
  if v_count <> 9 then
    raise exception 'Expected 9 new folio_charges columns, found %', v_count;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'folio_charges_board_plan_check' and conrelid = 'public.folio_charges'::regclass) then
    raise exception 'Missing board plan check constraint';
  end if;

  select count(*) into v_count
    from pg_indexes
   where schemaname = 'public'
     and indexname in ('folio_charges_property_ticket_uidx','folio_charges_property_business_date_idx','folio_charges_department_idx','folio_unpaid_departures_property_idx');
  if v_count <> 4 then
    raise exception 'Expected 4 new indexes, found %', v_count;
  end if;

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fn_current_business_date','fn_folio_charge_control_defaults','fn_folio_charge_receipt_link','fn_post_room_charge','fn_settle_folio','fn_post_accommodation_charges','fn_check_out_room_with_override');
  if v_count < 7 then
    raise exception 'Expected 7 new functions, found %', v_count;
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.folio_charges'::regclass
       and not tgisinternal
       and tgname = 'folio_charges_control_defaults'
  ) then
    raise exception 'Missing before-insert defaults trigger on folio_charges';
  end if;

  if position('fn_allocate_document_number' in pg_get_functiondef('public.fn_folio_charge_control_defaults'::regproc)) = 0 then
    raise exception 'The defaults trigger does not allocate ticket numbers';
  end if;

  if position('voided_at' in pg_get_functiondef('public.fn_reverse_folio_charge(uuid,uuid,text)'::regproc)) = 0 then
    raise exception 'fn_reverse_folio_charge does not write the void audit flags';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'folio_open_balances' and c.relkind = 'v'
  ) then
    raise exception 'Missing folio_open_balances view';
  end if;

  select coalesce(array_to_string(reloptions, ','), '') into v_text
    from pg_class where oid = 'public.folio_open_balances'::regclass;
  if position('security_invoker=true' in replace(v_text, ' ', '')) = 0 then
    raise exception 'folio_open_balances is not security_invoker';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'folio_open_balances' and column_name = 'balance'
  ) then
    raise exception 'folio_open_balances has no balance column';
  end if;

  if exists (select 1 from public.folio_charges where business_date is null) then
    raise exception 'business date backfill is incomplete';
  end if;

  select count(*) into v_count from (
    select property_id, ticket_number
      from public.folio_charges
     where ticket_number is not null
     group by property_id, ticket_number
    having count(*) > 1
  ) duplicates;
  if v_count <> 0 then
    raise exception 'Duplicate ticket numbers found: %', v_count;
  end if;
end $$;

select 'PASS: columns, constraint, indexes, functions, trigger, view and backfill verified' as check;

select 'new folio_charges columns: ' || string_agg(column_name || ':' || data_type || ':null=' || is_nullable, ', ' order by column_name) as verification
  from information_schema.columns
 where table_schema = 'public' and table_name = 'folio_charges'
   and column_name in ('business_date','ticket_number','board_plan','department_id','receipt_id','cashier_id','voided_at','voided_by','void_reason');

select 'new functions: ' || string_agg(p.proname, ', ' order by p.proname) as verification
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('fn_current_business_date','fn_folio_charge_control_defaults','fn_folio_charge_receipt_link','fn_post_room_charge','fn_settle_folio','fn_post_accommodation_charges','fn_check_out_room_with_override');

select 'trigger: ' || t.tgname || ' -> ' || p.proname as verification
  from pg_trigger t join pg_proc p on p.oid = t.tgfunc
 where t.tgrelid = 'public.folio_charges'::regclass and t.tgname = 'folio_charges_control_defaults';

select 'view: ' || relname || ' | security_invoker=' || coalesce(array_to_string(reloptions, ','), '(unset)') as verification
  from pg_class where oid = 'public.folio_open_balances'::regclass;

select 'view columns: ' || string_agg(column_name, ', ' order by ordinal_position) as verification
  from information_schema.columns
 where table_schema = 'public' and table_name = 'folio_open_balances';

select 'business dates: charges=' || count(*) || ' min=' || min(business_date) || ' max=' || max(business_date) as verification
  from public.folio_charges;

select 'board plans: ' || coalesce(board_plan, '(none)') || ' = ' || count(*) as verification
  from public.folio_charges
 group by board_plan
 order by count(*) desc;

select 'row counts after: folio_charges=' || (select count(*) from public.folio_charges)
    || ' payments=' || (select count(*) from public.payments)
    || ' pos_receipts=' || (select count(*) from public.pos_receipts)
    || ' reservations=' || (select count(*) from public.reservations) as verification;

select 'open balances: ' || count(*) || ' reservations with a balance, total ' || coalesce(sum(balance), 0) as verification
  from public.folio_open_balances where balance <> 0;

select 'top open balance: ' || guest_name || ' | room ' || coalesce(room_number, '-')
    || ' | charges ' || charges_total || ' | payments ' || payments_total || ' | balance ' || balance as verification
  from public.folio_open_balances where balance <> 0 order by balance desc limit 5;
