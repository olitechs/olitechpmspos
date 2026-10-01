-- OliTechs PMS+POS — Phase 1 security hardening
--
-- Additive hardening only. Existing migration files are not renamed or
-- rewritten because their filenames are deployment history.
--
-- Goals:
-- 1. Prevent property membership rows from being moved across tenants by a
--    hotel administrator.
-- 2. Prevent reservations/folios/payments from mixing property-owned rows.
-- 3. Keep all checks server-side so client-supplied property_id is never the
--    final security boundary.

-- -------------------------------------------------------------------------
-- Property membership: hotel admins can manage roles, but cannot move a
-- membership to another property or change its user_id. Platform owners
-- retain portfolio-level control.
-- -------------------------------------------------------------------------

drop policy if exists property_users_update on public.property_users;
create policy property_users_update on public.property_users
for update
using (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner', 'admin')
)
with check (
  public.is_platform_owner()
  or (
    public.property_role(property_id) in ('owner', 'admin')
    and property_id = property_users.property_id
    and user_id = property_users.user_id
  )
);

-- -------------------------------------------------------------------------
-- Cross-property relationship validation.
-- RLS protects row visibility, but RLS alone does not guarantee that a row's
-- foreign keys belong to the same property. These triggers close that gap.
-- -------------------------------------------------------------------------

create or replace function public.validate_reservation_property_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_room_property uuid;
  v_guest_property uuid;
begin
  select property_id into v_room_property
  from public.rooms
  where id = new.room_id;

  if v_room_property is null or v_room_property <> new.property_id then
    raise exception 'Room does not belong to the reservation property.';
  end if;

  if new.guest_id is not null then
    select property_id into v_guest_property
    from public.guests
    where id = new.guest_id;

    if v_guest_property is null or v_guest_property <> new.property_id then
      raise exception 'Guest does not belong to the reservation property.';
    end if;
  end if;

  if new.departure <= new.arrival then
    raise exception 'Departure date must be after arrival date.';
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_property_scope on public.reservations;
create trigger reservations_property_scope
before insert or update on public.reservations
for each row execute function public.validate_reservation_property_scope();

create or replace function public.validate_folio_property_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reservation_property uuid;
begin
  select property_id into v_reservation_property
  from public.reservations
  where id = new.reservation_id;

  if v_reservation_property is null or v_reservation_property <> new.property_id then
    raise exception 'Folio transaction does not belong to the reservation property.';
  end if;

  return new;
end;
$$;

drop trigger if exists folio_charges_property_scope on public.folio_charges;
create trigger folio_charges_property_scope
before insert or update on public.folio_charges
for each row execute function public.validate_folio_property_scope();

drop trigger if exists payments_property_scope on public.payments;
create trigger payments_property_scope
before insert or update on public.payments
for each row execute function public.validate_folio_property_scope();

-- -------------------------------------------------------------------------
-- Server-side reservation overlap protection for direct writes.
--
-- Existing RPCs remain the preferred mutation path. This trigger protects
-- direct table writes made through authenticated service calls as well.
-- Cancelled/checked-out reservations do not occupy a room.
-- -------------------------------------------------------------------------

create or replace function public.prevent_reservation_overlap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status in ('booked', 'checked-in') then
    if exists (
      select 1
      from public.reservations r
      where r.room_id = new.room_id
        and r.property_id = new.property_id
        and r.id <> new.id
        and r.status in ('booked', 'checked-in')
        and new.arrival < r.departure
        and new.departure > r.arrival
    ) then
      raise exception 'Room is already reserved for part of this stay.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_no_overlap on public.reservations;
create trigger reservations_no_overlap
before insert or update on public.reservations
for each row execute function public.prevent_reservation_overlap();

comment on function public.prevent_reservation_overlap() is
'Phase 1 tenant-safe reservation overlap guard. Canonical reservation creation should use the approved RPC/transaction path.';
