import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('receipt, shift-report and void paths report an honest aggregate outcome', async () => {
  const service = await read('./printService.js');

  // Every multi-copy path must summarise rather than reduce to "all ok".
  assert.ok(
    (service.match(/summarizePrintOutcomes\(/g) || []).length >= 3,
    'receipts, shift reports and single results must each summarise',
  );
  assert.match(service, /return \{ ok: summary\.ok, outcome: summary\.outcome, summary, results \}/);
  assert.match(service, /return \{ok:summary\.ok,outcome:summary\.outcome,summary,results:\[first,second\]\}/);
});

test('cashier reprints and refunds never tell staff a job failed when it may have printed', async () => {
  const bill = await read('../components/pos/BillPayment.jsx');
  const cashier = await read('../components/modules/Cashier.jsx');
  const shiftHistory = await read('../components/pos/ShiftReceiptHistory.jsx');

  assert.match(bill, /result\.outcome==='uncertain'/);
  assert.match(bill, /check the paper before reprinting/);
  assert.match(cashier, /r\.outcome === 'uncertain'/);
  assert.match(cashier, /result\.outcome === 'uncertain'/);
  assert.match(shiftHistory, /result\.outcome === 'uncertain'/);
});

test('a dedicated void printer is preferred over the normal order printer', async () => {
  const taking = await read('../components/pos/OrderTaking.jsx');
  const kitchen = await read('../components/modules/KitchenDisplay.jsx');

  assert.match(taking, /dedicatedVoidPrinters\.length \? dedicatedVoidPrinters : collectTargets\(fallbackType\)/);
  assert.match(kitchen, /dedicated\.length \? dedicated : collect\(fallback\)/);
});

test('void slips keep their status honest and reprints keep the stored ESC/POS bytes', async () => {
  const service = await read('./printService.js');

  // pos_void_items has no "uncertain" status, so an unconfirmed slip stays pending.
  assert.match(service, /outcome === 'uncertain' \? 'pending' : 'failed'/);
  // A retry must not re-render from HTML: that loses the printed logo.
  assert.match(service, /job\.payload\?\.escposBase64/);
  assert.match(service, /thermalBase64: storedPayload/);
});
