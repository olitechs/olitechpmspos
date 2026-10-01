-- OliTechs PMS/POS v2 — persistent POS table sessions
-- Keeps active POS work server-side so refreshes and multiple terminals do not
-- lose open tables or in-progress orders. PMS tables are untouched.

create table if not exists public.pos_table_sessions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  table_key text not null,
  table_number text not null,
  zone_id text,
  status text not null default 'occupied'
    check (status in ('occupied','unsettled','closed')),
  guests integer not null default 1 check (guests > 0),
  waiter text,
  order_number text,
  order_lines jsonb not null default '[]'::jsonb,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists pos_table_sessions_active_idx
  on public.pos_table_sessions(property_id, table_key)
  where status <> 'closed';

create index if not exists pos_table_sessions_property_idx
  on public.pos_table_sessions(property_id, updated_at desc);

alter table public.pos_table_sessions enable row level security;

drop policy if exists pos_table_sessions_select on public.pos_table_sessions;
create policy pos_table_sessions_select
  on public.pos_table_sessions for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_table_sessions_insert on public.pos_table_sessions;
create policy pos_table_sessions_insert
  on public.pos_table_sessions for insert
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager'
    )
  );

drop policy if exists pos_table_sessions_update on public.pos_table_sessions;
create policy pos_table_sessions_update
  on public.pos_table_sessions for update
  using (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager'
    )
  )
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager'
    )
  );

drop policy if exists pos_table_sessions_delete on public.pos_table_sessions;
create policy pos_table_sessions_delete
  on public.pos_table_sessions for delete
  using (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager','cashier')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager')
  );

create or replace function public.fn_touch_pos_table_session(
  p_property_id uuid,
  p_table_key text,
  p_table_number text,
  p_zone_id text,
  p_status text,
  p_guests integer,
  p_waiter text,
  p_order_number text,
  p_order_lines jsonb
) returns public.pos_table_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pos_table_sessions;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  if p_status not in ('occupied','unsettled','closed') then
    raise exception 'Invalid POS table status.';
  end if;

  if p_status <> 'closed' then
    insert into public.pos_table_sessions(
      property_id, table_key, table_number, zone_id, status, guests, waiter,
      order_number, order_lines, opened_by, updated_at, closed_at
    ) values (
      p_property_id, p_table_key, p_table_number, p_zone_id, p_status,
      greatest(coalesce(p_guests,1),1), nullif(trim(p_waiter),''),
      nullif(trim(p_order_number),''), coalesce(p_order_lines,'[]'::jsonb),
      auth.uid(), now(), null
    )
    on conflict (property_id, table_key) where status <> 'closed'
    do update set
      table_number = excluded.table_number,
      zone_id = excluded.zone_id,
      status = excluded.status,
      guests = excluded.guests,
      waiter = coalesce(excluded.waiter, public.pos_table_sessions.waiter),
      order_number = coalesce(excluded.order_number, public.pos_table_sessions.order_number),
      order_lines = excluded.order_lines,
      updated_at = now(),
      closed_at = null
    returning * into v_row;
  else
    update public.pos_table_sessions
       set status = 'closed', updated_at = now(), closed_at = now(),
           order_lines = coalesce(p_order_lines, order_lines)
     where property_id = p_property_id
       and table_key = p_table_key
       and status <> 'closed'
     returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.fn_touch_pos_table_session(
  uuid,text,text,text,text,integer,text,text,jsonb
) to authenticated;

create or replace function public.fn_list_active_pos_table_sessions(
  p_property_id uuid
) returns setof public.pos_table_sessions
language sql
security definer
stable
set search_path = public
as $$
  select *
  from public.pos_table_sessions
  where property_id = p_property_id
    and status <> 'closed'
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
  order by updated_at desc;
$$;

grant execute on function public.fn_list_active_pos_table_sessions(uuid) to authenticated;

notify pgrst, 'reload schema';


-- Phase 2E: running table checks retain which lines have already been fired.
alter table public.pos_table_sessions
  add column if not exists sent_order_lines jsonb not null default '[]'::jsonb;

create or replace function public.fn_mark_pos_table_sent_lines(
  p_property_id uuid,
  p_table_key text,
  p_sent_order_lines jsonb
) returns public.pos_table_sessions
language plpgsql security definer set search_path = public
as $$
declare v_row public.pos_table_sessions;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  update public.pos_table_sessions
     set sent_order_lines = coalesce(p_sent_order_lines, '[]'::jsonb),
         updated_at = now()
   where property_id = p_property_id
     and table_key = p_table_key
     and status <> 'closed'
   returning * into v_row;
  if v_row.id is null then raise exception 'Open table session not found.'; end if;
  return v_row;
end;
$$;
grant execute on function public.fn_mark_pos_table_sent_lines(uuid,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
