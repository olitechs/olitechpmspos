import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('managers can display a single-use pairing code for another computer', async () => {
  const source = await readFile(new URL('./SettingsPrinters.jsx', import.meta.url), 'utf8');
  const pairing = await readFile(new URL('../services/printerAgentPairing.js', import.meta.url), 'utf8');

  // The code comes from the cloud RPC, so it must not depend on the agent on
  // the browser's own computer being reachable.
  assert.match(pairing, /rpc\(PAIRING_RPC/);
  assert.match(source, /printerSetupService\.createPairingCode\(\{/);
  assert.match(source, /Show pairing code/);
  assert.match(source, /state\.code/);
  assert.match(source, /navigator\.clipboard\.writeText\(state\.code\)/);
  assert.match(source, /Expires in \$\{minutes\}/);
  assert.match(source, /single use/);
  assert.match(source, /isWorkstationPaired/);
  assert.match(source, /Agent connected/);
  assert.match(source, /setPairingCode\(\(current\)=>\(\{ \.\.\.current, connected:true \}\)\)/);
  assert.doesNotMatch(source, /health\?\.reachable\s*&&[^\n]*Show pairing code/);
});

test('the printer health strip points staff to the signed installer and the exact app origin', async () => {
  const source = await readFile(new URL('./SettingsPrinters.jsx', import.meta.url), 'utf8');
  const healthCore = await readFile(new URL('../services/printerHealthCore.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /unsigned test build/);
  assert.doesNotMatch(source, /Signed installer not yet available/);
  assert.match(source, /Signed installer available/);
  assert.match(source, /window\.location\.origin/);
  assert.match(healthCore, /originAllowed === false/);
  assert.match(healthCore, /allowed origins/);
});

test('property printer settings do not call an undeployed save RPC', async () => {
  const source = await readFile(new URL('./SettingsPrinters.jsx', import.meta.url), 'utf8');
  const service = await readFile(new URL('../services/printerSetupService.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    service,
    /rpc\(\s*['"]fn_save_property_printer_config['"]/,
    'printer saves must not depend on a database RPC that is absent from the deployed schema'
  );
  assert.doesNotMatch(
    source,
    /rpc\(\s*['"]fn_save_property_printer_config['"]/,
    'printer saves must not depend on a database RPC that is absent from the deployed schema'
  );

  assert.match(service, /from\(['"]property_printers['"]\)/, 'printer config must use the existing property_printers table');
  assert.match(service, /from\(['"]printer_assignments['"]\)/, 'routing must use the existing printer_assignments table');
  assert.match(service, /eq\(['"]property_id['"],\s*propertyId\)/, 'writes must remain scoped to the current property');
});
