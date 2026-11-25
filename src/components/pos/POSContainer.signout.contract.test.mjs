import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./POSContainer.jsx', import.meta.url), 'utf8');

test('POS sign-out confirms a full account logout before clearing local POS sessions', () => {
  const handler = source.slice(source.indexOf('const handlePosSignOut'), source.indexOf('const [activeTab'));
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /if \(!confirmed\) return/);
  assert.match(handler, /removeItem\('olitech_active_staff_v2'\)/);
  assert.match(handler, /removeItem\(\`\$\{POS_ACCESS_KEY\}:\$\{propertyId\}\`\)/);
  assert.match(handler, /setPosUnlocked\(false\)/);
});

test('POS sign-out does not close shifts or mutate orders and payments', () => {
  const handler = source.slice(source.indexOf('const handlePosSignOut'), source.indexOf('const [activeTab'));
  assert.doesNotMatch(handler, /shiftService\.(close|end)|closeShift\(/i);
  assert.doesNotMatch(handler, /store\.(closeTable|closeTableLocal|setUnsettled|openTable)|posService\./);
  assert.doesNotMatch(handler, /sales|orderLinesByTable/);
});

test('POS header receives the sign-out handler', () => {
  assert.match(source, /onSignOut=\{handlePosSignOut\}/);
});
