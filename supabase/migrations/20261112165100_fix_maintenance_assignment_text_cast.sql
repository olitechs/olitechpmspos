-- Keep maintenance assignments compatible with the deployed text column while
-- validating that the selected technician belongs to the same property.
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
set search_path=public, pg_temp
as $function$
declare
 v_ticket public.maintenance_tickets;
 v_return_status text;
begin
 if auth.uid() is null then
  raise exception 'Authentication required.' using errcode='42501';
 end if;
 select * into v_ticket
 from public.maintenance_tickets
 where id=p_ticket_id
 for update;
 if not found then raise exception 'Maintenance ticket not found'; end if;
 if not (public.is_platform_owner() or public.is_member_of_property(v_ticket.property_id)) then
  raise exception 'Not authorized for this property' using errcode='42501';
 end if;
 if p_status not in ('open','assigned','in_progress','resolved','closed') then
  raise exception 'Invalid maintenance status';
 end if;
 if p_assigned_to is not null and not exists (
  select 1 from public.staff s
  where s.property_id=v_ticket.property_id and s.is_active=true
    and (s.user_id=p_assigned_to or s.id=p_assigned_to)
 ) then
  raise exception 'Assigned technician must be active and belong to this property.' using errcode='42501';
 end if;
 v_return_status:=coalesce(p_return_status,v_ticket.return_status,'dirty');
 if v_return_status not in ('available','dirty') then
  raise exception 'Return status must be available or dirty';
 end if;
 update public.maintenance_tickets
 set status=p_status,
     assigned_to=case when p_assigned_to is null then assigned_to else p_assigned_to::text end,
     started_at=case when p_status='in_progress' and started_at is null then now() else started_at end,
     resolved_at=case when p_status in ('resolved','closed') and resolved_at is null then now() else resolved_at end,
     resolution_notes=coalesce(p_resolution_notes,resolution_notes),
     return_status=v_return_status
 where id=p_ticket_id
 returning * into v_ticket;
 if v_ticket.room_id is not null then
  if p_status in ('open','assigned','in_progress') then
   update public.rooms set status='maintenance' where id=v_ticket.room_id and property_id=v_ticket.property_id;
  elsif p_status in ('resolved','closed') then
   update public.rooms set status=v_return_status where id=v_ticket.room_id and property_id=v_ticket.property_id;
  end if;
 end if;
 return v_ticket;
end;$function$;
revoke all on function public.fn_update_maintenance_ticket(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.fn_update_maintenance_ticket(uuid,text,uuid,text,text) to authenticated;
