-- Property-scoped guest requests, transfers and tours with an immutable activity history.
create unique index if not exists reservations_property_id_id_unique on public.reservations(property_id,id);
create unique index if not exists rooms_property_id_id_unique on public.rooms(property_id,id);
create table if not exists public.guest_service_requests (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 reservation_id uuid null references public.reservations(id) on delete set null,
 room_id uuid null references public.rooms(id) on delete set null,
 request_type text not null default 'guest_request' check (request_type in ('guest_request','transfer','tour')),
 category text not null default 'general' check (char_length(btrim(category)) between 1 and 60),
 subject text not null check (char_length(btrim(subject)) between 1 and 160),
 description text null check (description is null or char_length(description)<=2000),
 scheduled_at timestamptz null,
 pickup_location text null check (pickup_location is null or char_length(pickup_location)<=200),
 destination text null check (destination is null or char_length(destination)<=200),
 priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
 status text not null default 'new' check (status in ('new','acknowledged','in_progress','waiting_guest','resolved','cancelled','closed')),
 assigned_to uuid null references public.profiles(id) on delete set null,
 resolution_notes text null check (resolution_notes is null or char_length(resolution_notes)<=1000),
 created_by uuid not null default auth.uid() references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint guest_service_requests_reservation_property_fk foreign key (property_id,reservation_id) references public.reservations(property_id,id) on delete set null (reservation_id),
 constraint guest_service_requests_room_property_fk foreign key (property_id,room_id) references public.rooms(property_id,id) on delete set null (room_id)
);
create index if not exists guest_service_requests_property_status_created_idx on public.guest_service_requests(property_id,status,created_at desc);
create index if not exists guest_service_requests_property_assignee_idx on public.guest_service_requests(property_id,assigned_to,status);
alter table public.guest_service_requests enable row level security;
drop policy if exists guest_service_requests_select on public.guest_service_requests;
create policy guest_service_requests_select on public.guest_service_requests for select to authenticated using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists guest_service_requests_insert on public.guest_service_requests;
create policy guest_service_requests_insert on public.guest_service_requests for insert to authenticated with check ((public.is_platform_owner() or public.is_member_of_property(property_id)) and created_by=auth.uid());
drop policy if exists guest_service_requests_update on public.guest_service_requests;
create policy guest_service_requests_update on public.guest_service_requests for update to authenticated using (public.is_platform_owner() or (public.is_member_of_property(property_id) and (public.property_role(property_id)=any(array['owner'::public.property_member_role,'admin'::public.property_member_role,'manager'::public.property_member_role]) or public.current_staff_role(property_id)=any(array['hotel_admin','super_admin','front_office_manager','receptionist','front_desk'])))) with check (public.is_platform_owner() or (public.is_member_of_property(property_id) and (public.property_role(property_id)=any(array['owner'::public.property_member_role,'admin'::public.property_member_role,'manager'::public.property_member_role]) or public.current_staff_role(property_id)=any(array['hotel_admin','super_admin','front_office_manager','receptionist','front_desk']))));

create table if not exists public.guest_service_request_events (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 request_id uuid not null references public.guest_service_requests(id) on delete cascade,
 event_type text not null check (event_type in ('created','status_changed','assigned','updated')),
 from_status text null,
 to_status text null,
 note text null,
 actor_id uuid null references public.profiles(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists guest_service_request_events_request_created_idx on public.guest_service_request_events(request_id,created_at desc);
alter table public.guest_service_request_events enable row level security;
drop policy if exists guest_service_request_events_select on public.guest_service_request_events;
create policy guest_service_request_events_select on public.guest_service_request_events for select to authenticated using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists guest_service_request_events_insert on public.guest_service_request_events;

create or replace function public.fn_log_guest_service_request_event()
returns trigger language plpgsql security definer set search_path=public, pg_temp as $$
declare v_event text;
begin
 if auth.uid() is null or not (public.is_platform_owner() or public.is_member_of_property(coalesce(new.property_id,old.property_id))) then
  raise exception 'Not authorized to write guest service request history.';
 end if;
 if tg_op='INSERT' then
  v_event:='created';
  insert into public.guest_service_request_events(property_id,request_id,event_type,to_status,note,actor_id)
  values(new.property_id,new.id,v_event,new.status,'Request created',auth.uid());
  return new;
 end if;
 if new.status is distinct from old.status then v_event:='status_changed';
 elsif new.assigned_to is distinct from old.assigned_to then v_event:='assigned';
 else v_event:='updated';
 end if;
 insert into public.guest_service_request_events(property_id,request_id,event_type,from_status,to_status,note,actor_id)
 values(new.property_id,new.id,v_event,old.status,new.status,nullif(new.resolution_notes,''),auth.uid());
 return new;
end;$$;
create or replace function public.fn_validate_guest_service_request()
returns trigger language plpgsql set search_path=public as $
begin
 if new.assigned_to is not null and not exists(select 1 from public.staff s where s.property_id=new.property_id and s.user_id=new.assigned_to and s.is_active=true) then
  raise exception 'Assigned staff member must be active and belong to this property.';
 end if;
 return new;
end;$;
drop trigger if exists guest_service_request_validate on public.guest_service_requests;
create trigger guest_service_request_validate before insert or update on public.guest_service_requests for each row execute function public.fn_validate_guest_service_request();

create or replace function public.fn_touch_guest_service_request_updated_at()
returns trigger language plpgsql set search_path=public as $
begin new.updated_at:=now(); return new; end;$;
drop trigger if exists guest_service_request_touch_updated_at on public.guest_service_requests;
create trigger guest_service_request_touch_updated_at before update on public.guest_service_requests for each row execute function public.fn_touch_guest_service_request_updated_at();
drop trigger if exists guest_service_request_event_log on public.guest_service_requests;
create trigger guest_service_request_event_log after insert or update on public.guest_service_requests for each row execute function public.fn_log_guest_service_request_event();
grant select,insert,update on public.guest_service_requests to authenticated;
grant select,insert on public.guest_service_request_events to authenticated;
revoke all on public.guest_service_requests,public.guest_service_reques