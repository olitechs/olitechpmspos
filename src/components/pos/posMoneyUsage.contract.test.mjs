import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');

// The POS settled on one money presentation in src/lib/posMoney.js. Before that
// every screen re-implemented 'KES ' + toLocaleString(), which is how the shift
// screens ended up disagreeing with the ticket and the bill. These assertions
// keep the shift and menu surfaces on the shared formatter.
const moneyScreens = [
  'CloseShiftModal.jsx',
  'ShiftManagementPage.jsx',
  'ShiftReceiptHistory.jsx',
  'MenuManager.jsx',
  'OrderTaking.jsx',
  'BillPayment.jsx',
];

test('POS money screens format through src/lib/posMoney', () => {
  for (const file of moneyScreens) {
    const source = read(file);
    assert.match(source, /from'@\/lib\/posMoney'|from '@\/lib\/posMoney'/, `${file} must import the shared money formatter`);
    assert.doesNotMatch(source, /const money\s*=/, `${file} must not re-implement a local money() helper`);
  }
});

test('POS money screens do not format currency with their own toLocaleString calls', () => {
  for (const file of moneyScreens) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /['"`]KES ['"`]?\s*\+/,
      `${file} must let formatKes() supply the currency prefix instead of concatenating 'KES '`,
    );
    assert.doesNotMatch(
      source,
      /minimumFractionDigits:\s*2/,
      `${file} must not hand-roll two-decimal formatting`,
    );
  }
});

test('the shift summary tiles show money and counts differently', () => {
  const modal = read('CloseShiftModal.jsx');
  // Receipts, covers and item counts are integer counts: no KES prefix.
  assert.match(modal, /formatKes\(v\)/);
  assert.match(modal, /v\.toLocaleString\('en-KE'\)/);
  // The variance tolerance is stated once, in the manager-approval sentence.
  assert.match(modal, /Manager approval is required above \{formatKes\(varianceThreshold\)\}/);
});
