-- PMS/POS separation: reservations are Back Office data. POS gets a minimal
-- room-charge lookup and a controlled restaurant folio posting function.

create or replace function public.can_backoffice(p_property_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','reception','housekeeping')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','front_office_manager','receptionist','front_desk','housekeeping_supervisor');
$$;

create or replace function public.list_room_charge_stays(p_property_id uuid)
returns table(id uuid, guest_name text, room_number text)
language sql security definer set search_path = public as $$
  select r.id, r.guest_name, rm.number::text
  from public.reservations r
  left join public.rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id
    and r.status = 'checked-in'
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id));
$$;
grant execute on function public.list_room_charge_stays(uuid) to authenticated;

-- Reservation rows may contain sensitive rates. POS roles do not get direct
-- SELECT access; Back Office roles do.
drop policy if exists reservations_select on public.reservations;
drop policy if exists reservations_insert on public.reservations;
drop policy if exists reservations_update on public.reservations;
drop policy if exists reservations_delete on public.reservations;
create policy reservations_select on public.reservations for select using (public.can_backoffice(property_id));
create policy reservations_insert on public.reservations for insert with check (public.can_backoffice(property_id));
create policy reservations_update on public.reservations for update using (public.can_backoffice(property_id)) with check (public.can_backoffice(property_id));
create policy reservations_delete on public.reservations for delete using (public.can_backoffice(property_id));

create or replace function public.charge_restaurant_to_room(p_property_id uuid, p_reservation_id uuid, p_description text, p_amount numeric)
returns public.folio_charges
language plpgsql security definer set search_path = public
as $$
declare v_charge public.folio_charges;
        v_role text;
        v_res_property uuid;
begin
  select property_id into v_res_property from public.reservations where id = p_reservation_id;
  if v_res_property is null or v_res_property <> p_property_id then raise exception 'Reservation not found.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  v_role := public.current_staff_role(p_property_id);
  if v_role is not null then
    if v_role not in ('hotel_admin','super_admin','cashier') then
      raise exception 'Only an authorised cashier can charge a restaurant bill to a room.';
    end if;
  elsif not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only an authorised cashier or manager can charge a restaurant bill to a room.';
  end if;
  if p_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  insert into public.folio_charges(property_id,reservation_id,source,description,amount)
    values(p_property_id,p_reservation_id,'pos',p_description,p_amount) returning * into v_charge;
  return v_charge;
end;
$$;
grant execute on function public.charge_restaurant_to_room(uuid,uuid,text,numeric) to authenticated;

-- Folios/payments are Back Office financial data. POS only uses the two
-- controlled RPCs above, so it never receives folio rows directly.
do $$
declare t text;
begin
  foreach t in array array['guests','rooms','folio_charges','payments'] loop
    execute format('drop policy if exists "%1$s_select" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_insert" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_update" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_delete" on public.%1$s', t);
  end loop;
end $$;

create policy guests_select on public.guests for select using (public.can_backoffice(property_id));
create policy guests_insert on public.guests for insert with check (public.can_backoffice(property_id));
create policy guests_update on public.guests for update using (public.can_backoffice(property_id)) with check (public.can_backoffice(property_id));
create policy guests_delete on public.guests for delete using (public.can_backoffice(property_id));

create policy rooms_select on public.rooms for select using (public.can_backoffice(property_id));
create policy rooms_insert on public.rooms for insert with check (public.can_backoffice(property_id));
create policy rooms_update on public.rooms for update using (public.can_backoffice(property_id)) with check (public.can_backoffice(property_id));
create policy rooms_delete on public.rooms for delete using (public.can_backoffice(property_id));

create policy folio_charges_select on public.folio_charges for select using (public.can_backoffice(property_id));
create policy folio_charges_insert on public.folio_charges for insert with check (public.can_backoffice(property_id) or public.property_role(property_id) = 'cashier' or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier'));
create policy folio_charges_update on public.folio_charges for update using (public.can_backoffice(property_id)) with check (public.can_backoffice(property_id));
create policy folio_charges_delete on public.folio_charges for delete using (public.can_backoffice(property_id));

create policy payments_select on public.payments for select using (public.can_backoffice(property_id));
create policy payments_insert on public.payments for insert with check (public.can_backoffice(property_id) or public.property_role(property_id) = 'cashier' or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier'));
create policy payments_update on public.payments for update using (public.can_backoffice(property_id)) with check (public.can_backoffice(property_id));
create policy payments_delete on public.payments for delete using (public.can_backoffice(property_id));
