-- OliTechs Printer Recode + multi-store settings foundation
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  unique(workspace_id,user_id)
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  address text,
  is_default boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  unique(store_id,user_id)
);

do $$ begin
 create type public.printer_connection_type as enum ('network','usb','bluetooth','print_agent');
exception when duplicate_object then null; end $$;
do $$ begin
 create type public.printer_status as enum ('online','offline','error');
exception when duplicate_object then null; end $$;
do $$ begin
 create type public.print_job_status as enum ('pending','printed','failed');
exception when duplicate_object then null; end $$;
do $$ begin
 create type public.print_job_type as enum ('kitchen','receipt');
exception when duplicate_object then null; end $$;

create table if not exists public.printers (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 name text not null,
 connection_type public.printer_connection_type not null default 'network',
 ip_address text,
 port integer default 9100,
 mac_address text,
 agent_id uuid,
 is_kitchen boolean not null default false,
 is_receipt boolean not null default false,
 status public.printer_status not null default 'offline',
 last_seen timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.printer_groups (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 store_id uuid not null references public.stores(id) on delete cascade,
 name text not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(store_id,name)
);

create table if not exists public.printer_group_printers (
 printer_group_id uuid not null references public.printer_groups(id) on delete cascade,
 printer_id uuid not null references public.printers(id) on delete cascade,
 primary key(printer_group_id,printer_id)
);

create table if not exists public.printer_group_categories (
 printer_group_id uuid not null references public.printer_groups(id) on delete cascade,
 category_id uuid not null,
 primary key(printer_group_id,category_id)
);

create table if not exists public.print_agents (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 status text not null default 'offline' check(status in ('online','offline','error')),
 last_seen timestamptz,
 discovered_printers integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

alter table public.printers add constraint printers_agent_fk foreign key(agent_id) references public.print_agents(id) on delete set null;

create table if not exists public.print_jobs (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 printer_id uuid not null references public.printers(id) on delete cascade,
 printer_group_id uuid references public.printer_groups(id) on delete set null,
 order_id uuid,
 content_escpos_base64 text not null,
 status public.print_job_status not null default 'pending',
 type public.print_job_type not null,
 created_at timestamptz not null default now(),
 printed_at timestamptz,
 error_message text
);

create index if not exists printers_store_idx on public.printers(store_id);
create index if not exists printer_groups_store_idx on public.printer_groups(store_id);
create index if not exists print_jobs_pending_idx on public.print_jobs(workspace_id,status);
create index if not exists print_agents_workspace_idx on public.print_agents(workspace_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.stores enable row level security;
alter table public.store_members enable row level security;
alter table public.printers enable row level security;
alter table public.printer_groups enable row level security;
alter table public.printer_group_printers enable row level security;
alter table public.printer_group_categories enable row level security;
alter table public.print_jobs enable row level security;
alter table public.print_agents enable row level security;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
 select exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid());
$$;

create or replace function public.is_store_member(p_store_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
 select exists(select 1 from public.store_members where store_id=p_store_id and user_id=auth.uid())
    or exists(select 1 from public.stores s join public.workspace_members wm on wm.workspace_id=s.workspace_id where s.id=p_store_id and wm.user_id=auth.uid() and wm.role in ('owner','admin'));
$$;

create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean language sql security definer stable set search_path=public as $$
 select public.is_platform_owner() or exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid() and role in ('owner','admin'));
$$;

drop policy if exists workspace_select on public.workspaces;
create policy workspace_select on public.workspaces for select using (public.is_workspace_member(id) or public.is_platform_owner());
drop policy if exists workspace_member_select on public.workspace_members;
create policy workspace_member_select on public.workspace_members for select using (user_id=auth.uid() or public.is_workspace_admin(workspace_id));
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select using (public.is_workspace_member(workspace_id) or public.is_platform_owner());
drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores for all using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));
drop policy if exists store_members_select on public.store_members;
create policy store_members_select on public.store_members for select using (user_id=auth.uid() or exists(select 1 from public.stores s where s.id=store_id and public.is_workspace_admin(s.workspace_id)));
drop policy if exists store_members_write on public.store_members;
create policy store_members_write on public.store_members for all using (exists(select 1 from public.stores s where s.id=store_id and public.is_workspace_admin(s.workspace_id))) with check (exists(select 1 from public.stores s where s.id=store_id and public.is_workspace_admin(s.workspace_id)));

drop policy if exists printers_access on public.printers;
create policy printers_access on public.printers for all using (public.is_workspace_member(workspace_id) and public.is_store_member(store_id)) with check (public.is_workspace_member(workspace_id) and public.is_store_member(store_id));
drop policy if exists printer_groups_access on public.printer_groups;
create policy printer_groups_access on public.printer_groups for all using (public.is_workspace_member(workspace_id) and public.is_store_member(store_id)) with check (public.is_workspace_member(workspace_id) and public.is_store_member(store_id));
drop policy if exists printer_group_printers_access on public.printer_group_printers;
create policy printer_group_printers_access on public.printer_group_printers for all using (exists(select 1 from public.printer_groups g where g.id=printer_group_id and public.is_workspace_member(g.workspace_id) and public.is_store_member(g.store_id))) with check (exists(select 1 from public.printer_groups g where g.id=printer_group_id and public.is_workspace_member(g.workspace_id) and public.is_store_member(g.store_id)));
drop policy if exists printer_group_categories_access on public.printer_group_categories;
create policy printer_group_categories_access on public.printer_group_categories for all using (exists(select 1 from public.printer_groups g where g.id=printer_group_id and public.is_workspace_member(g.workspace_id) and public.is_store_member(g.store_id))) with check (exists(select 1 from public.printer_groups g where g.id=printer_group_id and public.is_workspace_member(g.workspace_id) and public.is_store_member(g.store_id)));
drop policy if exists print_jobs_access on public.print_jobs;
create policy print_jobs_access on public.print_jobs for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists print_agents_access on public.print_agents;
create policy print_agents_access on public.print_agents for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

notify pgrst,'reload schema';
