-- Minimal PostgreSQL fixture for the POS table-join and void RPC integration test.
create role anon nologin;
create role authenticated nologin;

create schema auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function public.is_platform_owner()
returns boolean language sql stable as $$ select false $$;
create or replace function public.property_role(p_property_id uuid)
returns text language sql stable as $ select 'cashier'::text $;
create or replace function public.is_member_of_property(p_property_id uuid)
returns boolean language sql stable as $ select true $;
create or replace function public.current_staff_role(p_property_id uuid)
returns text language sql stable as $$ select null::text $$;

create table public.pos_table_sessions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  table_key text not null,
  table_number text not null,
  zone_id text,
  status text not null default 'occupied' check (status in ('occupied','unsettled','closed')),
  guests integer not null default 1 check (guests > 0),
  waiter text,
  order_number text,
  order_lines jsonb not null default '[]'::jsonb,
  opened_by uuid,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  kot_sent_at timestamptz,
  vat_snapshot jsonb,
  kot_sent_order_lines jsonb not null default '[]'::jsonb
);
create unique index pos_table_sessions_active_idx
  on public.pos_table_sessions(property_id, table_key)
  where status <> 'closed';

create table public.pos_void_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  table_key text,
  table_number text not null,
  order_number text,
  check_no text,
  waiter text,
  item_name text not null,
  category text not null,
  removed_qty numeric not null,
  original_qty numeric not null default 0,
  new_qty numeric not null default 0,
  reason text not null,
  removed_by uuid,
  removed_by_name text,
  status text not null default 'pending',
  printer_id uuid,
  print_log_id uuid,
  void_number text not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid,
  manager_signature text
);

create table public.pos_order_audit (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  table_key text,
  table_number text,
  order_number text,
  item_name text,
  action text not null,
  details jsonb not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);


-- The race-fence migration wraps this RPC; this minimal implementation
-- provides the same return contract for the isolated integration fixture.
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
as $$
declare
  v_row public.pos_table_sessions;
begin
  if p_status = 'closed' then
    update public.pos_table_sessions
      set status='closed', closed_at=now(), updated_at=now(),
          order_lines=coalesce(p_order_lines,order_lines)
    where property_id=p_property_id and table_key=p_table_key and status <> 'closed'
    returning * into v_row;
  else
    insert into public.pos_table_sessions(
      property_id,table_key,table_number,zone_id,status,guests,waiter,
      order_number,order_lines,opened_by,updated_at,closed_at
    ) values (
      p_property_id,p_table_key,p_table_number,p_zone_id,p_status,
      greatest(coalesce(p_guests,1),1),p_waiter,p_order_number,
      coalesce(p_order_lines,'[]'::jsonb),auth.uid(),now(),null
    )
    on conflict (property_id,table_key) where status <> 'closed'
    do update set
      table_number=excluded.table_number,
      zone_id=excluded.zone_id,
      status=excluded.status,
      guests=excluded.guests,
      waiter=coalesce(excluded.waiter,public.pos_table_sessions.waiter),
      order_number=coalesce(excluded.order_number,public.pos_table_sessions.order_number),
      order_lines=excluded.order_lines,
      updated_at=now(),
      closed_at=null
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
