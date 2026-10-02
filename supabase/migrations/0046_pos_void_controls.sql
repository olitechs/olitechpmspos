-- OliTechs PMS/POS — controlled item voids and cancellation slips
-- Adds atomic POS item removal, void audit trail, printer routing and a property toggle.

alter table public.property_settings
  add column if not exists print_void_slips boolean not null default true;

alter table public.printer_assignments
  drop constraint if exists printer_assignments_assignment_type_check;

alter table public.printer_assignments
  add constraint printer_assignments_assignment_type_check
  check (assignment_type in (
    'food_orders','drinks_orders','void_food_orders','void_drinks_orders',
    'unsettled_bills','final_receipts','reports'
  ));

create table if not exists public.pos_void_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  table_key text,
  table_number text not null,
  order_number text,
  check_no text,
  waiter text,
  item_name text not null,
  category text not null check (category in ('food','drinks')),
  removed_qty numeric(12,2) not null check (removed_qty > 0),
  original_qty numeric(12,2) not null default 0,
  new_qty numeric(12,2) not null default 0,
  reason text not null,
  removed_by uuid references auth.users(id) on delete set null,
  removed_by_name text,
  status text not null default 'printed' check (status in ('pending','printed','approved','failed')),
  printer_id uuid references public.property_printers(id) on delete set null,
  print_log_id uuid references public.print_logs(id) on delete set null,
  void_number text not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  manager_signature text
);

create unique index if not exists pos_void_items_number_idx
  on public.pos_void_items(property_id, void_number);
create index if not exists pos_void_items_property_date_idx
  on public.pos_void_items(property_id, created_at desc);

create table if not exists public.pos_order_audit (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  table_key text,
  table_number text,
  order_number text,
  item_name text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_order_audit_property_date_idx
  on public.pos_order_audit(property_id, created_at desc);

alter table public.pos_void_items enable row level security;
alter table public.pos_order_audit enable row level security;

drop policy if exists pos_void_items_select on public.pos_void_items;
create policy pos_void_items_select on public.pos_void_items for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_void_items_write on public.pos_void_items;
create policy pos_void_items_write on public.pos_void_items for all
using (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin','manager','cashier')
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager')
)
with check (
  public.is_platform_owner()
  or public.property_role(property_id) in ('owner','admin','manager','cashier')
  or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager')
);

drop policy if exists pos_order_audit_select on public.pos_order_audit;
create policy pos_order_audit_select on public.pos_order_audit for select
using (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_order_audit_insert on public.pos_order_audit;
create policy pos_order_audit_insert on public.pos_order_audit for insert
with check (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_remove_pos_item(
  p_property_id uuid,
  p_table_key text,
  p_item_id text,
  p_remove_qty numeric,
  p_reason text,
  p_removed_by_name text default null
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_session public.pos_table_sessions;
  v_lines jsonb;
  v_item jsonb;
  v_new_lines jsonb := '[]'::jsonb;
  v_original numeric;
  v_removed numeric;
  v_new numeric;
  v_category text;
  v_void public.pos_void_items;
  v_void_number text;
  v_idx integer := 0;
begin
  if not (public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager')) then
    raise exception 'Not allowed.';
  end if;

  if coalesce(trim(p_reason),'') = '' then raise exception 'A removal reason is required.'; end if;
  if coalesce(p_remove_qty,0) <= 0 then raise exception 'Removal quantity must be greater than zero.'; end if;

  select * into v_session
  from public.pos_table_sessions
  where property_id=p_property_id and table_key=p_table_key and status <> 'closed'
  for update;

  if v_session.id is null then raise exception 'Active table session not found.'; end if;

  v_lines := coalesce(v_session.order_lines,'[]'::jsonb);

  for v_item in select value from jsonb_array_elements(v_lines)
  loop
    if (v_item->>'id') = p_item_id then
      v_original := greatest(coalesce((v_item->>'qty')::numeric,0),0);
      v_removed := least(v_original, p_remove_qty);
      v_new := greatest(v_original-v_removed,0);
      v_category := case
        when lower(coalesce(v_item->>'category','')) in ('drinks','drink','bibite')
          or lower(coalesce(v_item->>'center',''))='bar' then 'drinks'
        else 'food'
      end;
      if v_removed <= 0 then raise exception 'Item quantity is already zero.'; end if;
      if v_new > 0 then
        v_new_lines := v_new_lines || jsonb_build_array(jsonb_set(v_item,'{qty}',to_jsonb(v_new)));
      end if;
    else
      v_new_lines := v_new_lines || jsonb_build_array(v_item);
    end if;
  end loop;

  if v_original is null then raise exception 'Item not found on this table.'; end if;

  update public.pos_table_sessions
    set order_lines=v_new_lines, updated_at=now()
  where id=v_session.id;

  select 'V-' || lpad((coalesce(max(nullif(regexp_replace(void_number,'[^0-9]','','g'),''),'0')::bigint)+1)::text,6,'0')
    into v_void_number
  from public.pos_void_items
  where property_id=p_property_id;

  insert into public.pos_void_items(
    property_id,table_key,table_number,order_number,check_no,waiter,item_name,category,
    removed_qty,original_qty,new_qty,reason,removed_by,removed_by_name,status,void_number
  ) values (
    p_property_id,v_session.table_key,v_session.table_number,v_session.order_number,v_session.order_number,
    v_session.waiter,v_item->>'name',v_category,v_removed,v_original,v_new,p_reason,auth.uid(),
    coalesce(nullif(trim(p_removed_by_name),''),v_session.waiter),'pending',v_void_number
  ) returning * into v_void;

  insert into public.pos_order_audit(
    property_id,table_key,table_number,order_number,item_name,action,details,actor_id
  ) values (
    p_property_id,v_session.table_key,v_session.table_number,v_session.order_number,v_item->>'name',
    'ITEM_REMOVED',
    jsonb_build_object(
      'void_id',v_void.id,'void_number',v_void.void_number,'category',v_category,
      'removed_qty',v_removed,'original_qty',v_original,'new_qty',v_new,'reason',p_reason,
      'printer_id',null
    ),auth.uid()
  );

  return jsonb_build_object(
    'void',row_to_json(v_void),
    'session',row_to_json(v_session),
    'order_lines',v_new_lines
  );
end;
$$;

grant execute on function public.fn_remove_pos_item(uuid,text,text,numeric,text,text) to authenticated;

notify pgrst, 'reload schema';
