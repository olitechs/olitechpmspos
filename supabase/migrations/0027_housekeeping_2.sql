-- OliTechs PMS/POS v2 — Housekeeping 2.0
create table if not exists public.housekeeping_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  task_type text not null default 'checkout_clean' check (task_type in ('checkout_clean','stayover','deep_clean','inspection','maintenance')),
  status text not null default 'pending' check (status in ('pending','in_progress','completed','inspected','rejected','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references auth.users(id) on delete set null,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  inspected_at timestamptz,
  inspected_by uuid references auth.users(id) on delete set null,
  inspection_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists housekeeping_tasks_property_status_idx on public.housekeeping_tasks(property_id,status,priority,created_at);
create index if not exists housekeeping_tasks_room_idx on public.housekeeping_tasks(room_id,status);

-- Existing-schema compatibility: 0012 may already have created this table.
alter table public.housekeeping_tasks
  add column if not exists reservation_id uuid references public.reservations(id) on delete set null;
alter table public.housekeeping_tasks
  add column if not exists started_at timestamptz;
alter table public.housekeeping_tasks
  add column if not exists inspected_at timestamptz;
alter table public.housekeeping_tasks
  add column if not exists inspected_by uuid references auth.users(id) on delete set null;
alter table public.housekeeping_tasks
  add column if not exists inspection_notes text;
alter table public.housekeeping_tasks
  add column if not exists updated_at timestamptz not null default now();

alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_task_type_check;
alter table public.housekeeping_tasks
  add constraint housekeeping_tasks_task_type_check
  check (task_type in ('cleaning','inspection','turndown','deep_clean','linen_change','checkout_clean','stayover','maintenance'));

alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_status_check;
alter table public.housekeeping_tasks
  add constraint housekeeping_tasks_status_check
  check (status in ('pending','assigned','in_progress','completed','inspected','rejected','cancelled'));

create index if not exists housekeeping_tasks_reservation_idx
  on public.housekeeping_tasks(reservation_id);

alter table public.housekeeping_tasks enable row level security;
drop policy if exists housekeeping_tasks_select on public.housekeeping_tasks;
create policy housekeeping_tasks_select on public.housekeeping_tasks for select using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists housekeeping_tasks_insert on public.housekeeping_tasks;
create policy housekeeping_tasks_insert on public.housekeeping_tasks for insert with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists housekeeping_tasks_update on public.housekeeping_tasks;
create policy housekeeping_tasks_update on public.housekeeping_tasks for update using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_create_housekeeping_task(
 p_property_id uuid,p_room_id uuid,p_task_type text default 'checkout_clean',p_priority text default 'normal',
 p_reservation_id uuid default null,p_notes text default null
) returns public.housekeeping_tasks
language plpgsql security definer set search_path=public
as $$
declare v_task public.housekeeping_tasks;
begin
 if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 if not exists(select 1 from public.rooms where id=p_room_id and property_id=p_property_id) then raise exception 'Room not found.'; end if;
 if exists(select 1 from public.housekeeping_tasks where room_id=p_room_id and status in ('pending','in_progress','completed','rejected') and task_type=p_task_type) then
   raise exception 'An active housekeeping task of this type already exists for this room.';
 end if;
 insert into public.housekeeping_tasks(property_id,room_id,reservation_id,task_type,priority,notes)
 values(p_property_id,p_room_id,p_reservation_id,p_task_type,coalesce(p_priority,'normal'),p_notes)
 returning * into v_task;
 return v_task;
end;
$$;
grant execute on function public.fn_create_housekeeping_task(uuid,uuid,text,text,uuid,text) to authenticated;

create or replace function public.fn_update_housekeeping_task(
 p_task_id uuid,p_status text,p_assigned_to uuid default null,p_notes text default null
) returns public.housekeeping_tasks
language plpgsql security definer set search_path=public
as $$
declare v public.housekeeping_tasks;
begin
 select * into v from public.housekeeping_tasks where id=p_task_id for update;
 if v.id is null then raise exception 'Housekeeping task not found.'; end if;
 if not (public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not allowed.'; end if;
 if p_status not in ('pending','in_progress','completed','cancelled') then raise exception 'Invalid task status.'; end if;
 update public.housekeeping_tasks
 set status=p_status,
     assigned_to=coalesce(p_assigned_to,assigned_to),
     notes=coalesce(p_notes,notes),
     started_at=case when p_status='in_progress' and started_at is null then now() else started_at end,
     completed_at=case when p_status='completed' then now() else completed_at end,
     updated_at=now()
 where id=p_task_id returning * into v;
 if p_status='in_progress' then
   update public.rooms set status='cleaning' where id=v.room_id and status='dirty';
 elsif p_status='completed' then
   update public.rooms set status='cleaning' where id=v.room_id and status in ('dirty','cleaning');
 elsif p_status='cancelled' then
   update public.rooms set status='dirty' where id=v.room_id and status='cleaning';
 end if;
 return v;
end;
$$;
grant execute on function public.fn_update_housekeeping_task(uuid,text,uuid,text) to authenticated;

create or replace function public.fn_inspect_housekeeping_task(
 p_task_id uuid,p_pass boolean,p_notes text default null
) returns public.housekeeping_tasks
language plpgsql security definer set search_path=public
as $$
declare v public.housekeeping_tasks;
begin
 select * into v from public.housekeeping_tasks where id=p_task_id for update;
 if v.id is null then raise exception 'Housekeeping task not found.'; end if;
 if not (public.is_platform_owner() or public.is_member_of_property(v.property_id)) then raise exception 'Not allowed.'; end if;
 if v.status <> 'completed' then raise exception 'Only completed tasks can be inspected.'; end if;
 update public.housekeeping_tasks
 set status=case when p_pass then 'inspected' else 'rejected' end,
     inspected_at=now(), inspected_by=auth.uid(), inspection_notes=p_notes, updated_at=now()
 where id=p_task_id returning * into v;
 if p_pass then
   update public.rooms set status='available' where id=v.room_id and status='cleaning';
 else
   update public.rooms set status='dirty' where id=v.room_id;
 end if;
 return v;
end;
$$;
grant execute on function public.fn_inspect_housekeeping_task(uuid,boolean,text) to authenticated;

create or replace function public.fn_housekeeping_dashboard(p_property_id uuid)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v jsonb;
begin
 if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 select jsonb_build_object(
  'rooms', (
    select jsonb_build_object(
      'dirty', count(*) filter(where r.status='dirty'),
      'cleaning', count(*) filter(where r.status='cleaning'),
      'available', count(*) filter(where r.status='available'),
      'occupied', count(*) filter(where r.status='occupied'),
      'maintenance', count(*) filter(where r.status='maintenance')
    )
    from public.rooms r
    where r.property_id=p_property_id
  ),
  'tasks', (
    select jsonb_build_object(
      'pending', count(*) filter(where t.status='pending'),
      'in_progress', count(*) filter(where t.status='in_progress'),
      'completed', count(*) filter(where t.status='completed'),
      'rejected', count(*) filter(where t.status='rejected')
    )
    from public.housekeeping_tasks t
    where t.property_id=p_property_id
      and t.status not in ('cancelled','inspected')
  )
) into v;
 return v;
end;
$$;
grant execute on function public.fn_housekeeping_dashboard(uuid) to authenticated;

create or replace function public.fn_housekeeping_list_tasks(p_property_id uuid)
returns table(
 id uuid,room_id uuid,room_number int,task_type text,status text,priority text,assigned_to uuid,
 guest_name text,reservation_id uuid,notes text,created_at timestamptz,started_at timestamptz,completed_at timestamptz
)
language sql security definer set search_path=public
as $$
 select t.id,t.room_id,r.number,t.task_type,t.status,t.priority,t.assigned_to,res.guest_name,t.reservation_id,
        t.notes,t.created_at,t.started_at,t.completed_at
 from public.housekeeping_tasks t
 join public.rooms r on r.id=t.room_id
 left join public.reservations res on res.id=t.reservation_id
 where t.property_id=p_property_id
   and t.status not in ('cancelled','inspected')
   and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
 order by case t.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,t.created_at;
$$;
grant execute on function public.fn_housekeeping_list_tasks(uuid) to authenticated;

create or replace function public.fn_check_out_room(p_room_id uuid)
returns void
language plpgsql
as $$
declare v_res public.reservations; v_task public.housekeeping_tasks;
begin
 if not exists (
   select 1
   from public.rooms r
   where r.id=p_room_id
     and (public.is_platform_owner() or public.is_member_of_property(r.property_id))
 ) then
   raise exception 'Not allowed.';
 end if;

 select * into v_res from public.reservations where room_id=p_room_id and status='checked-in' order by created_at desc limit 1;
 if v_res.id is not null then update public.reservations set status='checked-out' where id=v_res.id; end if;
 update public.rooms set status='dirty' where id=p_room_id;
 if v_res.id is not null then
   if not exists(select 1 from public.housekeeping_tasks where room_id=p_room_id and task_type='checkout_clean' and status in ('pending','in_progress','completed','rejected')) then
     insert into public.housekeeping_tasks(property_id,room_id,reservation_id,task_type,priority)
     values(v_res.property_id,p_room_id,v_res.id,'checkout_clean','high');
   end if;
 end if;
end;
$$;
grant execute on function public.fn_check_out_room(uuid) to authenticated;

notify pgrst,'reload schema';
