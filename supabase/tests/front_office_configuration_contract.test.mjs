import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../src/pages/FrontOfficeConfiguration.jsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

test('Front Office configuration uses existing property-scoped rate and booking tables', () => {
  assert.match(page, /from\('rate_plans'\)/);
  assert.match(page, /from\('booking_engine_settings'\)/);
  assert.match(page, /\.eq\('property_id', propertyId\)/);
  assert.match(page, /default_rate/);
  assert.match(page, /meal_plan/);
  assert.match(page, /cancellation_policy/);
  assert.match(page, /payment_instructions/);
});

test('rate plan writes remain property-scoped and do not mutate existing reservations', () => {
  assert.match(page, /\.update\(payload\)\.eq\('id', editingId\)\.eq\('property_id', propertyId\)/);
  assert.match(page, /\.delete\(\)\.eq\('id', rate\.id\)\.eq\('property_id', propertyId\)/);
  assert.match(page, /Existing reservations are not changed/);
});

test('configuration route uses the dedicated page without duplicating Back Office tax and payment settings', () => {
  assert.match(app, /FrontOfficeConfiguration = lazyWithRetry/);
  assert.match(app, /path="configuration" element={<FrontOfficeConfiguration\/>}/);
  assert.match(page, /Payment types and tax configuration remain in Back Office settings/);
  assert.match(page, /room types remain in Structure/);
});
