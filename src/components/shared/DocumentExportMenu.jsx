import { useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { createExcelBlob, createPdfBlob, downloadBlob, openPdfPreview, reportFilename } from '@/services/reportDocumentEngine';
import { reportExportAuditService } from '@/services/reportExportAuditService';

const ACTIONS = {
  pdf: { label: 'Download PDF', icon: FileText },
  excel: { label: 'Download Excel', icon: FileSpreadsheet },
  print: { label: 'Print PDF', icon: Printer },
};

export default function DocumentExportMenu({
  definition,
  getDefinition,
  label = 'Export',
  formats = ['pdf', 'excel', 'print'],
  disabled = false,
  className = '',
  onError,
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const availableFormats = formats.filter((format) => ACTIONS[format]);

  const runExport = async (format) => {
    setOpen(false);
    setError('');
    setNotice('');
    let printWindow = null;
    if (format === 'print') {
      printWindow = window.open('about:blank', '_blank');
      if (!printWindow) {
        setError('The print-preview window was blocked. Allow pop-ups and try again.');
        return;
      }
      printWindow.opener = null;
      printWindow.document.title = 'Preparing OliTechs report';
      printWindow.document.body.textContent = 'Preparing the generated PDF…';
    }

    setBusy(true);
    setProgress('Loading report data…');
    try {
      const report = typeof getDefinition === 'function' ? await getDefinition((status) => setProgress(String(status || 'Loading report data…'))) : definition;
      if (!report?.key) throw new Error('Report data is not ready. Refresh the report and try again.');
      setProgress(format === 'excel' ? 'Building Excel workbook…' : 'Building PDF…');
      const blob = format === 'excel' ? await createExcelBlob(report) : await createPdfBlob(report);
      const rowCount = (report.sections || [])
        .filter((section) => format === 'excel' || section.pdf !== false)
        .reduce((total, section) => total + (section.rows?.length || 0), 0);
      setProgress('Recording Audit Log…');
      const userId = user?.id || user?.user_id || user?.staff?.user_id;
      const propertyId = user?.property?.id || user?.property_id;
      await reportExportAuditService.record({
        userId,
        propertyId,
        definition: report,
        format: format === 'excel' ? 'xlsx' : 'pdf',
        rowCount,
        delivery: format === 'print' ? 'print-preview' : 'download',
      });
      if (format === 'print') openPdfPreview(blob, printWindow);
      else downloadBlob(blob, reportFilename(report, format === 'excel' ? 'xlsx' : 'pdf'));
      setNotice(`${report.title} ${format === 'print' ? 'opened in print preview' : 'download started'}.`);
    } catch (cause) {
      if (printWindow && !printWindow.closed) printWindow.close();
      const message = cause?.message || 'The report could not be exported.';
      setError(message);
      onError?.(cause);
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div className={`relative inline-flex flex-col items-start ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy || (!definition && !getDefinition)}
        onClick={() => { setOpen((value) => !value); setError(''); setNotice(''); }}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--sidebar)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Download size={15} className="animate-pulse" /> : <FileSpreadsheet size={15} />}
        {busy ? progress || 'Preparing…' : label}
        <ChevronDown size={14} />
      </button>
      {open && <div role="menu" className="absolute right-0 top-full z-50 mt-2 min-w-48 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg">
        {availableFormats.map((format) => {
          const ActionIcon = ACTIONS[format].icon;
          return <button key={format} type="button" role="menuitem" onClick={() => runExport(format)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--sidebar)]">
            <ActionIcon size={15} className="text-[var(--primary)]" />{ACTIONS[format].label}
          </button>;
        })}
      </div>}
      {error && <p role="alert" className="mt-2 max-w-xs text-xs text-[var(--danger-text)]">{error}</p>}
      {notice && <p role="status" className="mt-2 max-w-xs text-xs text-[var(--text-muted)]">{notice}</p>}
    </div>
  );
}
