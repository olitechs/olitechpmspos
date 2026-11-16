import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./BillPayment.jsx', import.meta.url), 'utf8');
// BillPayment.jsx is kept readable (Prettier-formatted), so these behavioural
// assertions are whitespace-insensitive instead of pinning exact minified lines.
const flat = (text) => text.replace(/\s+/g, '');
const flatBill = flat(source);

const indexOfFlat = (needle) => {
  const index = flatBill.indexOf(needle.replace(/\s+/g, ''));
  assert.ok(index >= 0, `expected BillPayment.jsx to contain: ${needle}`);
  return index;
};

test('the sale is recorded before any receipt-printing step', () => {
  const recorded = indexOfFlat('saleRecorded = true;');
  const printed = indexOfFlat("result = await printReceipt('RECEIPT'");
  assert.ok(recorded < printed, 'saleRecorded must be set before the receipt print call');
});

test('receipt printing is isolated so a printer/query throw cannot abort settlement', () => {
  assert.match(source, /try\s*\{\s*result\s*=\s*await\s+printReceipt\(\s*'RECEIPT'/);
  assert.match(source, /catch\s*\(\s*printError\s*\)\s*\{/);
  assert.ok(
    flatBill.includes(
      flat(
        "result = { ok: false, outcome: 'failed', friendlyError: printError?.message || 'Receipt printer failed.' };"
      )
    )
  );
});

test('the table is released exactly once, on both the printed and failed-print paths', () => {
  assert.ok(
    flatBill.includes(
      flat('const releaseTable = () => { if (released) return; released = true; onConfirmPayment(); };')
    )
  );
  assert.equal((source.match(/onConfirmPayment\(\)/g) || []).length, 1, 'only releaseTable may call onConfirmPayment()');
  assert.match(source, /releaseTable\(\);\s*\/\/ Drawer opening is a post-payment convenience/);
  assert.match(source, /if\s*\(\s*saleRecorded\s*\)\s*\{[\s\S]*?releaseTable\(\);/);
});

test('only a failed sale write is reported as "not recorded"', () => {
  assert.doesNotMatch(
    source,
    /\}\s*catch\s*\(\s*e\s*\)\s*\{\s*setError\(\s*'Payment was not recorded: '\s*\+\s*e\.message\s*\);\s*toast\.error\(\s*'Payment was not recorded\.'\s*\);\s*\}/
  );
  assert.match(
    source,
    /if\s*\(\s*saleRecorded\s*\)\s*\{[\s\S]*Payment was recorded[\s\S]*else\s*\{\s*setError\(\s*'Payment was not recorded: '\s*\+\s*e\.message\s*\)/
  );
  assert.match(source, /Do not charge the guest again\./);
});
