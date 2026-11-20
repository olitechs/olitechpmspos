-- Phase 2 numbering probe — proves a manual room charge receives the next
-- ticket number from the property book. Everything runs inside a transaction
-- and is rolled back, so no production row or sequence value is kept.
--
-- The trigger only allocates when a signed-in user is present (auth.uid()), so
-- the session impersonates the platform owner (or, failing that, any property
-- member) for the duration of the transaction. A '(none)' result therefore
-- means numbering could not be exercised in this database, not that the
-- trigger is missing.
\set ON_ERROR_STOP off

begin;

select set_config('request.jwt.claim.sub', coalesce(
  (select id::text from public.profiles where platform_role = 'platform_owner' limit 1),
  (select user_id::text from public.property_users limit 1),
  ''), true) as probe_actor;

select 'PROBE receipt books before: ' || count(*) as probe
  from public.property_document_sequences where book = 'receipt';

with target as (
  select r.property_id, r.id as reservation_id
    from public.reservations r
   where r.status <> 'cancelled'
   order by r.created_at
   limit 1
)
insert into public.folio_charges (property_id, reservation_id, source, description, amount, category)
select property_id, reservation_id, 'room', 'phase 2 verification probe', 1, 'accommodation'
  from target
returning 'PROBE allocated ticket=' || coalesce(ticket_number, '(none - no signed-in actor in session)')
       || ' business_date=' || business_date
       || ' board=' || coalesce(board_plan, '(none)')
       || ' department=' || coalesce(department_id::text, '(unmapped)') as probe;

select 'PROBE sequence after: ' || p.name || ' next=' || s.next_number as probe
  from public.property_document_sequences s
  join public.properties p on p.id = s.property_id
 where s.book = 'receipt'
 order by p.name;

rollback;

select 'PROBE rolled back; no production row or sequence value was kept.' as probe;
