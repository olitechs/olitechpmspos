import { formatReportValue } from '@/services/reportDefinitions';

export default function ReportDataTable({ section, emptyMessage = 'No data is available for the selected filters.' }) {
  const columns = section?.columns || [];
  const rows = section?.rows || [];
  if (!section || !columns.length) return <div role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-muted)]">Report table is not available.</div>;

  return <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
    <table className="w-full min-w-[640px] border-collapse text-sm">
      <caption className="border-b border-[var(--border)] px-4 py-3 text-left text-sm font-semibold text-[var(--text)]">{section.title}</caption>
      <thead><tr className="bg-[var(--sidebar)]">
        {columns.map((column) => <th key={column.key} scope="col" className={`whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-[var(--text)] ${column.align === 'right' ? 'text-right' : ''}`}>{column.label}</th>)}
      </tr></thead>
      <tbody>
        {rows.map((row, index) => <tr key={row.id || row.key || `${section.name}-${index}`} className="border-t border-[var(--border)] even:bg-[var(--soft-white)]">
          {columns.map((column) => <td key={column.key} className={`max-w-[28rem] px-3 py-2 align-top text-[var(--text)] ${column.align === 'right' || column.type === 'number' ? 'text-right tabular-nums' : ''}`}>
            {formatReportValue(row[column.key], column)}
          </td>)}
        </tr>)}
        {!rows.length && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">{emptyMessage}</td></tr>}
      </tbody>
    </table>
  </div>;
}
