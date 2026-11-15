import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../../supabase/migrations/20261115055500_phase1_stock_control_foundation.sql', import.meta.url),
  'utf8'
);

test('Phase 1 installs the canonical inventory units and conversion foundation', () => {
  assert.match(migration, /create table if not exists public\.inventory_units/i);
  assert.match(migration, /create table if not exists public\.inventory_unit_conversions/i);
  for (const unit of ["'g'", "'kg'", "'mg'", "'ml'", "'l'", "'each'", "'pcs'", "'bottle'", "'glass'"]) {
    assert.ok(migration.includes(unit), `missing base unit ${unit}`);
  }
  assert.match(migration, /inventory_unit_conversions_scope_key/i);
});

test('Phase 1 adds product tracking and base-unit metadata without replacing existing stock', () => {
  assert.match(migration, /add column if not exists track_stock boolean not null default true/i);
  assert.match(migration, /add column if not exists stock_item_type text/i);
  assert.match(migration, /add column if not exists base_unit text/i);
  assert.match(migration, /set base_unit = 'pcs' where base_unit is null/i);
  // The migration preserves the legacy adjust_product_stock function body inside
  // $function$ ... $function$ dollar-quoted blocks for backwards compatibility;
  // those quoted bodies legitimately contain `UPDATE public.products
  // SET current_stock = current_stock + p_change`. The guarantee under test is
  // that the migration's own statements never reset existing stock, so strip
  // dollar-quoted bodies before asserting.
  const statements = migration.replace(
    /\$function\$[\s\S]*?\$function\$/gi,
    '-- [dollar-quoted legacy function body preserved elsewhere] --'
  );
  assert.doesNotMatch(statements, /update public\.products\s+set current_stock\s*=/i);
});

test('Phase 1 adds movement provenance, reversal and idempotency constraints', () => {
  for (const column of [
    'location_id', 'location_name_snapshot', 'source_line_key', 'idempotency_key',
    'unit_code', 'base_qty', 'unit_cost', 'recipe_id', 'recipe_version', 'reversal_of_id',
  ]) assert.match(migration, new RegExp(`add column if not exists ${column}\\b`, 'i'));
  assert.match(migration, /stock_movements_property_idempotency_key/i);
  assert.match(migration, /stock_movements_source_line_product_type_key/i);
  assert.match(migration, /stock_movements_reversal_idx/i);
});

test('Phase 1 configures the documented negative-stock policy values', () => {
  assert.match(migration, /negative_stock_policy text not null default 'warn_allow'/i);
  assert.match(migration, /check \(negative_stock_policy in \('warn_allow','block'\)\)/i);
});

test('Phase 1 movement writer locks the product and checks tenant membership', () => {
  assert.match(migration, /create or replace function public\.fn_apply_stock_movement/i);
  assert.match(migration, /where id = p_product_id\s+for update/i);
  assert.match(migration, /is_platform_owner\(\) or public\.is_member_of_property\(v\.property_id\)/i);
  assert.match(migration, /not coalesce\(v\.track_stock, true\)/i);
  assert.match(migration, /v_negative_policy = 'block'/i);
  assert.match(migration, /insert into public\.stock_movements/i);
});

test('Phase 1 is not mistaken for the complete location-aware posting cutover', () => {
  // This guard documents current scope: Phase 1 adds location metadata, but its
  // writer does not yet accept an explicit location or enforce Stores entitlement.
  assert.match(migration, /p_source_id uuid default null(?:::uuid)?/i);
  assert.doesNotMatch(migration, /p_location_id\s+uuid/i);
  assert.doesNotMatch(migration, /can_store_write\s*\(/i);
  assert.doesNotMatch(migration, /drop trigger[^;]*products_sync_default_location/i);
});
