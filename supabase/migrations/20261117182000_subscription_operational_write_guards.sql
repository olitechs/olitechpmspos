-- OliTechs PMS+POS — subscription-gated operational write guards (Phase 4)
--
-- The entitlement engine (20261117180000) is authoritative for every access
-- decision, and migrations 0018/0019/0023 route their RLS through it. But the
-- remaining operational tables and every SECURITY DEFINER RPC bypass RLS, so
-- an expired property could still mutate rows by calling an endpoint directly.
--
-- This migration installs one generic BEFORE trigger on the core operational
-- tables (all bearing property_id) that raises unless the property's computed
-- entitlement allows operations. Request-time authorization (engine + RLS)
-- stays the non-negotiable backstop if this trigger were ever dropped.
--
-- Exemptions (deliberate, fail-closed elsewhere):
--   * platform owners — full platform-management access (engine rule).
--   * no-user contexts (auth.uid() is null): service-role edge functions,
--     scheduled jobs and internal triggers. A browser request always carries
--     an anon/authenticated JWT, so this cannot be used to bypass; anon calls
--     are already blocked by table grants and RLS, and authenticated RPCs
--     always evaluate with their real JWT.
--
-- Deliberately NOT guarded here:
--   * staff / credentials / PIN / invitation auth tables — suspended owners
--     and staff must still be able to sign in and reach the billing screen.
--   * audit_logs, subscription_events, property_subscriptions, properties —
--     compliance, billing and lifecycle records (managed by platform RPCs).
--   * print/printer infrastructure and the phase-1 employee-licensing tables
--     owned by their own migration streams.

create or replace function public.fn_assert_property_row_operational()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_property_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_property_id := OLD.property_id;
  else
    v_property_id := NEW.property_id;
  end if;

  if v_property_id is null then
    return coalesce(NEW, OLD);
  end if;

  -- No user context = background/system operation (service role, cron, edge
  -- functions). See the header note: user-facing requests always carry a JWT.
  if auth.uid() is null then
    return coalesce(NEW, OLD);
  end if;

  perform public.fn_assert_property_operational(v_property_id);

  return coalesce(NEW, OLD);
end;
$$;

revoke execute on function public.fn_assert_property_row_operational() from anon, public;

-- ---------------------------------------------------------------------------
-- Attach the guard to the core operational tables.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    -- PMS / front office
    'reservations', 'guests', 'rooms', 'folio_charges', 'payments',
    'room_closures', 'housekeeping_tasks', 'laundry_orders',
    'maintenance_tickets', 'night_audits',
    -- POS & F&B / cashier
    'pos_receipts', 'pos_receipt_payments', 'pos_shifts', 'pos_shift_payments',
    'pos_kitchen_orders', 'pos_table_sessions', 'pos_void_items',
    'cashier_shifts', 'cashier_adjustments', 'cashier_refunds',
    -- Stores & inventory
    'suppliers', 'products', 'stock_movements', 'stock_usage',
    'stock_adjustments', 'stock_transfers', 'purchase_orders',
    'goods_receipts', 'inventory_counts', 'inventory_movements',
    'inventory_wastage', 'inventory_productions'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'property_id'
    ) then
      execute format('drop trigger if exists trg_assert_operational on public.%I', t);
      execute format(
        'create trigger trg_assert_operational before insert or update or delete on public.%I
         for each row execute function public.fn_assert_property_row_operational()',
        t
      );
    else
      raise warning 'operational guard skipped: %.property_id not found', t;
    end if;
  end loop;
end;
$$;

notify pgrst,'reload schema';
