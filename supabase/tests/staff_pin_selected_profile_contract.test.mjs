import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guard = readFileSync(new URL('../../src/components/auth/RouteGuard.jsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../../src/services/authService.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/20261119010000_verify_staff_pin_for_selected_profile.sql', import.meta.url), 'utf8');
const pos = readFileSync(new URL('../../src/components/pos/POSContainer.jsx', import.meta.url), 'utf8');

test('workspace PIN verification is bound to the selected staff identity', () => {
  assert.match(guard, /verifyStaffPinForStaff\(\{ propertyId, staffId: selected\.id, module: moduleKey, pin \}\)/);
  assert.match(guard, /result\.staff\?\.id !== selected\.id/);
  assert.match(auth, /verify_staff_pin_for_staff/);
  assert.match(migration, /and id = p_staff_id/);
  assert.match(migration, /and property_id = p_property_id/);
  assert.match(migration, /and p_module = any\(assigned_modules\)/);
});

test('a slow PIN request cannot leave the login UI permanently busy', () => {
  assert.match(guard, /setTimeout\(\(\) => reject\(new Error\('PIN verification is taking too long/);
  assert.match(guard, /finally\s*\{[\s\S]*?setPinBusy\(false\)/);
  assert.match(guard, /busy=\{pinBusy\}/);
  assert.match(guard, /pinBusyRef\.current/);
});

test('POS operator switching verifies the profile the operator selected', () => {
  assert.match(pos, /verifyStaffPinForStaff\(\{ propertyId, staffId: switchStaff\?\.id, module: 'pos', pin \}\)/);
});
