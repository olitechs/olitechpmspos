-- OliTechs PMS/POS — Back Office: Kitchen printers / Printer groups (additive)
create table if not exists public.printer_groups (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  production_center text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists printer_groups_property_name_uidx
  on public.printer_groups(property_id, lower(btrim(name)));

create table if not exists public.printer_group_categories (
  printer_group_id uuid not null references public.printer_groups(id) on delete cascade,
  category_id uuid not null references public.pos_menu_categories(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (printer_group_id, category_id)
);
create index if not exists printer_group_categories_lookup_idx
  on public.printer_group_categories(property_id, category_id);

create or replace function public.fn_printer_group_categories_guard()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.printer_groups g where g.id = new.printer_group_id and g.property_id = new.property_id) then
    raise exception 'printer group does not belong to this property';
  end if;
  if not exists (select 1 from public.pos_menu_categories c where c.id = new.category_id and c.property_id = new.property_id) then
    raise exception 'category does not belong to this property';
  end if;
  return new;
end $$;

drop trigger if exists printer_group_categories_guard on public.printer_group_categories;
create trigger printer_group_categories_guard before insert or update on public.printer_group_categories
for each row execute function public.fn_printer_group_categories_guard();

create or replace function public.fn_printer_groups_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists printer_groups_touch on public.printer_groups;
create trigger printer_groups_touch before update on public.printer_groups
for each row execute function public.fn_printer_groups_touch();

create or replace function public.can_manage_printer_groups(p_property_id uuid)
returns boolean language sql security definer stable set search_path = public
as $$
  select public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager');
$$;

alter table public.printer_groups enable row level security;
alter table public.printer_group_categories enable row level security;

drop policy if exists printer_groups_select on public.printer_groups;
drop policy if exists printer_groups_insert on public.printer_groups;
drop policy if exists printer_groups_update on public.printer_groups;
drop policy if exists printer_groups_delete on public.printer_groups;
create policy printer_groups_select on public.printer_groups for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
create policy printer_groups_insert on public.printer_groups for insert
  with check (public.can_manage_printer_groups(property_id));
create policy printer_groups_update on public.printer_groups for update
  using (public.can_manage_printer_groups(property_id))
  with check (public.can_manage_printer_groups(property_id));
create policy printer_groups_delete on public.printer_groups for delete
  using (public.can_manage_printer_groups(property_id));

drop policy if exists printer_group_categories_select on public.printer_group_categories;
drop policy if exists printer_group_categories_insert on public.printer_group_categories;
drop policy if exists printer_group_categories_update on public.printer_group_categories;
drop policy if exists printer_group_categories_delete on public.printer_group_categories;
create policy printer_group_categories_select on public.printer_group_categories for select
  using (public.is_platform_owner() or public.is_member_of_property(property_id));
create policy printer_group_categories_insert on public.printer_group_categories for insert
  with check (public.can_manage_printer_groups(property_id));
create policy printer_group_categories_update on public.printer_group_categories for update
  using (public.can_manage_printer_groups(property_id))
  with check (public.can_manage_printer_groups(property_id));
create policy printer_group_categories_delete on public.printer_group_categories for delete
  using (public.can_manage_printer_groups(property_id));

create or replace function public.fn_save_printer_group(
  p_property_id uuid, p_id uuid default null, p_name text default null,
  p_production_center text default null, p_category_ids uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.can_manage_printer_groups(p_property_id) then
    raise exception 'not allowed to manage printer groups' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'printer group name is required'; end if;
  if p_id is null then
    insert into public.printer_groups(property_id, name, production_center)
    values (p_property_id, v_name, nullif(btrim(coalesce(p_production_center, '')), ''))
    returning id into v_id;
  else
    update public.printer_groups set name=v_name,
      production_center=nullif(btrim(coalesce(p_production_center, '')), '')
      where id=p_id and property_id=p_property_id returning id into v_id;
    if v_id is null then raise exception 'printer group not found'; end if;
  end if;
  delete from public.printer_group_categories where printer_group_id=v_id;
  insert into public.printer_group_categories(printer_group_id, category_id, property_id)
  select v_id, c.id, p_property_id from public.pos_menu_categories c
  where c.property_id=p_property_id and c.id=any(coalesce(p_category_ids, '{}'));
  return v_id;
end $$;

create or replace function public.fn_delete_printer_groups(p_property_id uuid, p_ids uuid[])
returns integer language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.can_manage_printer_groups(p_property_id) then
    raise exception 'not allowed to manage printer groups' using errcode = '42501';
  end if;
  delete from public.printer_groups
  where property_id=p_property_id and id=any(coalesce(p_ids, '{}'));
  get diagnostics v_count=row_count;
  return v_count;
end $$;

revoke all on function public.fn_save_printer_group(uuid,uuid,text,text,uuid[]) from public;
revoke all on function public.fn_delete_printer_groups(uuid,uuid[]) from public;
grant execute on function public.fn_save_printer_group(uuid,uuid,text,text,uuid[]) to authenticated;
grant execute on function public.fn_delete_printer_groups(uuid,uuid[]) to authenticated;
