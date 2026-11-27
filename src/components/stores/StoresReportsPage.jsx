import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import storesService from '@/services/storesService';
import ReportDataTable from '@/components/shared/ReportDataTable';
import {
  buildStoresRequisitionRegisterDefinition,
  buildStoresIssueRegisterDefinition,
  buildStoresTransferRegisterDefinition,
} from '@/services/reportDefinitions';
import { executeAuditedReportExport } from '@/services/reportExportService';

const FIELD = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]';
const PANEL = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';
const TABS = [
  ['requisitions', 'Requisitions'],
  ['issues', 'Issue notes'],
  ['transfers', 'Transfers'],
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}

export default function StoresReportsPage({ initialTab = 'requisitions' }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;

  const [tab, setTab] = useState(TABS.some(([value]) => value === initialTab) ? initialTab : 'requisitions');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState([]);
  const [cap, setCap] = useState(500);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTab(TABS.some(([value]) => value === initialTab) ? initialTab : 'requisitions');
  }, [initialTab]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    if (from && to && from > to) {
      setError('The start date must be on or before the end date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = tab === 'requisitions'
        ? await storesService.listRequisitionReport(propertyId, { from, to })
        : tab === 'transfers'
          ? await storesService.listTransferReport(propertyId, { from, to })
          : await storesService.listIssueNoteReport(propertyId, { from, to });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setCap(Number(data?.cap) || 500);
      setTruncated(Boolean(data?.truncated));
    } catch (err) {
      setError(err?.message || 'Unable to load this report.');
      setRows([]);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, [propertyId, tab, from, to]);

  useEffect(() => { load(); }, [load]);

  const definition = useMemo(() => {
    const context = {
      rows,
      from,
      to,
      propertyName: user?.property?.name || 'Property',
      generatedBy: user?.name || user?.email || 'Authorized user',
      truncated,
      cap,
    };
    if (tab === 'requisitions') return buildStoresRequisitionRegisterDefinition(context);
    if (tab === 'transfers') return buildStoresTransferRegisterDefinition(context);
    return buildStoresIssueRegisterDefinition(context);
  }, [tab, rows, from, to, user, truncated, cap]);

  const exportCsv = async () => {
    if (!definition.sections[0]?.rows?.length) {
      toast.error('There is nothing to export for this period.');
      return;
    }
    setExporting(true);
    try {
      await executeAuditedReportExport({
        definition,
        format: 'csv',
        userId: user?.id || user?.user_id || user?.staff?.user_id,
        propertyId,
      });
      toast.success('Report exported and recorded in Audit Log.');
    } catch (err) {
      toast.error(err?.message || 'The CSV export could not be recorded.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-full bg-[var(--canvas)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-normal text-[var(--text)]">Stores reports</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Requisition, issue and transfer registers for the selected period. Costs are excluded from these registers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={exporting || loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95 disabled:opacity-50"
            >
              <Download size={16} /> {exporting ? 'Recording export…' : 'Export CSV'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-text)]" role="alert">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {truncated ? (
          <div className={`${PANEL} border-[var(--warning)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-text)]`} role="status">
            Report truncated: only the first {cap} server-filtered rows are included. Narrow the date range to include every matching record. This banner is included in CSV, Excel and PDF exports.
          </div>
        ) : null}

        <div className={`${PANEL} p-3 sm:p-4`}>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_160px]">
            <div className="flex rounded-md border border-[var(--border)] p-1" role="tablist" aria-label="Stores report">
              {TABS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`min-h-10 flex-1 rounded px-3 text-sm font-medium ${tab === value ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              From
              <input type="date" className={FIELD} value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
              To
              <input type="date" className={FIELD} value={to} min={from} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {definition.summary.map((item) => (
            <div key={item.label} className={`${PANEL} p-4`}>
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{item.label}</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text)]">
                {Number(item.value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className={`${PANEL} p-6`}>
            <div className="mb-3 flex items-center gap-2 text-sm text-[var(--text-muted)]"><BarChart3 size={18} /> Loading report…</div>
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-10 animate-pulse rounded bg-[var(--border)]/40" />)}
            </div>
          </div>
        ) : (
          <>
            <ReportDataTable section={definition.sections[0]} emptyMessage="No records fall inside this period." />
            {definition.notes.length > 0 ? (
              <ul className={`${PANEL} list-disc space-y-1 px-8 py-4 text-xs text-[var(--text-muted)]`}>
                {definition.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
