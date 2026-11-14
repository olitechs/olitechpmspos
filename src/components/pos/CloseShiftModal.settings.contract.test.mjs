import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CloseShiftModal.jsx', import.meta.url), 'utf8');

test('shift report settings are loaded through the settings service, not Supabase directly', () => {
  assert.doesNotMatch(source, /supabaseClient/);
  assert.doesNotMatch(source, /\.from\('property_settings'\)/);
  assert.match(source, /import\{getPropertySettings\}from'@\/services\/settingsService';/);
  assert.match(source, /await getPropertySettings\(propertyId\)/);
});
