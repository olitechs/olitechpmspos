-- Phase 4 GRN / receiving hardening.
-- Live schema was applied through Supabase MCP before this migration parity file was committed.

create table if not exists public.goods_receipts(
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
 grn_no text not null,
 received_at timestamptz not null default now(),
 received_by uuid references public.profiles(id) on delete set null,
 notes text
);
create unique index if not exists goods_receipts_po_grn_idx on public.goods_receipts(purchase_order_id,grn_no);
create table if not exists public.goods_receipt_lines(
 id uuid primary key default gen_random_uuid(),
 goods_receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 qty numeric(14,3) not null check(qty>0),
 unit_cost numeric(14,4) not null default 0
);
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
drop policy if exists goods_receipts_select on public.goods_receipts;
create policy goods_receipts_select on public.goods_receipts for select to authenticated using(is_platform_owner() or is_member_of_property(property_id));
drop policy if exists goods_receipt_lines_select on public.goods_receipt_lines;
create policy goods_receipt_lines_select on public.goods_receipt_lines for select to authenticated using(exists(select 1 from public.goods_receipts g where g.id=goods_receipt_id and (is_platform_owner() or is_member_of_property(g.property_id))));
revoke all on public.goods_receipts,public.goods_receipt_lines from anon,authenticated;
grant select on public.goods_receipts,public.goods_receipt_lines to authenticated;

-- fn_receive_purchase_order now creates an auditable GRN, prevents over-receiving,
-- supports partial receipt status, and routes stock changes through fn_apply_stock_movement.
