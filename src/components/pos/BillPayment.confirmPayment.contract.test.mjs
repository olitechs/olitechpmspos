import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./BillPayment.jsx', import.meta.url), 'utf8');
const indexOf = (needle) => {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, `expected BillPayment.jsx to contain: ${needle}`);
  return index;
};

test('the sale is recorded before any receipt-printing step', () => {
  const recorded = indexOf('saleRecorded=true;');
  const printed = indexOf("result=await printReceipt('RECEIPT'");
  assert.ok(recorded < printed, 'saleRecorded must be set before the receipt print call');
});

test('receipt printing is isolated so a printer/query throw cannot abort settlement', () => {
  assert.match(source, /try\{\s*\n\s*result=await printReceipt\('RECEIPT'/);
  assert.match(source, /catch\(printError\)\{/);
  assert.match(source, /result=\{ok:false,outcome:'failed',friendlyError:printError\?\.message\|\|'Receipt printer failed\.'\};/);
});

test('the table is released exactly once, on both the printed and failed-print paths', () => {
  assert.match(source, /const releaseTable=\(\)=>\{if\(released\)return;released=true;onConfirmPayment\(\);\};/);
  assert.equal((source.match(/onConfirmPayment\(\)/g) || []).length, 1, 'only releaseTable may call onConfirmPayment()');
  assert.match(source, /releaseTable\(\);\s*\n\s*\/\/ Drawer opening is a post-payment convenience/);
  assert.match(source, /if\(saleRecorded\)\{[\s\S]*?releaseTable\(\);/);
});

test('only a failed sale write is reported as "not recorded"', () => {
  assert.doesNotMatch(source, /\}catch\(e\)\{setError\('Payment was not recorded: '\+e\.message\);toast\.error\('Payment was not recorded\.'\);\}/);
  assert.match(source, /if\(saleRecorded\)\{[\s\S]*Payment was recorded[\s\S]*else\{\s*\n\s*setError\('Payment was not recorded: '\+e\.message\)/);
  assert.match(source, /Do not charge the guest again\./);
});
