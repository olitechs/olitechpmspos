import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CloseShiftModal.jsx', import.meta.url), 'utf8');

test('shift report settings are loaded through the settings service, not Supabase directly', () => {
  assert.doesNotMatch(source, /supabaseClient/);
  assert.doesNotMatch(source, /\.from\('property_settings'\)/);
  assert.match(source, /import\{getPropertySettings,getPosCashVarianceThreshold\}from'@\/services\/settingsService';/);
  assert.match(source, /await getPropertySettings\(propertyId\)/);
});

test('the manager-PIN cash variance tolerance comes from the property policy, not a literal', () => {
  assert.doesNotMatch(source, /Math\.abs\(variance\)>500/);
  assert.match(source, /getPosCashVarianceThreshold\(propertyId\)/);
  assert.match(source, /requiresManagerApproval\(variance,varianceThreshold\)/);
});

test('the tolerance is stored on property_settings and falls back to 500', () => {
  const settings = readFileSync(new URL('../../services/settingsService.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../../../supabase/migrations/20261115120000_pos_cash_variance_threshold.sql', import.meta.url), 'utf8');
  assert.match(settings, /pos_cash_variance_threshold/);
  assert.match(settings, /export async function getPosCashVarianceThreshold/);
  assert.match(migration, /add column if not exists pos_cash_variance_threshold numeric\(12,2\) not null default 500/);
});
