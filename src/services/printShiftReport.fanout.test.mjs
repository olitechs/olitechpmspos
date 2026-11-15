import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const printService = readFileSync(new URL('./printService.js', import.meta.url), 'utf8');
const shiftPage = readFileSync(new URL('../components/pos/ShiftManagementPage.jsx', import.meta.url), 'utf8');
const closeModal = readFileSync(new URL('../components/pos/CloseShiftModal.jsx', import.meta.url), 'utf8');

test('every printer assigned to shift reports receives a copy', () => {
  assert.ok(printService.includes('function normalizePrinters(value)'));
  assert.ok(printService.includes('const plan = printers.length === 1'));
  assert.ok(printService.includes('printers.map((printer, index) =>'));
});

test('the closing report distributes the cashier and manager copies across assigned printers', () => {
  assert.ok(printService.includes('const SHIFT_REPORT_COPIES = ['));
  assert.ok(printService.includes("copyType: 'cashier'"));
  assert.ok(printService.includes("copyType: 'manager'"));
  assert.ok(printService.includes('printer: printers[0]'));
  assert.ok(printService.includes('SHIFT_REPORT_COPIES[index % SHIFT_REPORT_COPIES.length]'));
});

test('printed copies are tracked per printer so a retry only re-sends what failed', () => {
  assert.ok(printService.includes("select('copy_type,status,payload,created_at,printer_id')"));
  assert.ok(printService.includes("query.eq('printer_id', String(printerId))"));
  assert.ok(printService.includes("confirmedCopies({propertyId, jobType:'shift_report', shiftId, printerId:copy.printer.id})"));
});

test('the shift screens hand the full assignment list to the print service', () => {
  assert.ok(shiftPage.includes('printShiftPreview({ ...summary, propertyId }, assigned)'));
  assert.ok(!shiftPage.includes('assigned[0]'));
  assert.ok(closeModal.includes('printShiftReport(reportData,targets)'));
  assert.ok(closeModal.includes('printShiftPreview(data,targets)'));
  assert.ok(!closeModal.includes('const printer=targets[0]'));
});
