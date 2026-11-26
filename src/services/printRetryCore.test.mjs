import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssignmentType, pickRetryPrinter } from './printRetryCore.js';

const printer = (id, overrides = {}) => ({ id, name: id, ...overrides });
const assignment = (printerId, assignmentType) => ({ printer_id: printerId, assignment_type: assignmentType });

test('legacy and singular assignment names resolve to the canonical type', () => {
  assert.equal(normalizeAssignmentType('shift_reports'), 'shift_reports');
  assert.equal(normalizeAssignmentType('Shift Report'), 'shift_reports');
  assert.equal(normalizeAssignmentType('reports'), 'shift_reports');
  assert.equal(normalizeAssignmentType('final receipts'), 'final_receipts');
});

test('a verified-online original printer is reused first', () => {
  const original = printer('p1', { is_online: true, last_status: 'connected' });
  const other = printer('p2', { is_online: true, last_status: 'connected' });
  const chosen = pickRetryPrinter({
    job: { printer_id: 'p1', assignment_type: 'shift_reports' },
    printers: [original, other],
    assignments: [assignment('p1', 'shift_reports'), assignment('p2', 'shift_reports')],
  });
  assert.equal(chosen.id, 'p1');
});

test('an offline original does not block failover to an online assigned printer', () => {
  const original = printer('p1', { is_online: false, last_status: 'offline' });
  const online = printer('p2', { is_online: true, last_status: 'connected' });
  const chosen = pickRetryPrinter({
    job: { printer_id: 'p1', assignment_type: 'shift_reports' },
    printers: [original, online],
    assignments: [assignment('p1', 'shift_reports'), assignment('p2', 'shift_reports')],
  });
  assert.equal(chosen.id, 'p2');
});

test('an offline assigned printer is still retried when nothing else is online', () => {
  // The first failed send marks the printer offline; refusing to retry it was
  // the deadlock behind "No available printer is assigned to shift_reports".
  const offline = printer('p1', { is_online: false, last_status: 'offline', last_error: '[LOCAL_AGENT_UNAVAILABLE]' });
  const chosen = pickRetryPrinter({
    job: { printer_id: null, assignment_type: 'shift_reports' },
    printers: [offline],
    assignments: [assignment('p1', 'shift_reports')],
  });
  assert.equal(chosen.id, 'p1');
});

test('a wrong assignment type cannot block the only printer on site', () => {
  const only = printer('p1', { is_online: false, last_status: 'offline' });
  const chosen = pickRetryPrinter({
    job: { printer_id: null, assignment_type: 'shift_reports' },
    printers: [only],
    assignments: [assignment('p1', 'final_receipts')],
  });
  assert.equal(chosen.id, 'p1');
});

test('a multi-printer site is not silently cross-routed by a wrong assignment type', () => {
  const receipt = printer('p1', { is_online: true, last_status: 'connected' });
  const kitchen = printer('p2', { is_online: true, last_status: 'connected' });
  const chosen = pickRetryPrinter({
    job: { printer_id: null, assignment_type: 'shift_reports' },
    printers: [receipt, kitchen],
    assignments: [assignment('p1', 'final_receipts'), assignment('p2', 'food_orders')],
  });
  assert.equal(chosen, null);
});

test('an original printer is recovered from the stored print target', () => {
  const original = printer('p1', { windows_printer_name: 'POS-80', is_online: false, last_status: 'offline' });
  const chosen = pickRetryPrinter({
    job: { printer_id: null, assignment_type: 'shift_reports', payload: { printTarget: { windowsPrinterName: 'POS-80' } } },
    printers: [original],
    assignments: [],
  });
  assert.equal(chosen.id, 'p1');
});

test('numeric and string ids still match', () => {
  const chosen = pickRetryPrinter({
    job: { printer_id: 12, assignment_type: 'shift_reports' },
    printers: [printer('12')],
    assignments: [],
  });
  assert.equal(chosen.id, '12');
});
