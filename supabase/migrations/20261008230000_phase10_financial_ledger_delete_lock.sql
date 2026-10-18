-- Phase 10: immutable financial and inventory ledgers
-- Corrections must use the existing void/refund/adjustment workflows.
drop policy if exists payments_delete on public.payments;
drop policy if exists pos_receipts_delete on public.pos_receipts;
drop policy if exists inventory_movements_delete on public.inventory_movements;
drop policy if exists stock_movements_delete on public.stock_movements;
