-- Disposable PostgreSQL baseline for Phase 2 folio ledger tests only.
create extension if not exists pgcrypto;
create role anon;
create role authenticated;
create role service_role;
create schema if not exists auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('00000000-0000-0000-0000-000000000001') on conflict do nothing;
create or replace function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;

create table public.properties(id uuid primary key);
create table public.rooms(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),number text,room_type_id uuid);
create table public.reservations(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),room_id uuid not null references public.rooms(id),
 guest_name text not null,arrival date not null,departure date not null,status text not null default 'checked-in',
 channel text default 'direct',meal_plan text default 'bed_only',rate numeric(12,2) default 0,total_amount numeric(12,2) default 0,
 amount_paid numeric(12,2) default 0,payment_status text default 'not_paid'
);
create table public.folio_charges(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),
 reservation_id uuid not null references public.reservations(id),source text not null default 'room' check(source in ('room','pos','other')),
 description text not null,amount numeric(12,2) not null,created_at timestamptz not null default now()
);
create table public.cashier_shifts(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),
 opened_by uuid not null references auth.users(id),opened_at timestamptz not null default now(),status text not null default 'open'
);
create table public.payments(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),
 reservation_id uuid not null references public.reservations(id),amount numeric(12,2) not null,method text not null,
 status text not null default 'posted' check(status in ('posted','voided')),shift_id uuid references public.cashier_shifts(id),
 created_at timestamptz not null default now(),voided_at timestamptz,voided_by uuid,void_reason text
);
create table public.cashier_adjustments(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),
 shift_id uuid references public.cashier_shifts(id),adjustment_type text not null check(adjustment_type in ('refund','void')),
 target_type text not null check(target_type in ('pos_receipt','payment')),target_id uuid not null,
 amount numeric(12,2) not null,reason text not null,created_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id),status text not null default 'pending',created_at timestamptz not null default now(),
 refund_method text
);
create table public.cashier_refunds(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id),
 adjustment_id uuid not null unique references public.cashier_adjustments(id),target_type text not null check(target_type in ('pos_receipt','payment')),
 target_id uuid not null,receipt_id uuid,original_payment_id uuid references public.payments(id),amount numeric(12,2) not null,
 method text not null,reservation_id uuid references public.reservations(id),folio_charge_id uuid references public.folio_charges(id),
 refund_payment_id uuid references public.payments(id),approved_by uuid references auth.users(id),created_at timestamptz not null default now(),
 settlement_method text
);
create table public.audit_logs(
 id uuid primary key default gen_random_uuid(),actor_id uuid,property_id uuid,action text,old_value jsonb,new_value jsonb,
 entity_type text,entity_id uuid,related_reservation_id uuid,created_at timestamptz default now()
);
create or replace function public.is_member_of_property(p_property_id uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.member',true),'true')::boolean $$;
create or replace function public.is_platform_owner() returns boolean language sql stable as $$ select false $$;
create or replace function public.property_role(p_property_id uuid) returns text language sql stable as $$ select nullif(current_setting('test.property_role',true),'') $$;
create or replace function public.current_staff_role(p_property_id uuid) returns text language sql stable as $$ select nullif(current_setting('test.staff_role',true),'') $$;

insert into public.properties(id) values('10000000-0000-0000-0000-000000000001');
insert into public.rooms(id,property_id,number) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','101'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','102');
insert into public.reservations(id,property_id,room_id,guest_name,arrival,departure,status,rate,total_amount)
values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Test Guest One','2026-11-04','2026-11-06','checked-in',500,1000),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Test Guest Two','2026-11-04','2026-11-06','checked-in',500,1000);
insert into public.cashier_shifts(id,property_id,opened_by) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
set test.staff_role='hotel_admin';
