import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// POS shift workflow contract (upgrade pack Task 4).
//
// Upstream already shipped the cashier-shift model, close-shift blocking,
// floor-plan guard and 80/58mm closing report. These pins cover the gaps that
// were filled on top of it: a live "no shift" banner, the 24-hour reminder,
// who opened the drawer, the floor-plan escape hatch from a blocked close, a
// print/skip prompt after closing, reprint for past shifts and the
// before-discount / discount / VAT lines on the printed report.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const header = read('./AppHeader.jsx');
const container = read('./POSContainer.jsx');
const shiftPage = read('./ShiftManagementPage.jsx');
const closeModal = read('./CloseShiftModal.jsx');
const history = read('./ShiftReceiptHistory.jsx');
const bill = read('./BillPayment.jsx');
const shiftCore = read('../../services/shiftReportCore.js');
const printService = read('../../services/printService.js');
const posService = read('../../services/posService.js');
const backOffice = read('../../pages/ShiftReport.jsx');

test('POS shows a live informational no-shift banner while the Shifts tab remains actionable', () => {
  assert.match(header, /No shift is open\. Sales are blocked until you open one\./);
  assert.match(header, /role="status"/);
  assert.match(header, /aria-live="polite"/);
  assert.doesNotMatch(header, /onClick=\{\(\) => onOpenShifts\?\.\(\)\}/);
  assert.match(header, /if \(tab\.id === 'shifts'\) onOpenShifts\?\.\(\)/);
  // The banner state follows other terminals instead of freezing at mount.
  assert.match(container, /window\.setInterval\(refresh, 60000\)/);
  assert.match(container, /document\.addEventListener\('visibilitychange', refresh\)/);
  assert.match(container, /setCurrentShift\(\(previous\) => \(previous\?\.id === shift\?\.id \? previous : shift\)\)/);
});

test('the active shift card shows who opened it and warns past 24 hours', () => {
  assert.match(shiftPage, /Opened by/);
  assert.match(shiftPage, /summary\?\.openedBy/);
  assert.match(shiftPage, /const openOver24Hours = Number\.isFinite\(hoursOpen\) && hoursOpen > 24;/);
  assert.match(shiftPage, /This shift has been open for more than 24 hours\./);
  // The summary loads without a click so the card is live.
  assert.match(shiftPage, /useEffect\(\(\) => \{\s*\n\s*if \(currentShift\?\.id\) loadSummary\(\);/);
});

test('open tables block closing with their status and a route back to the floor', () => {
  assert.match(shiftPage, /Table \{table\.table_number \|\| table\.table_key \|\| '—'\} · <span className="capitalize">\{String\(table\.status/);
  assert.match(closeModal, /Settle and clear these tables from the floor first:/);
  assert.match(closeModal, /String\(t\.status\|\|'open'\)\.replaceAll\('_',' '\)/);
  assert.match(closeModal, /Go to floor plan/);
  assert.match(container, /onGoToFloor=\{\(\) => setActiveTab\('floor'\)\}/);
  assert.match(container, /onGoToFloor=\{\(\) => \{ setCloseShiftOpen\(false\); setActiveTab\('floor'\); \}\}/);
});

test('closing asks whether to print instead of auto-printing', () => {
  const doClose = closeModal.slice(closeModal.indexOf('const doClose='), closeModal.indexOf('const submitPin='));
  assert.doesNotMatch(doClose, /await sendClosedReport\(fresh\)/);
  assert.match(doClose, /setPrintStatus\('pending'\)/);
  assert.match(closeModal, /Print the closing report for the cashier and manager copies, or skip printing\./);
  assert.match(closeModal, />Skip printing</);
  assert.match(closeModal, /> Print shift report</);
  // The outcome summary is shown on the success screen.
  assert.match(closeModal, /formatKes\(closedReport\.totalSales\)/);
  assert.match(closeModal, /formatKes\(closedReport\.variance\)/);
});

test('past shifts can be reprinted from POS and from Back Office', () => {
  assert.match(history, /Reprint shift report/);
  assert.match(history, /printShiftReport\(data, targets\)/);
  assert.match(history, /printShiftPreview\(data, targets\)/);
  assert.match(backOffice, /const reprintThermal = async \(\) => \{/);
  assert.match(backOffice, /Reprint shift report/);
  assert.match(backOffice, /forceReprint: true/);
});

test('the printed closing report shows sales before discount, discounts, VAT and total', () => {
  const templates = read('../../services/printTemplates.js');
  assert.match(shiftCore, /salesBeforeDiscount \+= Number\(receipt\.subtotal \|\| 0\)/);
  assert.match(shiftCore, /discountsTotal \+= Number\(receipt\.discount_amount \|\| 0\)/);
  assert.match(shiftCore, /vatTotal \+= Number\(receipt\.vat \|\| 0\)/);
  // The thermal report is built from those same figures, formatted as KSh.
  assert.match(templates, /'KSh ' \+ roundReceiptMoney\(value\)/);
  assert.match(templates, /shiftMoneyRows\('Gross Sales', grossSales/);
  assert.match(templates, /shiftMoneyRows\('Discounts', discounts/);
  assert.match(templates, /shiftMoneyRows\('VAT \/ tax', vatTotal/);
  assert.match(templates, /shiftMoneyRows\('Net Sales', netSales/);
  assert.match(printService, /buildShiftReportText\(report/);
  // 58mm paper is honoured by the shared printer pipeline.
  assert.match(printService, /paper === '58mm' \? 360 : 540/);
});

test('no client call remains on the retired pos_shifts reconciliation', () => {
  assert.doesNotMatch(posService, /fn_pos_shift_reconciliation/);
  assert.doesNotMatch(posService, /p_pos_shift_id/);
});

test('a "no open shift" payment error offers the Shifts page', () => {
  assert.match(bill, /No open POS shift\. Open a shift before taking payments\./);
  assert.match(bill, /\/no open pos shift\/i\.test\(error\) && onOpenShifts/);
  assert.match(container, /onOpenShifts=\{\(\) => setActiveTab\('shifts'\)\}/);
});
