import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HISTORY_WINDOW_DAYS,
  groupJobsByPrinter,
  historyWindowStart,
  jobStatusLabel,
  jobTone,
  recentPrinterJobs,
  summarizeAllPrinters,
  summarizePrinterHistory,
  tidyError,
} from './printerHistoryCore.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const NOW = new Date('2026-11-11T12:00:00.000Z');
const daysAgo = (days, hour = 12) => new Date(NOW.getTime() - days * 86400000 + (hour - 12) * 3600000).toISOString();

const job = (overrides = {}) => ({
  id: `job-${Math.random().toString(36).slice(2, 8)}`,
  printer_id: 'printer-1',
  status: 'printed',
  title: 'Order ticket',
  assignment_type: 'food_orders',
  copy_type: null,
  error_message: null,
  created_at: daysAgo(1),
  printed_at: daysAgo(1),
  ...overrides,
});

test('a printer with no jobs is idle, not broken', () => {
  const summary = summarizePrinterHistory([], { now: NOW });
  assert.equal(summary.tone, 'idle');
  assert.match(summary.headline, /No print jobs in the last 7 days/);
  assert.equal(summary.successRate, null);
  assert.equal(summary.total, 0);
});

test('a week of clean printing reads as healthy with a success rate', () => {
  const summary = summarizePrinterHistory(
    Array.from({ length: 6 }, () => job()),
    { now: NOW },
  );
  assert.equal(summary.tone, 'ok');
  assert.equal(summary.counts.printed, 6);
  assert.equal(summary.successRate, 100);
  assert.match(summary.headline, /All 6 jobs printed in the last 7 days/);
});

test('one older failure is a warning and shows the printer message, not a stack trace', () => {
  const jobs = [
    job({ status: 'printed', created_at: daysAgo(0, 9) }),
    job({ status: 'failed', created_at: daysAgo(2), error_message: '  Connection refused\n  at socket 192.168.1.50:9100  ' }),
    ...Array.from({ length: 7 }, (_, index) => job({ created_at: daysAgo(1 + index) })),
  ];
  const summary = summarizePrinterHistory(jobs, { now: NOW });
  assert.equal(summary.tone, 'warning');
  assert.match(summary.headline, /1 job did not print in the last 7 days/);
  assert.equal(summary.detail, 'Connection refused at socket 192.168.1.50:9100');
  assert.equal(summary.successRate, 89);
});

test('two failures in a row is a danger even when the week looks fine overall', () => {
  const jobs = [
    job({ status: 'failed', created_at: daysAgo(0, 10), error_message: 'Paper out' }),
    job({ status: 'failed', created_at: daysAgo(0, 9), error_message: 'Paper out' }),
    ...Array.from({ length: 20 }, (_, index) => job({ created_at: daysAgo(2 + index) })),
  ];
  const summary = summarizePrinterHistory(jobs, { now: NOW });
  assert.equal(summary.tone, 'danger');
  assert.equal(summary.streak, 2);
  assert.match(summary.headline, /2 jobs in a row did not print/);
  assert.equal(summary.detail, 'Paper out');
});

test('a printer mostly failing is a danger even without a streak', () => {
  const jobs = [
    job({ status: 'printed', created_at: daysAgo(0, 11) }),
    job({ status: 'failed', created_at: daysAgo(0, 10) }),
    job({ status: 'failed', created_at: daysAgo(0, 9) }),
    job({ status: 'failed', created_at: daysAgo(1) }),
  ];
  const summary = summarizePrinterHistory(jobs, { now: NOW });
  assert.equal(summary.tone, 'danger');
  assert.match(summary.headline, /3 of 4 jobs did not print/);
});

test('waiting jobs are reported as waiting, not as failures', () => {
  const summary = summarizePrinterHistory([
    job({ status: 'queued', created_at: daysAgo(0, 11) }),
    job({ status: 'printing', created_at: daysAgo(0, 10) }),
  ], { now: NOW });
  assert.equal(summary.tone, 'warning');
  assert.equal(summary.counts.waiting, 2);
  assert.equal(summary.counts.failed, 0);
  assert.match(summary.headline, /2 jobs waiting to print/);
});

test('jobs older than the window are ignored', () => {
  const summary = summarizePrinterHistory([
    job({ status: 'failed', created_at: daysAgo(HISTORY_WINDOW_DAYS + 3), error_message: 'old fault' }),
  ], { now: NOW });
  assert.equal(summary.total, 0);
  assert.equal(summary.tone, 'idle');
  assert.equal(summary.lastError, '');
});

test('history is grouped by printer and summarised per printer', () => {
  const jobs = [
    job({ printer_id: 'kitchen', created_at: daysAgo(0, 10) }),
    job({ printer_id: 'kitchen', status: 'failed', created_at: daysAgo(0, 9), error_message: 'Cover open' }),
    job({ printer_id: 'bar', created_at: daysAgo(0, 8) }),
    job({ printer_id: null, created_at: daysAgo(0, 8) }),
  ];
  const grouped = groupJobsByPrinter(jobs);
  assert.deepEqual(Object.keys(grouped).sort(), ['bar', 'kitchen']);

  const { summaries, totals, attention } = summarizeAllPrinters(
    [{ id: 'kitchen' }, { id: 'bar' }, { id: 'office' }],
    jobs,
    { now: NOW },
  );
  assert.equal(summaries.kitchen.tone, 'warning');
  assert.equal(summaries.bar.tone, 'ok');
  assert.equal(summaries.office.tone, 'idle');
  assert.deepEqual(totals, { ok: 1, warning: 1, danger: 0, idle: 1 });
  assert.equal(attention, 1);
});

test('the last five jobs are returned newest first', () => {
  const jobs = Array.from({ length: 8 }, (_, index) => job({ id: `job-${index}`, created_at: new Date(NOW.getTime() - index * 60000).toISOString() }));
  const recent = recentPrinterJobs(jobs, 5);
  assert.equal(recent.length, 5);
  assert.equal(recent[0].id, 'job-0');
  assert.deepEqual(recent.map((row) => row.id), ['job-0', 'job-1', 'job-2', 'job-3', 'job-4']);
});

test('errors are tidied to one short line', () => {
  assert.equal(tidyError('  line one\n\nline two  '), 'line one line two');
  assert.equal(tidyError(null), '');
  const long = 'x'.repeat(300);
  const tidied = tidyError(long, 40);
  assert.equal(tidied.length, 40);
  assert.ok(tidied.endsWith('…'));
});

test('the window start is seven days before now by default', () => {
  const start = historyWindowStart(NOW);
  assert.equal(start.toISOString(), '2026-11-04T12:00:00.000Z');
  assert.equal(jobStatusLabel('failed'), 'Did not print');
  assert.equal(jobTone('queued'), 'warning');
});

test('the printers page and the history query are wired together', () => {
  const page = read('../pages/SettingsPrinters.jsx');
  assert.match(page, /fetchPrinterHistory/);
  assert.match(page, /PrintHistoryPanel/);
  assert.match(page, /Save diagnostics file/);

  const service = read('./printerHistory.js');
  assert.match(service, /from\('fnb_print_jobs'\)/);
  assert.match(service, /\.eq\('property_id', propertyId\)/);
  assert.match(service, /\.gte\('created_at'/);
});
