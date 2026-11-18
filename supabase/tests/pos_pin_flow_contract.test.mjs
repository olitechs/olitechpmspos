import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// POS access PIN flow contract (upgrade pack Task 3, client half).
//
// Pins the forced "Set a new POS PIN" behavior for owners/admins and the
// explicit non-block for staff (the hard server block is a deliberate
// platform decision that has NOT been taken — do not add it accidentally).

const container = readFileSync(new URL('../../src/components/pos/POSContainer.jsx', import.meta.url), 'utf8');
const setupGate = readFileSync(new URL('../../src/components/pos/PosPinSetupGate.jsx', import.meta.url), 'utf8');
const accessPinTab = readFileSync(new URL('../../src/components/pos/AccessPinTab.jsx', import.meta.url), 'utf8');
const pinMigration = readFileSync(
  new URL('../../supabase/migrations/20261109065915_pos_pin_no_default_and_must_change_flag.sql', import.meta.url),
  'utf8',
);

test('a correct default PIN forces owners/admins into the PIN setup screen', () => {
  const verifyBlock = container.slice(
    container.indexOf('const verifyPosAccess'),
    container.indexOf('const handlePosPinSetup'),
  );
  assert.match(verifyBlock, /result\.must_change/);
  assert.match(verifyBlock, /if \(canManagePosPin\) \{\s*\r?\n\s*setPosPinSetup\('must_change'\);\s*\r?\n\s*return;/);
  // The setup screen renders before any POS content.
  assert.match(container, /if \(posPinSetup && canManagePosPin\) return \(\s*\r?\n\s*<PosPinSetupGate/);
  assert.match(container, /import PosPinSetupGate from '@\/components\/pos\/PosPinSetupGate';/);
});

test('staff are NOT hard-blocked by the client while the platform decision is pending', () => {
  const verifyBlock = container.slice(
    container.indexOf('const verifyPosAccess'),
    container.indexOf('const handlePosPinSetup'),
  );
  // Staff path: warning toast, then unlock — never a refusal.
  assert.match(verifyBlock, /toast\.warning\('POS is still using the default access PIN/);
  const afterWarning = verifyBlock.slice(verifyBlock.indexOf('toast.warning'));
  assert.match(afterWarning, /setPosUnlocked\(true\)/);
});

test('a not-configured PIN sends owners/admins to setup and keeps the server message for staff', () => {
  const verifyBlock = container.slice(
    container.indexOf('const verifyPosAccess'),
    container.indexOf('const handlePosPinSetup'),
  );
  assert.match(verifyBlock, /\/not configured\/i\.test\(message\) && canManagePosPin/);
  assert.match(verifyBlock, /setPosPinSetup\('not_configured'\)/);
  // Non-admin path still surfaces the server's message ("Ask the property administrator").
  assert.match(verifyBlock, /setPosAccessError\(message\)/);
});

test('the setup screen validates locally and surfaces server weak-PIN errors', () => {
  assert.match(setupGate, /posAccessService\.resetPin\(\{ propertyId, pin \}\)/);
  assert.match(setupGate, /Enter exactly four digits\./);
  assert.match(setupGate, /Choose a PIN different from the initial default 1234\./);
  assert.match(setupGate, /The PIN confirmation does not match\./);
  assert.match(setupGate, /role="alert"/);
  // POS-spec touch targets (≥44px) on the inputs and the submit button.
  assert.match(setupGate, /min-h-11/);
  // Success unlocks POS via the container callback.
  assert.match(setupGate, /onComplete\?\.\(\{ is_default: false \}\)/);
  assert.match(container, /const handlePosPinSetup = \(\) => \{[\s\S]*?setPosUnlocked\(true\)/);
});

test('the PIN settings tab keeps clear weak-PIN messaging', () => {
  assert.match(accessPinTab, /Enter exactly four digits\./);
  assert.match(accessPinTab, /Choose a PIN different from the initial default 1234\./);
  assert.match(accessPinTab, /The PIN confirmation does not match\./);
  assert.match(accessPinTab, /role="alert"/);
  assert.match(accessPinTab, /min-h-11/);
});

test('the server contract stays authoritative: verify returns must_change, reset enforces weak-PIN rules', () => {
  assert.match(pinMigration, /'ok', true, 'is_default', v_credential\.is_default, 'must_change', v_credential\.is_default/);
  assert.match(pinMigration, /POS access PIN is not configured\. Ask the property administrator\./);
  assert.match(pinMigration, /Choose a PIN that is not a repeated or sequential number\./);
  assert.match(pinMigration, /Only the property owner or administrator can reset the POS PIN\./);
});
