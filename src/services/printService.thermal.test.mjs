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
  assert.match(settings, /printCutCalibrationTest/);
  assert.match(settings, /Cut Calibration Test/);
  assert.match(service, /export async function printCutCalibrationTest/);
  assert.match(service, /export async function printTestOrder/);
  assert.match(service, /export async function printTestReceipt/);
  assert.match(service, /persistJob: false/);
  assert.match(service, /propertyId: null,\s*jobType: 'test_order'/);
  assert.match(service, /propertyId: null,\s*jobType: 'test_receipt'/);
});

test('order and unsettled print paths use shared width-aware templates', async () => {
  const service = await read('./printService.js');
  assert.match(service, /buildOrderTicketText/);
  assert.match(service, /buildUnsettledReceiptText/);
  assert.match(service, /buildFinalReceiptText/);
  assert.match(service, /buildLogoEscPosBase64/);
  assert.match(service, /thermalBase64/);
  assert.match(service, /thermalText/);
  const browserTransport = await read('./printerService.js');
  assert.match(browserTransport, /writeValueWithResponse/);
  assert.match(browserTransport, /setTimeout\(resolve, 15\)/);
  assert.match(service, /property_settings/);
  assert.match(service, /toEscPosPayload/);
});

test('unsettled bill print remains separate from payment and receipt persistence', async () => {
  const service = await read('./printService.js');
  const templates = await read('./printTemplates.js');
  const bill = await read('../components/pos/BillPayment.jsx');
  assert.match(service, /type === 'UNSETTLED'/);
  assert.match(templates, /buildEscPosPayload\(text, options\)/);
  assert.match(bill, /printReceipt\('UNSETTLED'/);
  assert.doesNotMatch(service, /from\(['"]pos_receipts['"]\)/);
});


test('unsettled duplicate copies are sent as independently cut print jobs', async () => {
  const service = await read('./printService.js');
  assert.ok(service.includes('for (const copy of copiesForRun)'));
  assert.ok(service.includes('copyType: copy.toLowerCase().replace'));
  assert.ok(service.includes("title: 'Unsettled Bill - ' + copy"));
  const unsettledStart = service.indexOf("if (type === 'UNSETTLED') {", service.indexOf('export async function printReceipt'));
  const unsettledEnd = service.indexOf("  for (const printer of targets) {", service.indexOf("return { ok: results.length", unsettledStart));
  const unsettledBlock = service.slice(unsettledStart, unsettledEnd);
  assert.ok(!unsettledBlock.includes('copyTexts.join'));
});

test('KOT and BOT jobs use the shared configurable feed and cut finalizer', async () => {
  const service = await read('./printService.js');
  const browser = await read('./printerService.js');
  const agent = await read('../../tools/print-agent/server.mjs');
  assert.ok(service.includes('toEscPosPayload(thermalText, getPrinterPrintSettings(printer))'));
  assert.ok(service.includes('thermalBase64,'));
  assert.ok(browser.includes('buildEscPosPayload(text, settings)'));
  assert.ok(browser.includes("import { buildEscPosPayload } from './escposJob.js'"));
  assert.ok(agent.includes('buildEscPosPayload(body, settings)'));
  assert.ok(agent.includes("socket.once('drain'"));
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
  assert.ok(finalBlock.includes('for (const copy of copiesForRun)'));
  assert.ok(finalBlock.includes('getPrinterPrintSettings(printer)'));
  assert.ok(finalBlock.includes("copyType: copy.toLowerCase()"));
  assert.ok(!finalBlock.includes('copyTexts.join'));
});

test('unsettled receipt uses two feed lines and a full cut', async () => {
  const service = await read('./printService.js');
  assert.ok(service.includes('getPrinterPrintSettings(printer)'));
  assert.ok(service.includes('buildLogoEscPosBase64'));
  assert.ok(!service.includes('partialCut: true'));
});

test('live shift preview is a separate pre-close thermal report with no closing cash variance', async () => {
  const service = await read('./printService.js');
  assert.match(service, /export async function printShiftPreview/);
  const start = service.indexOf('function shiftPreviewHtml');
  const end = service.indexOf('export async function printShiftPreview', start);
  const preview = service.slice(start, end);
  assert.match(preview, /PRE-CLOSE/);
  assert.match(preview, /SHIFT STILL OPEN/);
  assert.match(preview, /LIVE SHIFT SUMMARY/);
  assert.match(preview, /EXPECTED CASH IN DRAWER/);
  assert.doesNotMatch(preview, /CASH COUNTED|CASH VARIANCE|SHIFT CLOSING REPORT/);
});

test('successful shift closure automatically sends the final thermal report and allows retry', async () => {
  const modal = await read('../components/pos/CloseShiftModal.jsx');
  assert.match(modal, /await sendClosedReport\(fresh\)/);
  assert.match(modal, /const sendClosedReport=async\(reportData\)/);
  assert.match(modal, /setPrintStatus\('printed'\)/);
  assert.match(modal, /Retry print/);
  assert.match(modal, /Shift closed successfully/);
  assert.doesNotMatch(modal, /Skip printing/);
});
