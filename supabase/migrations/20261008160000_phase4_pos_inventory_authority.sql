-- Phase 4/5 hardening: one authoritative inventory movement path for POS + RLS-safe history view.

-- POS must use the same locked stock transaction as every other inventory mutation.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='fn_record_pos_sale'
    and p.oid::regprocedure::text='fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb)';

  if v_def is null then
    raise exception 'Expected fn_record_pos_sale signature was not found';
  end if;

  v_def := replace(
    v_def,
    'update public.products set current_stock=current_stock-v_qty,updated_at=now() where id=v_product.id;
         insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id) values(p_property_id,v_product.id,''out'',v_qty,''POS Sale ''||coalesce(p_order_number,''''),auth.uid());',
    'perform public.fn_apply_stock_movement(v_product.id,-v_qty,''POS Sale ''||coalesce(p_order_number,''''),''pos_sale'',null);'
  );

  if v_def = pg_get_functiondef(
    'fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb)'::regprocedure
  ) then
    raise exception 'POS stock mutation replacement did not match current function body';
  end if;

  execute v_def;
end $$;

-- The history view is reporting-only and must respect the caller's RLS context.
create or replace view public.inventory_stock_history
with (security_invoker=true)
as
select
  sm.id,
  sm.property_id,
  sm.product_id,
  p.name as product_name,
  p.sku,
  p.category,
  p.unit,
  sm.type,
  sm.qty,
  case
    when sm.type in ('in','opening','transfer_in','return','adjustment_in') then sm.qty
    else -sm.qty
  end as signed_qty,
  sm.reason,
  sm.source_type,
  sm.source_id,
  sm.user_id,
  sm.created_at
from public.stock_movements sm
join public.products p on p.id=sm.product_id;

grant select on public.inventory_stock_history to authenticated;

-- Preserve the existing printer infrastructure while making durable print jobs
-- explicitly property-scoped and authenticated-only.
revoke all on public.fnb_print_jobs from anon, public;
grant select, insert, update on public.fnb_print_jobs to authenticated;
