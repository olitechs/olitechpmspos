-- Phase 2: immutable audit events for reservation lifecycle and room-status changes.
-- Keep the payload intentionally limited to operational fields; do not copy guest phone or free-text notes.
create or replace function public.fn_audit_pms_reservation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_property_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_property_id := new.property_id;
    v_action := 'pms_reservation_created';
    v_new := jsonb_build_object(
      'reservation_id', new.id,
      'room_id', new.room_id,
      'guest_id', new.guest_id,
      'guest_name', new.guest_name,
      'arrival', new.arrival,
      'departure', new.departure,
      'status', new.status,
      'rate', new.rate,
      'payment_status', new.payment_status,
      'total_amount', new.total_amount,
      'amount_paid', new.amount_paid,
      'channel', new.channel,
      'meal_plan', new.meal_plan,
      'group_id', new.group_id
    );
  elsif tg_op = 'UPDATE' then
    if old.room_id is not distinct from new.room_id
      and old.guest_id is not distinct from new.guest_id
      and old.guest_name is not distinct from new.guest_name
      and old.arrival is not distinct from new.arrival
      and old.departure is not distinct from new.departure
      and old.status is not distinct from new.status
      and old.rate is not distinct from new.rate
      and old.payment_status is not distinct from new.payment_status
      and old.total_amount is not distinct from new.total_amount
      and old.amount_paid is not distinct from new.amount_paid
      and old.channel is not distinct from new.channel
      and old.meal_plan is not distinct from new.meal_plan
      and old.group_id is not distinct from new.group_id then
      return new;
    end if;
    v_property_id := new.property_id;
    v_action := 'pms_reservation_updated';
    v_old := jsonb_build_object(
      'reservation_id', old.id,
      'room_id', old.room_id,
      'guest_id', old.guest_id,
      'guest_name', old.guest_name,
      'arrival', old.arrival,
      'departure', old.departure,
      'status', old.status,
      'rate', old.rate,
      'payment_status', old.payment_status,
      'total_amount', old.total_amount,
      'amount_paid', old.amount_paid,
      'channel', old.channel,
      'meal_plan', old.meal_plan,
      'group_id', old.group_id
    );
    v_new := jsonb_build_object(
      'reservation_id', new.id,
      'room_id', new.room_id,
      'guest_id', new.guest_id,
      'guest_name', new.guest_name,
      'arrival', new.arrival,
      'departure', new.departure,
      'status', new.status,
      'rate', new.rate,
      'payment_status', new.payment_status,
      'total_amount', new.total_amount,
      'amount_paid', new.amount_paid,
      'channel', new.channel,
      'meal_plan', new.meal_plan,
      'group_id', new.group_id
    );
  else
    v_property_id := old.property_id;
    v_action := 'pms_reservation_deleted';
    v_old := jsonb_build_object(
      'reservation_id', old.id,
      'room_id', old.room_id,
      'guest_id', old.guest_id,
      'guest_name', old.guest_name,
      'arrival', old.arrival,
      'departure', old.departure,
      'status', old.status,
      'rate', old.rate,
      'payment_status', old.payment_status,
      'total_amount', old.total_amount,
      'amount_paid', old.amount_paid,
      'channel', old.channel,
      'meal_plan', old.meal_plan,
      'group_id', old.group_id
    );
  end if;

  insert into public.audit_logs(actor_id, property_id, action, old_value, new_value)
  values (auth.uid(), v_property_id, v_action, v_old, v_new);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.fn_audit_pms_reservation_change() from public, anon, authenticated;
drop trigger if exists trg_audit_pms_reservation_change on public.reservations;
create trigger trg_audit_pms_reservation_change
after insert or update or delete on public.reservations
for each row execute function public.fn_audit_pms_reservation_change();

create or replace function public.fn_audit_pms_room_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is not distinct from new.status then return new; end if;
  insert into public.audit_logs(actor_id, property_id, action, old_value, new_value)
  values (
    auth.uid(),
    new.property_id,
    'pms_room_status_changed',
    jsonb_build_object('room_id', old.id, 'room_number', old.number, 'status', old.status),
    jsonb_build_object('room_id', new.id, 'room_number', new.number, 'status', new.status)
  );
  return new;
end;
$$;

revoke all on function public.fn_audit_pms_room_status_change() from public, anon, authenticated;
drop trigger if exists trg_audit_pms_room_status_change on public.rooms;
create trigger trg_audit_pms_room_status_change
after update of status on public.rooms
for each row execute function public.fn_audit_pms_room_status_change();
