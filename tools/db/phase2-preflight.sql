-- Phase 2 folio migration — pre-flight, read only.
-- Fails before anything is applied when a prerequisite from an earlier phase is
-- missing in production.
\set ON_ERROR_STOP on

do $$
declare
  missing_tables text;
  missing_columns text;
begin
  select string_agg(n, ', ') into missing_tables
    from (values
      ('property_business_dates'),
      ('revenue_departments'),
      ('property_document_sequences'),
      ('property_users')
    ) v(n)
   where to_regclass('public.' || n) is null;
  if missing_tables is not null then
    raise exception 'Missing prerequisite tables: %', missing_tables;
  end if;

  select string_agg(required, ', ') into missing_columns
    from (values
      ('folio_charges.source'),
      ('folio_charges.category'),
      ('folio_charges.reversal_of_id'),
      ('reservations.meal_plan'),
      ('payments.status')
    ) v(required)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = split_part(v.required, '.', 1)
        and c.column_name = split_part(v.required, '.', 2)
   );
  if missing_columns is not null then
    raise exception 'Missing prerequisite columns: %', missing_columns;
  end if;
end $$;

select 'PRE-FLIGHT: prerequisites present' as check;

select 'folio_charges columns before: ' || string_agg(column_name, ', ' order by ordinal_position) as before_state
  from information_schema.columns
 where table_schema = 'public' and table_name = 'folio_charges';

select 'row counts before: folio_charges=' || (select count(*) from public.folio_charges)
    || ' payments=' || (select count(*) from public.payments)
    || ' pos_receipts=' || (select count(*) from public.pos_receipts)
    || ' reservations=' || (select count(*) from public.reservations) as before_state;

select 'receipt sequences before: ' || p.name || ' next=' || s.next_number as before_state
  from public.property_document_sequences s
  join public.properties p on p.id = s.property_id
 where s.book = 'receipt'
 order by p.name;
