-- OliTechs PMS/POS — shift management, closing reports and sales exports
create table if not exists public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  shift_no text not null unique,
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  status text not null default 'open' check (status in ('open','closed')),
  date date not null default (now() at time zone 'Africa/Nairobi')::date,
  notes text
);
create table if not exists public.pos_shift_payments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.pos_shifts(id) on delete cascade,
  payment_method text not null check (payment_method in ('cash','mpesa','card','bank','room_charge','other')),
  amount numeric(12,2) not null default 0,
  transaction_count integer not null default 0
);
alter table public.pos_receipts add column if not exists shift_id uuid references public.pos_shifts(id) on delete set null;
create index if not exists pos_shifts_property_date_idx on public.pos_shifts(property_id,date,opened_at desc);
create index if not exists pos_receipts_pos_shift_idx on public.pos_receipts(shift_id,created_at desc);
alter table public.pos_shifts enable row level security;
alter table public.pos_shift_payments enable row level security;
drop policy if exists pos_shifts_select on public.pos_shifts;
create policy pos_shifts_select on public.pos_shifts for select using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists pos_shifts_insert on public.pos_shifts;
create policy pos_shifts_insert on public.pos_shifts for insert with check (public.is_platform_owner() or public.property_role(property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager'));
drop policy if exists pos_shifts_update on public.pos_shifts;
create policy pos_shifts_update on public.pos_shifts for update using (public.is_platform_owner() or public.property_role(property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) with check (public.is_platform_owner() or public.property_role(property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(property_id) in ('hotel_admin','super_admin','cashier','fb_manager'));
drop policy if exists pos_shift_payments_select on public.pos_shift_payments;
create policy pos_shift_payments_select on public.pos_shift_payments for select using (exists(select 1 from public.pos_shifts s where s.id=shift_id and (public.is_platform_owner() or public.is_member_of_property(s.property_id))));
drop policy if exists pos_shift_payments_write on public.pos_shift_payments;
create policy pos_shift_payments_write on public.pos_shift_payments for all using (exists(select 1 from public.pos_shifts s where s.id=shift_id and (public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','cashier','fb_manager')))) with check (exists(select 1 from public.pos_shifts s where s.id=shift_id and (public.is_platform_owner() or public.property_role(s.property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(s.property_id) in ('hotel_admin','super_admin','cashier','fb_manager'))));

create or replace function public.fn_open_pos_shift(p_property_id uuid,p_opening_cash numeric default 0,p_notes text default null)
returns public.pos_shifts language plpgsql security definer set search_path=public as $$
declare v_shift public.pos_shifts; v_date date := (now() at time zone 'Africa/Nairobi')::date; v_seq integer;
begin
 if p_opening_cash < 0 then raise exception 'Opening cash cannot be negative.'; end if;
 if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then raise exception 'Cashier or manager access required.'; end if;
 if exists(select 1 from public.pos_shifts where property_id=p_property_id and date=v_date and status='open') then raise exception 'An open shift already exists for today.'; end if;
 select count(*)+1 into v_seq from public.pos_shifts where property_id=p_property_id and date=v_date;
 insert into public.pos_shifts(property_id,shift_no,opened_by,opening_cash,date,notes) values(p_property_id,'SHIFT-'||to_char(v_date,'YYYYMMDD')||'-'||lpad(v_seq::text,3,'0'),auth.uid(),p_opening_cash,v_date,p_notes) returning * into v_shift;
 return v_shift;
end $$;
grant execute on function public.fn_open_pos_shift(uuid,numeric,text) to authenticated;

create or replace function public.fn_current_pos_shift(p_property_id uuid)
returns public.pos_shifts language sql security definer set search_path=public as $$
 select * from public.pos_shifts where property_id=p_property_id and status='open' and date=(now() at time zone 'Africa/Nairobi')::date order by opened_at desc limit 1
$$;
grant execute on function public.fn_current_pos_shift(uuid) to authenticated;

create or replace function public.fn_close_pos_shift(p_shift_id uuid,p_counted_cash numeric,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_shift public.pos_shifts; v_cash numeric:=0; v_mpesa numeric:=0; v_card numeric:=0; v_room numeric:=0; v_bank numeric:=0; v_other numeric:=0; v_total numeric:=0; v_count integer:=0; v_report text; v_rows jsonb;
begin
 select * into v_shift from public.pos_shifts where id=p_shift_id for update;
 if v_shift.id is null then raise exception 'Shift not found.'; end if;
 if not (public.is_platform_owner() or public.property_role(v_shift.property_id) in ('owner','admin','manager','cashier') or public.current_staff_role(v_shift.property_id) in ('hotel_admin','super_admin','cashier','fb_manager')) then raise exception 'Only cashier, manager or admin can close a shift.'; end if;
 if v_shift.status<>'open' then raise exception 'Shift is already closed.'; end if;
 select coalesce(sum(case when payment_method='cash' then total else 0 end),0),coalesce(sum(case when payment_method='mpesa' then total else 0 end),0),coalesce(sum(case when payment_method='card' then total else 0 end),0),coalesce(sum(case when payment_method='room' then total else 0 end),0),coalesce(sum(case when payment_method='bank' then total else 0 end),0),coalesce(sum(total),0),count(*) into v_cash,v_mpesa,v_card,v_room,v_total,v_count from public.pos_receipts where shift_id=p_shift_id and status='posted';
 v_other:=0;
 update public.pos_shifts set closed_by=auth.uid(),closed_at=now(),status='closed',notes=coalesce(p_notes,notes) where id=p_shift_id returning * into v_shift;
 delete from public.pos_shift_payments where shift_id=p_shift_id;
 insert into public.pos_shift_payments(shift_id,payment_method,amount,transaction_count) values
 (p_shift_id,'cash',v_cash,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='cash')),
 (p_shift_id,'mpesa',v_mpesa,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='mpesa')),
 (p_shift_id,'card',v_card,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='card')),
 (p_shift_id,'room_charge',v_room,(select count(*) from public.pos_receipts where shift_id=p_shift_id and status='posted' and payment_method='room')),
 (p_shift_id,'bank',v_bank,0),(p_shift_id,'other',v_other,0);
 return jsonb_build_object('shift',to_jsonb(v_shift),'opening_cash',v_shift.opening_cash,'cash',v_cash,'mpesa',v_mpesa,'card',v_card,'bank',v_bank,'room_charge',v_room,'other',v_other,'total_sales',v_total,'total_transactions',v_count,'expected_cash',v_shift.opening_cash+v_cash,'counted_cash',p_counted_cash,'variance',p_counted_cash-(v_shift.opening_cash+v_cash));
end $$;
grant execute on function public.fn_close_pos_shift(uuid,numeric,text) to authenticated;
notify pgrst,'reload schema';