-- Phase 7: operational back-office configuration and guest loyalty data.

create table if not exists public.property_payment_types (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 code text not null,
 name text not null,
 active boolean not null default true,
 sort_order integer not null default 0,
 requires_reference boolean not null default false,
 created_at timestamptz not null default now(),
 unique(property_id,code)
);
create table if not exists public.property_taxes (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 name text not null,
 rate numeric(8,4) not null default 0,
 inclusive boolean not null default false,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.property_dining_options (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 code text not null,
 name text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(property_id,code)
);
create table if not exists public.guest_loyalty_accounts (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 guest_id uuid not null references public.guests(id) on delete cascade,
 points_balance integer not null default 0,
 tier text not null default 'standard',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(property_id,guest_id)
);
create table if not exists public.guest_loyalty_transactions (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 guest_id uuid not null references public.guests(id) on delete cascade,
 points integer not null,
 transaction_type text not null,
 reference text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);

alter table public.property_payment_types enable row level security;
alter table public.property_taxes enable row level security;
alter table public.property_dining_options enable row level security;
alter table public.guest_loyalty_accounts enable row level security;
alter table public.guest_loyalty_transactions enable row level security;

drop policy if exists property_payment_types_member on public.property_payment_types;
create policy property_payment_types_member on public.property_payment_types for all to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_taxes_member on public.property_taxes;
create policy property_taxes_member on public.property_taxes for all to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists property_dining_options_member on public.property_dining_options;
create policy property_dining_options_member on public.property_dining_options for all to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists guest_loyalty_accounts_member on public.guest_loyalty_accounts;
create policy guest_loyalty_accounts_member on public.guest_loyalty_accounts for all to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists guest_loyalty_transactions_member on public.guest_loyalty_transactions;
create policy guest_loyalty_transactions_member on public.guest_loyalty_transactions for select to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.fn_adjust_guest_loyalty_points(p_property_id uuid,p_guest_id uuid,p_points integer,p_type text,p_reference text default null)
returns public.guest_loyalty_accounts
language plpgsql security definer set search_path=public as $$
declare v public.guest_loyalty_accounts;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not authorized'; end if;
 if p_points=0 then raise exception 'Points change cannot be zero'; end if;
 if not exists(select 1 from public.guests where id=p_guest_id and property_id=p_property_id) then raise exception 'Guest does not belong to this property'; end if;
 insert into public.guest_loyalty_accounts(property_id,guest_id,points_balance)
 values(p_property_id,p_guest_id,p_points)
 on conflict(property_id,guest_id) do update set points_balance=public.guest_loyalty_accounts.points_balance+excluded.points_balance,updated_at=now()
 returning * into v;
 insert into public.guest_loyalty_transactions(property_id,guest_id,points,transaction_type,reference,created_by)
 values(p_property_id,p_guest_id,p_points,coalesce(nullif(trim(p_type),''),'manual_adjustment'),p_reference,auth.uid());
 update public.guest_loyalty_accounts set tier=case when points_balance>=10000 then 'platinum' when points_balance>=5000 then 'gold' when points_balance>=1000 then 'silver' else 'standard' end,updated_at=now() where id=v.id returning * into v;
 return v;
end $$;
revoke all on function public.fn_adjust_guest_loyalty_points(uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.fn_adjust_guest_loyalty_points(uuid,uuid,integer,text,text) to authenticated;

grant select,insert,update,delete on public.property_payment_types,public.property_taxes,public.property_dining_options to authenticated;
grant select on public.guest_loyalty_accounts,public.guest_loyalty_transactions to authenticated;
