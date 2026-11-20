-- Phase 2 numbering probe — proves a manual room charge receives the next
-- ticket number from the property book. Everything runs inside a transaction
-- and is rolled back, so no production row or sequence value is kept.
--
-- The trigger only allocates when a signed-in user is present (auth.uid()), so
-- the session impersonates an existing property member for the duration of the
-- transaction. A '(none)' result therefore means no member user could be found
-- for the probe, not that numbering is broken.
\set ON_ERROR_STOP off

begin;

select set_config('request.jwt.claim.sub', coalesce((
  select u.user_id::text
    from public.property_users u
    join public.property_document_sequences s on s.property_id = u.property_id and s.book = 'receipt'
    join public.reservations r on r.property_id = u.property_id and r.status <> 'cancelled'
   limit 1), ''), true) as probe_actor;

select 'PROBE sequence before: ' || p.name || ' next=' || s.next_number as probe
  from public.property_document_sequences s
  join public.properties p on p.id = s.property_id
 where s.book = 'receipt'
 order by p.name;

with target as (
  select r.property_id, r.id as reservation_id
    from public.reservations r
    join public.property_document_sequences s on s.property_id = r.property_id and s.book = 'receipt'
   where r.status <> 'cancelled'
     and exists (select 1 from public.property_users u where u.property_id = r.property_id)
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
