-- Phase 3: property-scoped POS floor zones, tables, waiter assignments and layout.
-- Forward-only migration artifact; not applied to production by this change.
create table if not exists public.pos_floor_zones (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 zone_key text not null, name text not null check(length(trim(name)) between 1 and 80),
 sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(property_id,zone_key)
);
create table if not exists public.pos_floor_tables (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 zone_key text not null, table_key text not null, table_number integer not null check(table_number>0),
 seats integer not null default 4 check(seats between 1 and 50), x integer not null default 16 check(x between 0 and 10000),
 y integer not null default 16 check(y between 0 and 10000), width integer not null default 86 check(width between 48 and 600),
 height integer not null default 64 check(height between 48 and 600), assigned_waiter_id uuid references public.staff(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(property_id,table_key), unique(property_id,zone_key,table_number),
 foreign key(property_id,zone_key) references public.pos_floor_zones(property_id,zone_key) on delete cascade
);
create index if not exists pos_floor_zones_property_order_idx on public.pos_floor_zones(property_id,sort_order,zone_key);
create index if not exists pos_floor_tables_property_zone_idx on public.pos_floor_tables(property_id,zone_key,table_number);
alter table public.pos_floor_zones enable row level security;
alter table public.pos_floor_tables enable row level security;
drop policy if exists pos_floor_zones_select on public.pos_floor_zones;
create policy pos_floor_zones_select on public.pos_floor_zones for select to authenticated using(public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists pos_floor_tables_select on public.pos_floor_tables;
create policy pos_floor_tables_select on public.pos_floor_tables for select to authenticated using(public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_list_pos_floor_configuration(p_property_id uuid) returns jsonb
language plpgsql security definer stable set search_path=public as $$
declare v_zones jsonb;
begin
 if not (coalesce(public.is_platform_owner(), false) or coalesce(public.is_member_of_property(p_property_id), false)) then raise exception 'Not allowed to read this property floor.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',z.zone_key,'name',z.name,'tables',coalesce((
  select jsonb_agg(jsonb_build_object('id',t.table_key,'number',t.table_number,'seats',t.seats,'x',t.x,'y',t.y,'w',t.width,'h',t.height,
   'assignedWaiterId',t.assigned_waiter_id,'assignedWaiterName',s.full_name) order by t.table_number)
  from public.pos_floor_tables t left join public.staff s on s.id=t.assigned_waiter_id and s.property_id=t.property_id
  where t.property_id=z.property_id and t.zone_key=z.zone_key
 ),'[]'::jsonb)) order by z.sort_order,z.zone_key),'[]'::jsonb) into v_zones
 from public.pos_floor_zones z where z.property_id=p_property_id;
 return v_zones;
end; $$;
revoke all on function public.fn_list_pos_floor_configuration(uuid) from public;
grant execute on function public.fn_list_pos_floor_configuration(uuid) to authenticated;

create or replace function public.fn_list_pos_floor_waiters(p_property_id uuid) returns table(id uuid,full_name text,role text)
language plpgsql security definer stable set search_path=public as $$
begin
 if not (coalesce(public.is_platform_owner(), false) or coalesce(public.is_member_of_property(p_property_id), false)) then raise exception 'Not allowed to read staff for this property.'; end if;
 return query select s.id,s.full_name,s.role from public.staff s
 where s.property_id=p_property_id and s.is_active=true and s.role='waiter' order by s.full_name;
end; $$;
revoke all on function public.fn_list_pos_floor_waiters(uuid) from public;
grant execute on function public.fn_list_pos_floor_waiters(uuid) to authenticated;

create or replace function public.fn_save_pos_floor_configuration(p_property_id uuid,p_zones jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_zone jsonb; v_table jsonb; v_zone_key text; v_table_key text; v_waiter_id uuid; v_zone_count integer; v_table_count integer;
begin
 if not (
  coalesce(public.is_platform_owner(), false)
  or coalesce(public.property_role(p_property_id) in ('owner','admin','manager'), false)
  or coalesce(public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager'), false)
 ) then
  raise exception 'Only an authorized property administrator can change the POS floor.';
 end if;
 if p_zones is null or jsonb_typeof(p_zones)<>'array' then raise exception 'Floor configuration must be a list of zones.'; end if;
 select count(*) into v_zone_count from jsonb_array_elements(p_zones);
 select count(*) into v_table_count from jsonb_array_elements(p_zones) z cross join lateral jsonb_array_elements(coalesce(z.value->'tables','[]'::jsonb)) t;
 if v_zone_count>100 or v_table_count>500 then raise exception 'Floor configuration exceeds the supported limit.'; end if;
 for v_zone in select value from jsonb_array_elements(p_zones) loop
  v_zone_key:=nullif(trim(v_zone->>'id'),'');
  if v_zone_key is null or nullif(trim(v_zone->>'name'),'') is null or length(trim(v_zone->>'name'))>80 then raise exception 'Each zone requires a stable ID and a name of 1–80 characters.'; end if;
  if jsonb_typeof(coalesce(v_zone->'tables','[]'::jsonb))<>'array' then raise exception 'Zone tables must be a list.'; end if;
  for v_table in select value from jsonb_array_elements(coalesce(v_zone->'tables','[]'::jsonb)) loop
   v_table_key:=nullif(trim(v_table->>'id'),'');
   if v_table_key is null or coalesce((v_table->>'number')::integer,0)<1 or coalesce((v_table->>'seats')::integer,4) not between 1 and 50
    or coalesce((v_table->>'x')::integer,16) not between 0 and 10000 or coalesce((v_table->>'y')::integer,16) not between 0 and 10000
    or coalesce((v_table->>'w')::integer,86) not between 48 and 600 or coalesce((v_table->>'h')::integer,64) not between 48 and 600 then
    raise exception 'Each table requires a stable ID, positive number, valid seats and valid layout coordinates.';
   end if;
   v_waiter_id:=nullif(v_table->>'assignedWaiterId','')::uuid;
   if v_waiter_id is not null and not exists(select 1 from public.staff s where s.id=v_waiter_id and s.property_id=p_property_id and s.is_active=true and s.role='waiter') then
    raise exception 'Assigned waiter must be an active waiter from this property.';
   end if;
  end loop;
 end loop;
 if exists(select 1 from public.pos_table_sessions s where s.property_id=p_property_id and s.status<>'closed' and not exists(
  select 1 from jsonb_array_elements(p_zones) z cross join lateral jsonb_array_elements(coalesce(z.value->'tables','[]'::jsonb)) t where t.value->>'id'=s.table_key
 )) then raise exception 'Close or move active table sessions before removing their tables.'; end if;
 delete from public.pos_floor_zones where property_id=p_property_id;
 for v_zone in select value from jsonb_array_elements(p_zones) with ordinality q(value,ord) order by q.ord loop
  v_zone_key:=trim(v_zone->>'id');
  insert into public.pos_floor_zones(property_id,zone_key,name,sort_order,updated_at)
  values(p_property_id,v_zone_key,trim(v_zone->>'name'),(select q.ord::integer from jsonb_array_elements(p_zones) with ordinality q(value,ord) where q.value->>'id'=v_zone_key limit 1),now());
  for v_table in select value from jsonb_array_elements(coalesce(v_zone->'tables','[]'::jsonb)) loop
   v_table_key:=trim(v_table->>'id'); v_waiter_id:=nullif(v_table->>'assignedWaiterId','')::uuid;
   insert into public.pos_floor_tables(property_id,zone_key,table_key,table_number,seats,x,y,width,height,assigned_waiter_id,updated_at)
   values(p_property_id,v_zone_key,v_table_key,(v_table->>'number')::integer,coalesce((v_table->>'seats')::integer,4),coalesce((v_table->>'x')::integer,16),
    coalesce((v_table->>'y')::integer,16),coalesce((v_table->>'w')::integer,86),coalesce((v_table->>'h')::integer,64),v_waiter_id,now());
  end loop;
 end loop;
 return public.fn_list_pos_floor_configuration(p_property_id);
end; $$;
revoke all on function public.fn_save_pos_floor_configuration(uuid,jsonb) from public;
grant execute on function public.fn_save_pos_floor_configuration(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
