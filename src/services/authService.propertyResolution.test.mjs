import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const authService = read('./authService.js');
const pendingApproval = read('../pages/PendingApproval.jsx');

test('property resolution keeps the membership foreign key and falls back to a direct property lookup', () => {
  assert.ok(authService.includes(".select('role, property_id, property:properties(*)')"));
  assert.ok(authService.includes('row?.property?.id || row?.property_id || null'));
  assert.ok(authService.includes(".from('properties')"));
  assert.ok(authService.includes(".eq('id', propertyId)"));
  assert.ok(authService.includes('property = propertyById || null'));
  assert.ok(authService.includes('property,\n\t\tpropertyRole: membership?.role || null'));
});

test('missing property screen offers a retry without forcing sign-out', () => {
  assert.ok(pendingApproval.includes('checkUserAuth'));
  assert.ok(pendingApproval.includes('Retry account lookup'));
  assert.ok(pendingApproval.includes('Your account and property data have not been deleted.'));
  assert.ok(pendingApproval.includes('onClick={logout}'));
});
