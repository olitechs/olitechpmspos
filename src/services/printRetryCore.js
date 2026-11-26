// Pure printer selection for retrying a failed print job. No React, no I/O.
//
// A recorded is_online=false is a hint, not a verdict: the retry is precisely
// how the app finds out that the agent came back. Refusing to retry an offline
// printer deadlocked cashiers ("No available printer is assigned ...") after
// the first transport failure marked every assigned printer offline.

export const ASSIGNMENT_TYPE_ALIASES = Object.freeze({
  shift_report: 'shift_reports',
  reports: 'shift_reports',
  final_receipt: 'final_receipts',
  receipt: 'final_receipts',
  customer_receipt: 'final_receipts',
  unsettled_bill: 'unsettled_bills',
  food_order: 'food_orders',
  void_food_order: 'void_food_orders',
  drinks_order: 'drinks_orders',
  void_drinks_order: 'void_drinks_orders',
});

export function normalizeAssignmentType(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ASSIGNMENT_TYPE_ALIASES[key] || key;
}

const isVerifiedOnline = (printer) =>
  printer?.is_online === true && String(printer?.last_status ?? '').toLowerCase() === 'connected';

const isNotKnownOffline = (printer) => printer?.is_online !== false;

const sameId = (left, right) => left != null && right != null && String(left) === String(right);

const matchesPrintTarget = (printer, target) => {
  if (!target || !printer) return false;
  if (target.windowsPrinterName && printer.windows_printer_name === target.windowsPrinterName) return true;
  const host = printer.ip_address || printer.host;
  return Boolean(target.host && host === target.host && (!target.port || Number(printer.port) === Number(target.port)));
};

/**
 * Choose where a failed job should be retried.
 *
 * Priority: verified-online original, verified-online assignment, any assignment
 * not known to be offline, the original even if it was marked offline, an
 * offline assignment, and finally the only printer assigned anywhere in the
 * property (legacy/mislabelled rows). A single-printer site must never be
 * blocked by a wrong assignment_type string, while a multi-printer site is
 * never silently cross-routed.
 */
export function pickRetryPrinter({ job = {}, printers = [], assignments = [] } = {}) {
  const list = (Array.isArray(printers) ? printers : []).filter(Boolean);
  const rows = (Array.isArray(assignments) ? assignments : []).filter(Boolean);
  const expectedType = normalizeAssignmentType(job?.assignment_type);

  const byId = list.find((printer) => sameId(printer.id, job?.printer_id)) || null;
  const byTarget = byId ? null : list.find((printer) => matchesPrintTarget(printer, job?.payload?.printTarget)) || null;
  const original = byId || byTarget;

  const assignedForType = rows
    .filter((row) => normalizeAssignmentType(row.assignment_type) === expectedType)
    .map((row) => list.find((printer) => sameId(printer.id, row.printer_id)))
    .filter(Boolean);
  const allAssigned = rows
    .map((row) => list.find((printer) => sameId(printer.id, row.printer_id)))
    .filter(Boolean);
  const uniqueAssigned = [...new Map(allAssigned.map((printer) => [printer.id, printer])).values()];

  const candidates = [];
  const push = (printer) => {
    if (printer && !candidates.some((candidate) => candidate.id === printer.id)) candidates.push(printer);
  };

  if (original && isVerifiedOnline(original)) push(original);
  assignedForType.filter(isVerifiedOnline).forEach(push);
  assignedForType.filter(isNotKnownOffline).forEach(push);
  push(original);
  assignedForType.forEach(push);
  if (uniqueAssigned.length === 1) push(uniqueAssigned[0]);
  return candidates[0] || null;
}
