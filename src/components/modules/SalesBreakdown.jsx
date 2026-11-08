import { useEffect, useMemo, useState } from 'react';
import { BarChart3, PackageSearch, RefreshCw, Users } from 'lucide-react';
import { reportingService } from '@/services/reportingService';
import {
  buildMonthlySalesByCategoryDefinition,
  buildMonthlySalesByItemDefinition,
  buildMonthlySalesByShiftDefinition,
  buildSalesByPaymentTypeDefinition,
} from '@/services/reportDefinitions';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import ReportDataTable from '@/components/shared/ReportDataTable';

const OPTIONS = [
  { id: 'item', label: 'By item', icon: PackageSearch },
  { id: 'category', label: 'By category', icon: BarChart3 },
  { id: 'shift', label: 'By shift', icon: Users },
  { id: 'payment', label: 'By payment type', icon: BarChart3 },
];

export default function SalesBreakdown({ propertyId, propertyName, generatedBy, from, to, paymentRows = [] }) {
  const [type, setType] = useState('item');
  const [definition, setDefinition] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    setDefinition(null);
    if (type === 'payment') {
      setLoading(false);
      setDefinition(buildSalesByPaymentTypeDefinition({ payments: paymentRows, from, to, propertyName, generatedBy }));
      return () => { active = false; };
    }
    setLoading(true);
    setProgress(0);
    reportingService.getPostedSalesReceipts(propertyId, from, to, (count) => {
      if (active) setProgress(count);
    }).then(({ receipts, shifts }) => {
      if (!active) return;
      const args = { receipts, shifts, from, to, propertyName, generatedBy };
      const report = type === 'category' ? buildMonthlySalesByCategoryDefinition(args)
        : type === 'shift' ? buildMonthlySalesByShiftDefinition(args)
          : buildMonthlySalesByItemDefinition(args);
      setDefinition(report);
    }).catch((cause) => {
      if (active) setError(cause?.message || 'Sales breakdown could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [propertyId, propertyName, generatedBy, from, to, type, paymentRows, requestVersion]);

  const section = definition?.sections?.find((item) => item.pdf !== false) || definition?.sections?.[0];
  const selected = useMemo(() => OPTIONS.find((option) => option.id === type), [type]);

  return <section className="space-y-4">
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-base font-semibold text-[var(--text)]">Monthly sales breakdown</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Selected period: {from} to {to}. Tables and downloads use the same report definition.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setRequestVersion((value) => value + 1)} disabled={loading || type === 'payment'} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--text)] disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>Refresh</button>
        <DocumentExportMenu definition={definition} label="Export breakdown" disabled={!definition || loading} />
      </div>
    </div>

    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sales breakdown report">
      {OPTIONS.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={type === id} onClick={() => setType(id)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${type === id ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--sidebar)]'}`}><Icon size={15}/>{label}</button>)}
    </div>

    {loading && <div role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">Loading posted receipt data{progress ? ` · ${progress.toLocaleString()} receipts read` : '…'} No rows are omitted silently.</div>}
    {error && <div role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger-text)]">{error}</div>}
    {definition && !loading && <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{definition.summary.map((item) => <div key={item.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs font-medium text-[var(--text-muted)]">{item.label}</div><div className="mt-1 text-lg font-semibold tabular-nums text-[var(--deep-lagoon)]">{item.format === 'currency' ? `KES ${Number(item.value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Number(item.value || 0).toLocaleString('en-KE')}</div></div>)}</div>
      {section && <ReportDataTable section={section} emptyMessage={`No ${selected?.label?.toLowerCase() || 'sales'} data for this period.`} />}
      {definition.notes?.map((note) => <p key={note} className="text-xs leading-5 text-[var(--text-muted)]">{note}</p>)}
    </>}
  </section>;
}
