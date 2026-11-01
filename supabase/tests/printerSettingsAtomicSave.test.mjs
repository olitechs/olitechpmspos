import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../src/pages/SettingsPrinters.jsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/20261101100000_atomic_property_printer_settings.sql', import.meta.url), 'utf8');

test('printer settings save uses one property-scoped transaction for printer and assignments', () => {
  assert.match(page, /rpc\('fn_save_property_printer_config'/);
  assert.match(page, /p_property_id:\s*propertyId/);
  assert.match(page, /p_assignment_types:/);
  const saveStart = page.indexOf('const save = async () => {');
  const saveEnd = page.indexOf('\\n  };', saveStart);
  const saveHandler = saveStart >= 0 && saveEnd > saveStart ? page.slice(saveStart, saveEnd) : '';
  assert.ok(saveHandler, 'printer save handler should be present');
  assert.ok(!saveHandler.includes("from('printer_assignments').delete()"));
  assert.ok(!saveHandler.includes("from('printer_assignments').insert("));
  assert.match(page, /verify\(savedPrinter\.id,savedPrinter\)/);
});

test('atomic printer RPC validates tenant authority and allowed routing types', () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /public\.property_role\(p_property_id\)/);
  assert.match(migration, /public\.current_staff_role\(p_property_id\)/);
  assert.match(migration, /printer not found in the selected property/i);
  assert.match(migration, /not authorized to manage printers/i);
  assert.match(migration, /v_allowed/);
  assert.match(migration, /delete from public\.printer_assignments[\s\S]*?foreach v_assignment[\s\S]*?insert into public\.printer_assignments/i);
  assert.match(migration, /revoke all on function[\s\S]*?from public,anon/i);
});

test('printer settings no longer contains the retired navy/amber design palette', () => {
  for (const legacy of ['bg-slate-950', 'text-amber-300', 'bg-[#F7F8FA]', 'bg-emerald-50', 'bg-red-50']) {
    assert.ok(!page.includes(legacy), 'legacy design token remains: ' + legacy);
  }
  assert.match(page, /bg-\[var\(--canvas\)\]/);
  assert.match(page, /bg-\[var\(--primary\)\]/);
});
