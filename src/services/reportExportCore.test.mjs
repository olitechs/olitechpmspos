import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportExportAuditEvent } from './reportExportAuditCore.js';
import { createAuditedReportExecutor } from './reportExportCore.js';

const definition = {
  key: 'management-report',
  title: 'Management Report',
  period: { from: '2026-10-01', to: '2026-10-31' },
  filters: { period: 'October', guest_email: 'private@example.test' },
  sections: [
    { name: 'summary', rows: [{ metric: 'Net', value: 100 }] },
    { name: 'details', pdf: false, rows: [{ id: 1 }, { id: 2 }] },
  ],
};

function harness(overrides = {}) {
  const calls = [];
  const executor = createAuditedReportExecutor({
    async createDocument(options) {
      calls.push(['create', options.format, Boolean(options.blobBuilder)]);
      return overrides.content === undefined ? new Blob(['document']) : overrides.content;
    },
    async recordAudit(event) {
      // Mirror the production audit writer, which persists a sanitized event.
      calls.push(['audit', buildReportExportAuditEvent(event)]);
      if (overrides.auditError) throw overrides.auditError;
    },
    async deliver(options) {
      calls.push(['deliver', options.delivery, options.filename]);
    },
  });
  return { executor, calls };
}

test('audited exporter validates definition, format and print-preview delivery', async () => {
  const { executor } = harness();
  await assert.rejects(() => executor({ definition: { key: 'x' }, format: 'pdf' }), /complete report definition/);
  await assert.rejects(() => executor({ definition, format: 'print' }), /Unsupported audited report format/);
  await assert.rejects(() => executor({ definition, format: 'csv', delivery: 'print-preview' }), /Only PDF reports/);
});

test('audited exporter audits once before delivery and returns the normalized result', async () => {
  const { executor, calls } = harness();
  const result = await executor({
    definition,
    format: 'CSV',
    userId: 'user-1',
    propertyId: 'property-1',
    rowCount: 7,
  });
  assert.deepEqual(result, { filename: 'OliTechs_Management-Report_2026-10-01-to-2026-10-31.csv', format: 'csv', rowCount: 7 });
  assert.deepEqual(calls.map((call) => call[0]), ['create', 'audit', 'deliver']);
  assert.deepEqual(calls[1][1], {
    report_key: 'management-report',
    file_format: 'csv',
    delivery: 'download',
    row_count: 7,
    filters: { period: 'October' },
  });
  assert.deepEqual(calls[2].slice(1), ['download', result.filename]);
});

test('audited exporter counts included rows for each format and honours a prebuilt blob', async () => {
  for (const [format, expectedRows] of [['pdf', 1], ['csv', 3], ['xlsx', 3]]) {
    const { executor, calls } = harness();
    const blob = new Blob([format]);
    await executor({ definition, format, blob, filename: `custom.${format}` });
    assert.equal(calls[0][2], false, 'a prebuilt blob must not call the document builder');
    assert.equal(calls[1][1].row_count, expectedRows);
    assert.equal(calls[1][1].filters.guest_email, undefined, 'audit filters must stay allowlisted');
    assert.equal(calls[2][2], `custom.${format}`);
  }
});

test('a failed audit never delivers the report document', async () => {
  const { executor, calls } = harness({ auditError: new Error('Audit Log unavailable') });
  await assert.rejects(() => executor({ definition, format: 'pdf' }), /Audit Log unavailable/);
  assert.deepEqual(calls.map((call) => call[0]), ['create', 'audit']);
});

test('print preview uses the same audited PDF path', async () => {
  const { executor, calls } = harness();
  const printWindow = { closed: false };
  await executor({ definition, format: 'pdf', delivery: 'print-preview', printWindow });
  assert.deepEqual(calls.map((call) => call[0]), ['create', 'audit', 'deliver']);
  assert.equal(calls[1][1].delivery, 'print-preview');
  assert.equal(calls[2][1], 'print-preview');
});
