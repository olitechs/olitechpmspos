-- Maintenance 2.0: synchronize maintenance tickets with room availability.
-- Apply after 0027_housekeeping_2.sql.

alter table public.maintenance_tickets
  add column if not exists assigned_to uuid references public.profiles(id),
  add column if not exists started_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_notes text,
  add column if not exists return_status text not null default 'dirty';

create index if not exists maintenance_tickets_property_status_idx
  on public.maintenance_tickets(property_id, status);

create or replace function public.fn_create_maintenance_ticket(
  p_property_id uuid,
  p_room_id uuid default null,
  p_issue text default null,
  p_priority text default 'medium'
)
returns public.maintenance_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.maintenance_tickets;
  v_room_status text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property';
  end if;

  if nullif(trim(coalesce(p_issue, '')), '') is null then
    raise exception 'Issue is required';
  end if;

  if p_room_id is not null then
    select status into v_room_status
    from public.rooms
    where id = p_room_id and property_id = p_property_id
    for update;

    if not found then
      raise exception 'Room not found';
    end if;

    if v_room_status in ('occupied', 'booked') then
      raise exception 'Cannot place an occupied or booked room into maintenance';
    end if;

    update public.rooms
      set status = 'maintenance'
    where id = p_room_id and property_id = p_property_id;
  end if;

  insert into public.maintenance_tickets(
    property_id, room_id, issue, priority, status, return_status
  )
  values (
    p_property_id, p_room_id, trim(p_issue), coalesce(p_priority, 'medium'), 'open', 'dirty'
  )
  returning * into v_ticket;

  return v_ticket;
end;
$$;

create or replace function public.fn_update_maintenance_ticket(
  p_ticket_id uuid,
  p_status text,
  p_assigned_to uuid default null,
  p_resolution_notes text default null,
  p_return_status text default null
)
returns public.maintenance_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.maintenance_tickets;
  v_return_status text;
begin
  select * into v_ticket
  from public.maintenance_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Maintenance ticket not found';
  end if;

  if not (public.is_platform_owner() or public.is_member_of_property(v_ticket.property_id)) then
    raise exception 'Not authorized for this property';
  end if;

  if p_status not in ('open','assigned','in_progress','resolved','closed') then
    raise exception 'Invalid maintenance status';
  end if;

  v_return_status := coalesce(p_return_status, v_ticket.return_status, 'dirty');
  if v_return_status not in ('available','dirty') then
    raise exception 'Return status must be available or dirty';
  end if;

  update public.maintenance_tickets
    set status = p_status,
        assigned_to = coalesce(p_assigned_to, assigned_to),
        started_at = case when p_status = 'in_progress' and started_at is null then now() else started_at end,
        resolved_at = case when p_status in ('resolved','closed') and resolved_at is null then now() else resolved_at end,
        resolution_notes = coalesce(p_resolution_notes, resolution_notes),
        return_status = v_return_status
  where id = p_ticket_id
  returning * into v_ticket;

  if v_ticket.room_id is not null then
    if p_status in ('open','assigned','in_progress') then
      update public.rooms set status = 'maintenance'
      where id = v_ticket.room_id and property_id = v_ticket.property_id;
    elsif p_status in ('resolved','closed') then
      update public.rooms set status = v_return_status
      where id = v_ticket.room_id and property_id = v_ticket.property_id;
    end if;
  end if;

  return v_ticket;
end;
$$;

create or replace function public.fn_maintenance_dashboard(p_property_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized for this property';
  end if;

  select jsonb_build_object(
    'open', count(*) filter (where status = 'open'),
    'assigned', count(*) filter (where status = 'assigned'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'resolved', count(*) filter (where status = 'resolved'),
    'closed', count(*) filter (where status = 'closed'),
    'high_priority_open', count(*) filter (where priority = 'high' and status not in ('resolved','closed'))
  )
  into result
  from public.maintenance_tickets
  where property_id = p_property_id;

  return coalesce(result, '{}'::jsonb);
end;
$$;

grant execute on function public.fn_create_maintenance_ticket(uuid, uuid, text, text) to authenticated;
grant execute on function public.fn_update_maintenance_ticket(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.fn_maintenance_dashboard(uuid) to authenticated;

notify pgrst, 'reload schema';
