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
  assert.match(templates, /Payment pending/);
  assert.match(bill, /printReceipt\('UNSETTLED'/);
  assert.doesNotMatch(service, /from\(['"]pos_receipts['"]\)/);
});


test('unsettled duplicate copies are sent as independently cut print jobs', async () => {
  const service = await read('./printService.js');
  assert.ok(service.includes('for (const copy of copies)'));
  assert.ok(service.includes('copyType: copy.toLowerCase().replace'));
  assert.ok(service.includes("title: 'Unsettled Bill - ' + copy"));
  const unsettledStart = service.indexOf("if (type === 'UNSETTLED') {", service.indexOf('export async function printReceipt'));
  const unsettledEnd = service.indexOf("  for (const printer of targets) {", service.indexOf("return { ok: results.length", unsettledStart));
  const unsettledBlock = service.slice(unsettledStart, unsettledEnd);
  assert.ok(!unsettledBlock.includes('copyTexts.join'));
});

test('KOT and BOT jobs leave two blank footer lines before cutting', async () => {
  const service = await read('./printService.js');
  const routing = await read('./printRoutingService.js');
  const browser = await read('./printerService.js');
  const agent = await read('../../tools/print-agent/server.mjs');
  assert.ok(service.includes('toEscPosPayload(thermalText, { feedLines: 2 })'));
  assert.ok(service.includes('thermalBase64,'));
  assert.ok(routing.includes('{ feedLines: 2 }'));
  assert.ok(browser.includes('const feedLines = 2;'));
  assert.ok(browser.includes("encode(body + '\\n'),"), 'browser transport preserves one clearance line before the feed command');
  assert.ok(agent.includes('return 1;'));
  assert.ok(agent.includes("enc.encode(body + '\\n'),"), 'local agent preserves one clearance line before the feed command');
  assert.ok(agent.includes('finish(null), 1800'));
});


test('POS snapshots sent order lines before asynchronous printer dispatch', async () => {
  const pos = await read('../components/pos/POSContainer.jsx');
  const snapshot = pos.indexOf('if (!(await persistSentSnapshot())) return;');
  const dispatch = pos.indexOf('printResult = await dispatchTickets();');
  assert.ok(snapshot >= 0 && dispatch > snapshot, 'sent snapshot must be persisted before printer I/O');
  assert.ok(!pos.slice(dispatch).includes('if (!(await persistSentSnapshot())) return;'), 'retry must not mutate the sent snapshot again');
});

test('final receipt copies are separate jobs with an independent feed and cut', async () => {
  const service = await read('./printService.js');
  const templates = await read('./printTemplates.js');
  const finalBlock = service.slice(service.indexOf("  for (const printer of targets) {", service.indexOf("return { ok: results.length")), service.indexOf("\n  return { ok: results.every", service.indexOf("return { ok: results.length")));
  assert.ok(finalBlock.includes('for (const copy of copies)'));
  assert.ok(finalBlock.includes('feedLines: 2'));
  assert.ok(finalBlock.includes("copyType: copy.toLowerCase()"));
  assert.ok(!finalBlock.includes('copyTexts.join'));
  assert.match(templates, /Math\.min\(4, requestedFeed\)/);
});

test('unsettled receipt uses two feed lines and a full cut', async () => {
  const service = await read('./printService.js');
  assert.ok(service.includes('feedLines: 2'));
  assert.ok(service.includes('partialCut: false'));
  assert.ok(!service.includes('partialCut: true'));
});
