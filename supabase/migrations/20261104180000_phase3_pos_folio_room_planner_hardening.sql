-- Phase 3 hardening: POS room charges must target an in-house reservation.
-- This is additive and preserves the established fn_record_pos_sale transaction.
-- A row lock serializes room-charge posting against check-out/status transitions.
begin;

alter table public.folio_charges add column if not exists reference text;

create or replace function public.fn_guard_pos_folio_charge()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_property_id uuid;
begin
  if new.source <> 'pos' then
    return new;
  end if;

  select r.status::text, r.property_id
    into v_status, v_property_id
  from public.reservations r
  where r.id = new.reservation_id
  for update;

  if v_status is null or v_property_id is distinct from new.property_id then
    raise exception 'POS room charge reservation does not belong to this property.';
  end if;
  if v_status <> 'checked-in' then
    raise exception 'POS room charges require a checked-in guest. Reservation status: %.', v_status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_pos_folio_charge on public.folio_charges;
create trigger trg_guard_pos_folio_charge
before insert or update of property_id, reservation_id, source
on public.folio_charges
for each row execute function public.fn_guard_pos_folio_charge();

-- The receipt already references its folio charge. Store the reciprocal receipt
-- identifier in the existing charge reference field without adding another ledger.
create or replace function public.fn_link_pos_receipt_to_folio()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.folio_charge_id is not null then
    update public.folio_charges
    set reference = concat('POS receipt ', new.id::text,
                           case when nullif(trim(new.order_number), '') is not null
                             then ' · Order ' || trim(new.order_number) else '' end)
    where id = new.folio_charge_id
      and property_id = new.property_id
      and reservation_id = new.reservation_id
      and source = 'pos';

    if not found then
      raise exception 'POS receipt folio link is invalid or belongs to another property/reservation.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_pos_receipt_to_folio on public.pos_receipts;
create trigger trg_link_pos_receipt_to_folio
after insert on public.pos_receipts
for each row execute function public.fn_link_pos_receipt_to_folio();

revoke all on function public.fn_guard_pos_folio_charge() from public, anon;
revoke all on function public.fn_link_pos_receipt_to_folio() from public, anon;
grant execute on function public.fn_guard_pos_folio_charge() to authenticated, service_role;
grant execute on function public.fn_link_pos_receipt_to_folio() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
