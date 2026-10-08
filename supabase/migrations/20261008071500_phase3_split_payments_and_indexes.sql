-- Phase 3 atomic split payments and POS query indexes
alter table public.pos_receipts add column if not exists idempotency_key text;
alter table public.pos_receipts add column if not exists pos_shift_id uuid references public.pos_shifts(id) on delete set null;
create unique index if not exists pos_receipts_property_idempotency_key_uidx on public.pos_receipts(property_id,idempotency_key) where idempotency_key is not null;
create index if not exists pos_receipts_pos_shift_id_idx on public.pos_receipts(pos_shift_id);
create index if not exists pos_receipts_discount_id_idx on public.pos_receipts(discount_id);
create index if not exists pos_menu_modifier_groups_modifier_group_idx on public.pos_menu_modifier_groups(modifier_group_id);
create index if not exists pos_modifier_options_modifier_group_idx2 on public.pos_modifier_options(modifier_group_id);

create table if not exists public.pos_receipt_payments(
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.pos_receipts(id) on delete cascade,
 property_id uuid not null, payment_method text not null, amount numeric(12,2) not null check(amount>0),
 reservation_id uuid references public.reservations(id) on delete set null, folio_charge_id uuid references public.folio_charges(id) on delete set null,
 created_by uuid, created_at timestamptz not null default now()
);
create index if not exists pos_receipt_payments_receipt_idx on public.pos_receipt_payments(receipt_id);
create index if not exists pos_receipt_payments_property_idx on public.pos_receipt_payments(property_id);
alter table public.pos_receipt_payments enable row level security;
drop policy if exists "pos receipt payments property access" on public.pos_receipt_payments;
create policy "pos receipt payments property access" on public.pos_receipt_payments for select to authenticated using (public.is_platform_owner() or public.is_member_of_property(property_id));
grant select on public.pos_receipt_payments to authenticated;

-- Function definitions are deployed by the live migrations 20261008041101 and 202610080* phase3_atomic_split_sale.