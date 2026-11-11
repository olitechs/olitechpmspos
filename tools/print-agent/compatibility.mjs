/**
 * The printer compatibility matrix and the evidence log that backs it.
 *
 * Two different things live here, and the difference matters:
 *
 *  - `MATRIX` is what we *expect* from each printer family, based on its
 *    documented ESC/POS behaviour. It is a starting point, not a guarantee.
 *  - `records` are what a technician actually saw on a site visit. Only a
 *    record with every required check passing counts as validated.
 *
 * Nothing in this module ever invents a record. The shipped evidence file is
 * empty, and a test asserts that it stays that way until someone records real
 * hardware.
 */

export const EVIDENCE_VERSION = 1;

export const PAPER_WIDTHS = Object.freeze(['58mm', '80mm']);
export const TRANSPORTS = Object.freeze(['network_ip', 'windows_printer', 'usb', 'bluetooth', 'serial']);
export const EXPECTATIONS = Object.freeze(['supported', 'conditional', 'unsupported']);
export const RESULT_VALUES = Object.freeze(['pass', 'fail', 'not-tested']);

export const TRANSPORT_LABELS = Object.freeze({
  network_ip: 'LAN 9100',
  windows_printer: 'Windows driver',
  usb: 'USB (WebUSB)',
  bluetooth: 'Bluetooth',
  serial: 'Serial/COM',
});

/**
 * Required checks are the go-live gate: a printer that cannot reprint or
 * recover a queued job after a restart is not fit for a trading hotel, however
 * nice the test page looks.
 */
export const CHECKS = Object.freeze([
  { id: 'test_page', label: 'Test page prints and cuts', required: true },
  { id: 'receipt', label: 'Final receipt prints with correct columns and totals', required: true },
  { id: 'reprint', label: 'A failed job can be reprinted from the app', required: true },
  { id: 'offline_recovery', label: 'A job queued while the printer was off prints when it returns', required: true },
  { id: 'restart_recovery', label: 'A queued job survives an agent/service restart', required: true },
  { id: 'order_ticket', label: 'Kitchen/bar ticket prints', required: false },
  { id: 'cash_drawer', label: 'Cash drawer opens from this printer', required: false },
  { id: 'cut_calibration', label: 'Cut position is correct after feed-dot calibration', required: false },
]);

export const REQUIRED_CHECKS = Object.freeze(CHECKS.filter((check) => check.required).map((check) => check.id));

export const MATRIX = Object.freeze([
  {
    id: 'epson-tm-t20iii',
    model: 'Epson TM-T20III',
    vendor: 'Epson',
    transports: ['network_ip', 'windows_printer'],
    paper: ['80mm', '58mm'],
    expectation: 'supported',
    note: 'Documented ESC/POS. Default GS V 66 cut; drawer pulse works when the drawer cable is in the printer kick port.',
  },
  {
    id: 'epson-tm-t82iii',
    model: 'Epson TM-T82III',
    vendor: 'Epson',
    transports: ['network_ip', 'windows_printer'],
    paper: ['80mm'],
    expectation: 'supported',
    note: 'Same command set as the T20. 80mm, 48-column layout.',
  },
  {
    id: 'epson-tm-t88vi',
    model: 'Epson TM-T88VI',
    vendor: 'Epson',
    transports: ['network_ip', 'windows_printer'],
    paper: ['80mm'],
    expectation: 'supported',
    note: 'Faster cutter; check the cut position on first install.',
  },
  {
    id: 'xprinter-xp-80c',
    model: 'Xprinter XP-80C',
    vendor: 'Xprinter',
    transports: ['network_ip', 'windows_printer'],
    paper: ['80mm'],
    expectation: 'supported',
    note: 'Some units need the older ESC i or ESC m cut command; choose it in printer settings if GS V does not cut.',
  },
  {
    id: 'xprinter-xp-58iih',
    model: 'Xprinter XP-58IIH',
    vendor: 'Xprinter',
    transports: ['network_ip', 'windows_printer'],
    paper: ['58mm'],
    expectation: 'supported',
    note: '58mm, 32 columns by default.',
  },
  {
    id: 'bixolon-srp-350iii',
    model: 'Bixolon SRP-350III',
    vendor: 'Bixolon',
    transports: ['network_ip', 'windows_printer'],
    paper: ['80mm'],
    expectation: 'supported',
    note: 'ESC/POS compatible; confirm the cutter mode on first install.',
  },
  {
    id: 'star-tsp143iv',
    model: 'Star TSP143IV',
    vendor: 'Star Micronics',
    transports: ['windows_printer'],
    paper: ['80mm'],
    expectation: 'conditional',
    note: 'Star raster/driver firmware does not accept the raw ESC/POS text stream on every unit. Only the Windows-driver path is documented, and the agent does not pulse the drawer on this printer.',
  },
  {
    id: 'generic-escpos-58-80',
    model: 'Unbranded ESC/POS 58mm/80mm clone',
    vendor: 'Generic',
    transports: ['network_ip', 'windows_printer'],
    paper: ['58mm', '80mm'],
    expectation: 'conditional',
    note: 'Clones vary in codepage and cutter command. Treated as conditional until a site record passes every required check.',
  },
  {
    id: 'gdi-only-office-printer',
    model: 'GDI-only office printer (e.g. small laser)',
    vendor: 'Any',
    transports: ['windows_printer'],
    paper: ['80mm'],
    expectation: 'unsupported',
    note: 'A driver-only GDI printer cannot interpret ESC/POS bytes; receipts come out blank or as garbage. Use a thermal ESC/POS printer.',
  },
]);

const SENSITIVE_KEY = /(password|secret|token|credential|api[_-]?key|pairing|authorization|escpos|content_html)/i;
const SECRET_VALUE = /eyJ[A-Za-z0-9_-]{12,}|(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{6,}/;

export class EvidenceError extends Error {
  constructor(message, { field = null, code = 'INVALID_EVIDENCE' } = {}) {
    super(message);
    this.name = 'EvidenceError';
    this.field = field;
    this.code = code;
  }
}

const fail = (field, message, code = 'INVALID_EVIDENCE') => {
  throw new EvidenceError(message, { field, code });
};

export function findMatrixEntry(modelId, matrix = MATRIX) {
  return matrix.find((entry) => entry.id === modelId) || null;
}

/**
 * Walks the whole record, not just known fields: a well-meaning technician
 * pasting a curl command or the receipt text into `notes` must be stopped
 * before it reaches a file that gets emailed around.
 */
export function assertNoSecrets(value, path = 'record') {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        fail(`${path}.${key}`, `Remove "${key}" from the evidence record: it must never contain credentials, receipt contents or raw print data.`, 'SENSITIVE_FIELD');
      }
      assertNoSecrets(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value)) {
    fail(path, 'This value looks like a credential. Remove it before saving the record.', 'SENSITIVE_VALUE');
  }
}

export function evidenceStatus(record) {
  const checks = record?.checks || {};
  const requiredFailed = REQUIRED_CHECKS.some((id) => checks[id] !== 'pass');
  if (requiredFailed) return 'failed';
  const optionalNotPassed = CHECKS.some((check) => !check.required && checks[check.id] !== 'pass');
  return optionalNotPassed ? 'conditional' : 'validated';
}

export function validateEvidence(record, { matrix = MATRIX, now = Date.now() } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('record', 'An evidence record must be a JSON object.');
  }
  assertNoSecrets(record);

  for (const key of ['id', 'modelId', 'site', 'workstation', 'agentVersion', 'windowsVersion', 'transport', 'paperWidth']) {
    if (!String(record[key] ?? '').trim()) fail(key, `"${key}" is required; a record without it cannot be matched to a printer.`);
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(record.id)) {
    fail('id', 'Use a lowercase id such as "acme-hotel-kitchen-2026-11". It must be unique in the log.');
  }
  if (!TRANSPORTS.includes(record.transport)) {
    fail('transport', `Unknown transport "${record.transport}". Use one of: ${TRANSPORTS.join(', ')}.`);
  }
  if (!PAPER_WIDTHS.includes(record.paperWidth)) {
    fail('paperWidth', `Unknown paper width "${record.paperWidth}". Use one of: ${PAPER_WIDTHS.join(', ')}.`);
  }
  const recordedAt = Date.parse(record.recordedAt || '');
  if (!Number.isFinite(recordedAt)) fail('recordedAt', 'recordedAt must be an ISO date and time, for example 2026-11-11T09:30:00.000Z.');
  if (recordedAt > now + 86400000) fail('recordedAt', 'recordedAt cannot be in the future.');

  const entry = findMatrixEntry(record.modelId, matrix);
  if (!entry) {
    fail('modelId', `"${record.modelId}" is not in the compatibility matrix. Add the printer to MATRIX first, so evidence cannot exist for a model we have never described.`);
  }
  if (!entry.transports.includes(record.transport)) {
    fail('transport', `${entry.model} is not documented on ${record.transport}. The matrix lists: ${entry.transports.join(', ')}.`);
  }

  if (!record.checks || typeof record.checks !== 'object' || Array.isArray(record.checks)) {
    fail('checks', 'checks must be an object of check name to result.');
  }
  const known = new Set(CHECKS.map((check) => check.id));
  for (const [id, result] of Object.entries(record.checks)) {
    if (!known.has(id)) fail(`checks.${id}`, `Unknown check "${id}". Run the checks listed in docs/print-agent/PRINTER-COMPATIBILITY-MATRIX.md.`);
    if (!RESULT_VALUES.includes(result)) {
      fail(`checks.${id}`, `Result must be one of: ${RESULT_VALUES.join(', ')}.`);
    }
  }
  for (const id of REQUIRED_CHECKS) {
    if (!(id in record.checks)) {
      fail(`checks.${id}`, `The required check "${id}" is missing, so this record cannot count as validation.`);
    }
  }
  if (String(record.notes ?? '').length > 1000) {
    fail('notes', 'Keep notes under 1000 characters; attach photos separately and list their filenames.');
  }

  return { ...record, status: evidenceStatus(record) };
}

export function normalizeEvidenceLog(log, options = {}) {
  if (!log || typeof log !== 'object' || Array.isArray(log)) fail('log', 'The evidence log must be an object.');
  if (log.version !== EVIDENCE_VERSION) {
    fail('version', `The evidence log version must be ${EVIDENCE_VERSION}.`);
  }
  if (!Array.isArray(log.records)) fail('records', 'The evidence log needs a records array.');
  const ids = new Set();
  const records = log.records.map((record, index) => {
    const valid = validateEvidence(record, options);
    if (ids.has(valid.id)) fail('id', `Duplicate record id "${valid.id}" in the log.`);
    ids.add(valid.id);
    return { ...valid, index };
  });
  return { version: log.version, records };
}

/** Pure append: returns a new log and never mutates the one passed in. */
export function appendEvidenceLog(log, record, options = {}) {
  const current = normalizeEvidenceLog(log, options);
  const valid = validateEvidence(record, options);
  if (current.records.some((existing) => existing.id === valid.id)) {
    fail('id', `A record with id "${valid.id}" already exists. Choose a new id instead of overwriting evidence.`, 'DUPLICATE_ID');
  }
  const { index: _index, ...clean } = valid;
  return { ...current, records: [...current.records.map(({ index: _i, ...rest }) => rest), clean] };
}

const STATUS_RANK = { validated: 3, conditional: 2, failed: 1, 'no-evidence': 0 };

export function summarizeCompatibility(matrix = MATRIX, records = []) {
  const byModel = {};
  for (const entry of matrix) {
    byModel[entry.id] = {
      model: entry.model,
      expectation: entry.expectation,
      evidence: 'no-evidence',
      records: 0,
      lastRecordedAt: null,
      failingChecks: [],
    };
  }

  for (const record of Array.isArray(records) ? records : []) {
    const bucket = byModel[record?.modelId];
    if (!bucket) continue;
    const status = record.status || evidenceStatus(record);
    bucket.records += 1;
    if (STATUS_RANK[status] > STATUS_RANK[bucket.evidence]) bucket.evidence = status;
    if (!bucket.lastRecordedAt || Date.parse(record.recordedAt || 0) > Date.parse(bucket.lastRecordedAt)) {
      bucket.lastRecordedAt = record.recordedAt || null;
    }
    bucket.failingChecks = REQUIRED_CHECKS.filter((id) => (record.checks || {})[id] !== 'pass');
  }

  const totals = { models: matrix.length, validated: 0, conditional: 0, failed: 0, noEvidence: 0 };
  const gaps = [];
  for (const entry of matrix) {
    const bucket = byModel[entry.id];
    if (bucket.evidence === 'validated') totals.validated += 1;
    else if (bucket.evidence === 'conditional') totals.conditional += 1;
    else if (bucket.evidence === 'failed') totals.failed += 1;
    else totals.noEvidence += 1;
    if (entry.expectation === 'supported' && bucket.evidence !== 'validated') gaps.push(entry.id);
  }

  return { byModel, totals, gaps, goLiveReady: gaps.length === 0 };
}

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|');

export function renderStatusMarkdown({ matrix = MATRIX, records = [], generatedAt = null } = {}) {
  const summary = summarizeCompatibility(matrix, records);
  const lines = [
    '# Printer compatibility status',
    '',
    'Generated from `tools/print-agent/compatibility.mjs` and the site evidence log.',
    'An empty Evidence column means **no real hardware has been validated in this build** — it does not mean unsupported.',
    '',
    '| Model | Connects via | Paper | Expected | Evidence | Last recorded |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of matrix) {
    const bucket = summary.byModel[entry.id];
    const transports = entry.transports.map((id) => TRANSPORT_LABELS[id] || id).join(', ');
    lines.push(`| ${cell(entry.model)} | ${cell(transports)} | ${cell(entry.paper.join(', '))} | ${cell(entry.expectation)} | ${cell(bucket.evidence)} | ${cell(bucket.lastRecordedAt ? bucket.lastRecordedAt.slice(0, 10) : '—')} |`);
  }

  lines.push('', '## Go-live gaps', '');
  if (summary.goLiveReady) {
    lines.push('None — every supported model has a validated site record.');
  } else {
    lines.push(`${summary.gaps.length} supported model${summary.gaps.length === 1 ? '' : 's'} without validated evidence:`);
    lines.push('');
    for (const id of summary.gaps) {
      const entry = findMatrixEntry(id, matrix);
      lines.push(`- ${entry.model} (\`${id}\`)`);
    }
    lines.push('', 'A hotel cannot go live on a printer that is in this list. Record a site visit with `npm run print-agent:compatibility record <file>.json`.');
  }

  if (generatedAt) lines.push('', `_Generated ${generatedAt}._`);
  return `${lines.join('\n')}\n`;
}
