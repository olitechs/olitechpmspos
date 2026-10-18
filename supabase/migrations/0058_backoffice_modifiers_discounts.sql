-- OliTechs PMS/POS — Back Office Phase 2: modifiers and discounts
-- Additive only. Existing POS checkout and receipt behavior is unchanged.
create table if not exists public.pos_modifier_groups (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 80),
 selection_type text not null default 'single' check (selection_type in ('single','multiple')),
 required boolean not null default false, min_selections integer not null default 0 check (min_selections >= 0),
 max_selections integer not null default 1 check (max_selections >= 1), active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(property_id,name), check(min_selections <= max_selections)
);
create index if not exists pos_modifier_groups_property_idx on public.pos_modifier_groups(property_id,active,sort_order,name);
create table if not exists public.pos_modifier_options (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 modifier_group_id uuid not null references public.pos_modifier_groups(id) on delete cascade, name text not null check(char_length(btrim(name)) between 1 and 80),
 price_delta_minor bigint not null default 0, active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists pos_modifier_options_group_idx on public.pos_modifier_options(property_id,modifier_group_id,active,sort_order,name);
create table if not exists public.pos_menu_modifier_groups (
 property_id uuid not null references public.properties(id) on delete cascade, menu_item_id uuid not null references public.products(id) on delete cascade,
 modifier_group_id uuid not null references public.pos_modifier_groups(id) on delete cascade, sort_order integer not null default 0, created_at timestamptz not null default now(),
 primary key(menu_item_id,modifier_group_id)
);
create index if not exists pos_menu_modifier_groups_property_idx on public.pos_menu_modifier_groups(property_id,menu_item_id,sort_order);
create table if not exists public.pos_discounts (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 name text not null check(char_length(btrim(name)) between 1 and 80), code text,
 discount_type text not null check(discount_type in ('percentage','fixed')),
 percentage_basis_points integer check(percentage_basis_points between 0 and 10000), amount_minor bigint check(amount_minor >= 0),
 scope text not null default 'order' check(scope in ('order','item')), active boolean not null default true,
 starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(property_id,name),
 check((discount_type='percentage' and percentage_basis_points is not null and amount_minor is null) or (discount_type='fixed' and amount_minor is not null and percentage_basis_points is null)),
 check(ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists pos_discounts_property_code_uidx on public.pos_discounts(property_id,lower(btrim(code))) where code is not null and btrim(code) <> '';
create index if not exists pos_discounts_property_active_idx on public.pos_discounts(property_id,active,name);
create or replace function public.fn_phase2_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists pos_modifier_groups_touch on public.pos_modifier_groups;
create trigger pos_modifier_groups_touch before update on public.pos_modifier_groups for each row execute function public.fn_phase2_touch_updated_at();
drop trigger if exists pos_modifier_options_touch on public.pos_modifier_options;
create trigger pos_modifier_options_touch before update on public.pos_modifier_options for each row execute function public.fn_phase2_touch_updated_at();
drop trigger if exists pos_discounts_touch on public.pos_discounts;
create trigger pos_discounts_touch before update on public.pos_discounts for each row execute function public.fn_phase2_touch_updated_at();
create or replace function public.fn_phase2_property_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_table_name='pos_modifier_options' and not exists(select 1 from public.pos_modifier_groups g where g.id=new.modifier_group_id and g.property_id=new.property_id) then raise exception 'modifier group does not belong to this property'; end if;
 if tg_table_name='pos_menu_modifier_groups' and (not exists(select 1 from public.products p where p.id=new.menu_item_id and p.property_id=new.property_id) or not exists(select 1 from public.pos_modifier_groups g where g.id=new.modifier_group_id and g.property_id=new.property_id)) then raise exception 'modifier mapping does not belong to this property'; end if;
 return new; end $$;
drop trigger if exists pos_modifier_options_guard on public.pos_modifier_options;
create trigger pos_modifier_options_guard before insert or update on public.pos_modifier_options for each row execute function public.fn_phase2_property_guard();
drop trigger if exists pos_menu_modifier_groups_guard on public.pos_menu_modifier_groups;
create trigger pos_menu_modifier_groups_guard before insert or update on public.pos_menu_modifier_groups for each row execute function public.fn_phase2_property_guard();
create or replace function public.can_manage_phase2_catalogue(p_property_id uuid) returns boolean language sql security definer stable set search_path=public as $$
 select public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','owner','admin','manager','fb_manager','property_manager','general_manager','cashier'); $$;
alter table public.pos_modifier_groups enable row level security;
alter table public.pos_modifier_options enable row level security;
alter table public.pos_menu_modifier_groups enable row level security;
alter table public.pos_discounts enable row level security;
create policy pos_modifier_groups_select on public.pos_modifier_groups for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy pos_modifier_groups_write on public.pos_modifier_groups for all using(public.can_manage_phase2_catalogue(property_id)) with check(public.can_manage_phase2_catalogue(property_id));
create policy pos_modifier_options_select on public.pos_modifier_options for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy pos_modifier_options_write on public.pos_modifier_options for all using(public.can_manage_phase2_catalogue(property_id)) with check(public.can_manage_phase2_catalogue(property_id));
create policy pos_menu_modifier_groups_select on public.pos_menu_modifier_groups for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy pos_menu_modifier_groups_write on public.pos_menu_modifier_groups for all using(public.can_manage_phase2_catalogue(property_id)) with check(public.can_manage_phase2_catalogue(property_id));
create policy pos_discounts_select on public.pos_discounts for select using(public.is_platform_owner() or public.is_member_of_property(property_id));
create policy pos_discounts_write on public.pos_discounts for all using(public.can_manage_phase2_catalogue(property_id)) with check(public.can_manage_phase2_catalogue(property_id));
grant execute on function public.can_manage_phase2_catalogue(uuid) to authenticated;