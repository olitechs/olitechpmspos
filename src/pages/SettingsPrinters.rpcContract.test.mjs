import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('managers can display a single-use pairing code for another computer', async () => {
  const source = await readFile(new URL('./SettingsPrinters.jsx', import.meta.url), 'utf8');

  // The code comes from the cloud RPC, so it must not depend on the agent on
  // the browser's own computer being reachable.
  assert.match(source, /createPairingCode\(\{\s*client:\s*supabase,\s*propertyId/);
  assert.match(source, /Show pairing code/);
  assert.match(source, /state\.code/);
  assert.match(source, /navigator\.clipboard\.writeText\(state\.code\)/);
  assert.match(source, /Expires in \$\{minutes\}/);
  assert.match(source, /single use/);
  assert.doesNotMatch(source, /health\?\.reachable\s*&&[^\n]*Show pairing code/);
});

test('property printer settings do not call an undeployed save RPC', async () => {
  const source = await readFile(new URL('./SettingsPrinters.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(
    source,
    /rpc\(\s*['"]fn_save_property_printer_config['"]/,
    'printer saves must not depend on a database RPC that is absent from the deployed schema'
  );

  assert.match(source, /from\(['"]property_printers['"]\)/, 'printer config must use the existing property_printers table');
  assert.match(source, /from\(['"]printer_assignments['"]\)/, 'routing must use the existing printer_assignments table');
  assert.match(source, /eq\(['"]property_id['"],\s*propertyId\)/, 'writes must remain scoped to the current property');
});
