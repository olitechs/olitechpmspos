-- Phase 3 POS production lifecycle hardening
-- KDS status transitions, server-authorized re-fire, cancellation state, and audit trail.

alter table public.pos_kitchen_orders drop constraint if exists pos_kitchen_orders_status_check;
alter table public.pos_kitchen_orders add constraint pos_kitchen_orders_status_check
  check (status in ('new','preparing','ready','served','cancelled'));

create table if not exists public.pos_kitchen_order_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  kitchen_order_id uuid not null references public.pos_kitchen_orders(id) on delete cascade,
  event_type text not null check (event_type in ('fired','status_changed','refired','cancelled')),
  from_status text,
  to_status text,
  reason text,
  actor_user_id uuid,
  actor_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pos_kitchen_order_events_order_idx
  on public.pos_kitchen_order_events(property_id,kitchen_order_id,created_at desc);
alter table public.pos_kitchen_order_events enable row level security;
drop policy if exists pos_kitchen_order_events_select on public.pos_kitchen_order_events;
create policy pos_kitchen_order_events_select on public.pos_kitchen_order_events
  for select to authenticated using (public.is_platform_owner() or public.is_member_of_property(property_id));
revoke all on public.pos_kitchen_order_events from anon, public;
grant select on public.pos_kitchen_order_events to authenticated;

create or replace function public.fn_update_kitchen_order(p_property_id uuid,p_order_id uuid,p_status text,p_print_jobs jsonb)
returns public.pos_kitchen_orders language plpgsql security invoker set search_path=public as $$
declare v_row public.pos_kitchen_orders; v_from text; v_role text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  v_role:=coalesce(public.current_staff_role(p_property_id),public.property_role(p_property_id),'');
  if lower(v_role) not in ('owner','admin','manager','cashier','waiter','pos_staff','fb_manager','hotel_admin','super_admin','general_manager','front_office_manager','property_manager') then raise exception 'KDS update is not authorized for this staff role.'; end if;
  if p_status not in ('new','preparing','ready','served','cancelled') then raise exception 'Invalid kitchen order status.'; end if;
  select status into v_from from public.pos_kitchen_orders where id=p_order_id and property_id=p_property_id for update;
  if not found then raise exception 'Kitchen order not found.'; end if;
  if v_from='served' and p_status<>'served' then raise exception 'Served kitchen orders cannot be moved backwards.'; end if;
  if v_from='cancelled' and p_status<>'cancelled' then raise exception 'Cancelled kitchen orders cannot be reopened.'; end if;
  if p_status<>'cancelled' and v_from<>p_status and (v_from,p_status) not in (('new','preparing'),('preparing','ready'),('ready','served')) then raise exception 'Invalid kitchen production transition.'; end if;
  update public.pos_kitchen_orders set status=p_status,print_jobs=coalesce(p_print_jobs,print_jobs),updated_at=now(),served_at=case when p_status='served' then coalesce(served_at,now()) else served_at end where id=p_order_id and property_id=p_property_id returning * into v_row;
  if v_from<>p_status then
    insert into public.pos_kitchen_order_events(property_id,kitchen_order_id,event_type,from_status,to_status,actor_user_id)
    values(p_property_id,p_order_id,case when p_status='cancelled' then 'cancelled' else 'status_changed' end,v_from,p_status,auth.uid());
  end if;
  return v_row;
end; $$;
revoke all on function public.fn_update_kitchen_order(uuid,uuid,text,jsonb) from anon,public;
grant execute on function public.fn_update_kitchen_order(uuid,uuid,text,jsonb) to authenticated;

create or replace function public.fn_refire_kitchen_order(p_property_id uuid,p_order_id uuid,p_reason text)
returns public.pos_kitchen_orders language plpgsql security invoker set search_path=public as $$
declare v_row public.pos_kitchen_orders; v_role text; v_jobs jsonb;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  v_role:=coalesce(public.current_staff_role(p_property_id),public.property_role(p_property_id),'');
  if lower(v_role) not in ('owner','admin','manager','cashier','fb_manager','hotel_admin','super_admin','general_manager','front_office_manager','property_manager') then raise exception 'Manager authorization is required to re-fire a kitchen ticket.'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A re-fire reason is required.'; end if;
  select * into v_row from public.pos_kitchen_orders where id=p_order_id and property_id=p_property_id for update;
  if not found then raise exception 'Kitchen order not found.'; end if;
  if v_row.status in ('served','cancelled') then raise exception 'Served or cancelled tickets cannot be re-fired.'; end if;
  v_jobs:=coalesce(v_row.print_jobs,'{}'::jsonb);
  v_jobs:=jsonb_set(v_jobs,'{refire_count}',to_jsonb(coalesce((v_jobs->>'refire_count')::int,0)+1),true);
  v_jobs:=jsonb_set(v_jobs,'{last_refire_at}',to_jsonb(now()),true);
  update public.pos_kitchen_orders set print_jobs=v_jobs,updated_at=now() where id=v_row.id and property_id=p_property_id returning * into v_row;
  insert into public.pos_kitchen_order_events(property_id,kitchen_order_id,event_type,from_status,to_status,reason,actor_user_id,metadata)
  values(p_property_id,v_row.id,'refired',v_row.status,v_row.status,p_reason,auth.uid(),jsonb_build_object('refire_count',(v_jobs->>'refire_count')::int));
  return v_row;
end; $$;
revoke all on function public.fn_refire_kitchen_order(uuid,uuid,text) from anon,public;
grant execute on function public.fn_refire_kitchen_order(uuid,uuid,text) to authenticated;

create or replace function public.fn_create_kitchen_order(p_property_id uuid,p_table_key text,p_table_number text,p_order_number text,p_waiter text,p_order_lines jsonb,p_print_jobs jsonb)
returns public.pos_kitchen_orders language plpgsql security invoker set search_path=public as $$
declare v_row public.pos_kitchen_orders; v_role text;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  v_role:=coalesce(public.current_staff_role(p_property_id),public.property_role(p_property_id),'');
  if lower(v_role) not in ('owner','admin','manager','cashier','waiter','pos_staff','fb_manager','hotel_admin','super_admin','general_manager','front_office_manager','property_manager') then raise exception 'POS staff role is not authorized to fire kitchen orders.'; end if;
  insert into public.pos_kitchen_orders(property_id,table_key,table_number,order_number,waiter,order_lines,status,print_jobs,fired_at,updated_at)
  values(p_property_id,nullif(trim(p_table_key),''),coalesce(nullif(trim(p_table_number),''),''),coalesce(nullif(trim(p_order_number),''),''),nullif(trim(p_waiter),''),coalesce(p_order_lines,'[]'::jsonb),'new',coalesce(p_print_jobs,'{}'::jsonb),now(),now())
  on conflict(property_id,order_number) do update set table_key=excluded.table_key,table_number=excluded.table_number,waiter=excluded.waiter,order_lines=excluded.order_lines,print_jobs=excluded.print_jobs,updated_at=now()
  returning * into v_row;
  insert into public.pos_kitchen_order_events(property_id,kitchen_order_id,event_type,to_status,actor_user_id)
  values(p_property_id,v_row.id,'fired',v_row.status,auth.uid());
  return v_row;
end; $$;
revoke all on function public.fn_create_kitchen_order(uuid,text,text,text,text,jsonb,jsonb) from anon,public;
grant execute on function public.fn_create_kitchen_order(uuid,text,text,text,text,jsonb,jsonb) to authenticated;

create or replace function public.fn_list_active_kitchen_orders(p_property_id uuid)
returns setof public.pos_kitchen_orders language sql stable security invoker set search_path=public as $$
  select * from public.pos_kitchen_orders
  where property_id=p_property_id and status not in ('served','cancelled')
    and (public.is_platform_owner() or public.is_member_of_property(p_property_id))
  order by fired_at asc;
$$;
revoke all on function public.fn_list_active_kitchen_orders(uuid) from anon,public;
grant execute on function public.fn_list_active_kitchen_orders(uuid) to authenticated;
notify pgrst,'reload schema';