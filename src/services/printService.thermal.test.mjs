import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('printer test buttons use the real template-backed print service without creating FNB jobs', async () => {
  const settings = await read('../pages/SettingsPrinters.jsx');
  const service = await read('./printService.js');
  assert.match(settings, /Test Print – Order/);
  assert.match(settings, /Test Print – Receipt/);
  assert.match(settings, /printTestOrder/);
  assert.match(settings, /printTestReceipt/);
  assert.match(service, /export async function printTestOrder/);
  assert.match(service, /export async function printTestReceipt/);
  assert.match(service, /persistJob: false/);
  assert.match(service, /propertyId: null,\s*jobType: 'test_order'/);
  assert.match(service, /propertyId: null,\s*jobType: 'test_receipt'/);
});

test('order and unsettled print paths use shared width-aware templates', async () => {
  const service = await read('./printService.js');
  const routing = await read('./printRoutingService.js');
  assert.match(service, /buildOrderTicketText/);
  assert.match(service, /buildUnsettledReceiptText/);
  assert.match(service, /buildFinalReceiptText/);
  assert.match(service, /buildLogoEscPosBase64/);
  assert.match(service, /thermalBase64/);
  assert.match(service, /thermalText/);
  const browserTransport = await read('./printerService.js');
  assert.match(browserTransport, /writeValueWithResponse/);
  assert.match(browserTransport, /setTimeout\(resolve, 15\)/);
  assert.match(routing, /buildOrderTicketText/);
  assert.match(routing, /property_settings/);
  assert.match(routing, /settings: receiptSettings/);
  assert.match(routing, /toEscPosPayload/);
});

test('unsettled bill print remains separate from payment and receipt persistence', async () => {
  const service = await read('./printService.js');
  const templates = await read('./printTemplates.js');
  const bill = await read('../components/pos/BillPayment.jsx');
  assert.match(service, /type === 'UNSETTLED'/);
  assert.match(templates, /PAYMENT PENDING/);
  assert.match(bill, /printReceipt\('UNSETTLED'/);
  assert.doesNotMatch(service, /from\(['"]pos_receipts['"]\)/);
});
