import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../../supabase/migrations/20261011120000_phase0_rpc_tenant_guard_remediation.sql', import.meta.url),
  'utf8',
);

test('POS menu RPC rejects null property IDs and enforces property membership', () => {
  assert.match(migration, /if p_property_id is null then[\s\S]*?errcode = '22023'/i);
  assert.match(migration, /public\.is_platform_owner\(\)[\s\S]*?public\.is_member_of_property\(p_property_id\)/i);
  assert.match(migration, /Not authorized to access this property menu/i);
});

test('pending property RPC binds caller identity unless using service role', () => {
  assert.match(migration, /auth\.uid\(\) is distinct from p_user_id/i);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/i);
  assert.match(migration, /Not authorized to create a property for another user/i);
});

test('tenant guard migration keeps RPC grants narrow and revokes public/anonymous execution', () => {
  assert.match(migration, /revoke all on function public\.fn_list_pos_menu\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.fn_list_pos_menu\(uuid\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.create_pending_property_for_user\(uuid, text, text, text\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.create_pending_property_for_user\(uuid, text, text, text\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.create_pending_property_for_user\([^;]+ to authenticated/i);
});

test('tenant guard migration is forward-only and transaction-bounded', () => {
  assert.match(migration, /\bbegin;/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\.properties/i);
});

test('tenant guard SECURITY DEFINER RPCs pin search_path and scope reads to the requested tenant', () => {
  const menuRpc = migration.match(/create or replace function public\.fn_list_pos_menu\(p_property_id uuid\)([\s\S]*?)\$function\$;/i)?.[1] || '';
  const propertyRpc = migration.match(/create or replace function public\.create_pending_property_for_user\(([\s\S]*?)\$function\$;/i)?.[1] || '';

  assert.match(menuRpc, /security definer[\s\S]*?set search_path = public/i);
  assert.match(menuRpc, /where p\.property_id = p_property_id/i);
  assert.match(propertyRpc, /security definer[\s\S]*?set search_path = public[\s\S]*?set row_security = off/i);
  assert.ok(propertyRpc.indexOf('auth.uid() is distinct from p_user_id') < propertyRpc.indexOf('insert into public.properties'));
});

const printerFoundation = await readFile(
  new URL('../migrations/0061_printer_recode_settings.sql', import.meta.url),
  'utf8',
);
const printerGroups = await readFile(
  new URL('../migrations/0057_printer_groups.sql', import.meta.url),
  'utf8',
);
const pmsService = await readFile(
  new URL('../../src/services/pmsService.js', import.meta.url),
  'utf8',
);

test('printer foundation migration has valid idempotent realtime publication block', () => {
  assert.match(printerFoundation, /do \$printer_realtime\$[\s\S]*?alter publication supabase_realtime add table public\.print_jobs;[\s\S]*?when duplicate_object then null;[\s\S]*?when undefined_object then null;[\s\S]*?end\s*\$printer_realtime\$;/i);
  assert.doesNotMatch(printerFoundation, /do \$\s+begin[\s\S]*?end \$;/i);
});

test('printer tables used by the app are created by tracked Supabase migrations', () => {
  assert.match(printerGroups, /create table if not exists public\.printer_groups/i);
  assert.match(printerFoundation, /create table if not exists public\.print_agents/i);
  assert.match(printerFoundation, /create table if not exists public\.printers/i);
  assert.match(printerFoundation, /create table if not exists public\.printer_group_printers/i);
  assert.match(printerFoundation, /create table if not exists public\.print_jobs/i);
});

test('daily POS summary app RPC arguments match the reporting function contract', async () => {
  const reporting = await readFile(
    new URL('../migrations/0060_pos_phase4b_reporting.sql', import.meta.url),
    'utf8',
  );
  assert.match(pmsService, /rpc\('fn_daily_pos_summary',\s*\{\s*p_property_id:\s*propertyId,\s*p_business_date:/s);
  assert.match(reporting, /function public\.fn_daily_pos_summary\(\s*p_property_id uuid,\s*p_business_date date/i);
});

const printerStore = await readFile(
  new URL('../../src/data/modules/printerStore.js', import.meta.url),
  'utf8',
);
const kitchenPrintersPage = await readFile(
  new URL('../../src/components/settings/KitchenPrintersPage.jsx', import.meta.url),
  'utf8',
);
const dashboard = await readFile(
  new URL('../../src/components/modules/Dashboard.jsx', import.meta.url),
  'utf8',
);

test('kitchen printer route uses the production property-scoped printer schema', () => {
  assert.match(kitchenPrintersPage, /@\/pages\/SettingsPrinters/);
  // Failed and unconfirmed jobs both need a human: the unconfirmed ones may
  // already be on paper, so reprinting them requires a paper check first.
  assert.match(kitchenPrintersPage, /listFnbPrintJobs\(propertyId, \{ statuses: \['failed', 'uncertain'\], limit: 25 \}\)/);
  assert.match(kitchenPrintersPage, /job\.status === 'uncertain' && !window\.confirm/);
  assert.match(kitchenPrintersPage, /table: 'fnb_print_jobs'/);
  assert.match(kitchenPrintersPage, /retryFnbPrintJob\(job\.id, propertyId\)/);
  assert.doesNotMatch(kitchenPrintersPage, /printer_groups|printer_group_categories|print_agents|from\('printers'\)/);
});

test('legacy workspace printer store remains fail-soft when optional relations are absent', () => {
  assert.match(printerStore, /const isMissingRelation = \(error\) => \['PGRST205', '42P01'\]/);
  assert.match(printerStore, /const printerGroupsUnavailable = isMissingRelation\(groupsError\)/);
  assert.match(printerStore, /const printAgentsUnavailable = isMissingRelation\(agentsError\)/);
  assert.match(printerStore, /printerGroupsUnavailable, printAgentsUnavailable/);
});

test('dashboard retries a failed POS summary once and waits for manual refresh after failure', () => {
  assert.match(dashboard, /summaryFailureRef\.current/);
  assert.match(dashboard, /setTimeout\(resolve, 700\)/);
  assert.match(dashboard, /load\(\{ force: true \}\)/);
  assert.match(dashboard, /Summary unavailable\. Select Refresh to retry\./);
});
