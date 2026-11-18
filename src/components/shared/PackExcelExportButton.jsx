import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';

// Small wrapper around the pack workbook builders: handles the busy state and
// surfaces a readable error instead of an unhandled promise rejection.
export default function PackExcelExportButton({
  label = 'Export to Excel',
  disabled = false,
  run,
  className = '',
  icon: Icon = FileSpreadsheet,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await run?.();
      if (result?.filename) setNotice(`Saved ${result.filename}`);
    } catch (cause) {
      setError(cause?.message || 'The Excel export could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return <div className={`inline-flex flex-col items-start ${className}`}>
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--sidebar)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? <Download size={15} className="animate-pulse" /> : <Icon size={15} />}
      {busy ? 'Building Excel…' : label}
    </button>
    {error && <p role="alert" className="mt-2 max-w-xs text-xs text-[var(--danger-text)]">{error}</p>}
    {notice && <p role="status" className="mt-2 max-w-xs text-xs text-[var(--text-muted)]">{notice}</p>}
  </div>;
}
