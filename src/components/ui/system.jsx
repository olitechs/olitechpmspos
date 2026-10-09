import React from 'react';
import { Search } from 'lucide-react';

/**
 * Shared operational UI primitives.
 * Styling is driven by the semantic tokens in src/index.css so components
 * remain consistent in light and dark themes.
 */

export function PageHeader({ title, description, eyebrow, actions, children, className = '' }) {
  return (
    <header className={`mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`.trim()}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = '', as: Component = 'section', ...props }) {
  return <Component className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] ${className}`.trim()} {...props}>{children}</Component>;
}

export function CardHeader({ title, description, actions, className = '' }) {
  return (
    <div className={`flex flex-col gap-2 border-b border-[var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${className}`.trim()}>
      <div>{title && <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>}{description && <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>}</div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, detail, icon: Icon, trend, className = '' }) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-[var(--text)]">{value}</p>{detail && <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p>}</div>
        {Icon && <span className="rounded-md bg-[var(--surface-2)] p-2 text-[var(--muted)]"><Icon size={18} aria-hidden="true" /></span>}
      </div>
      {trend && <p className="mt-3 text-xs font-medium text-[var(--muted)]">{trend}</p>}
    </Card>
  );
}

const STATUS_TONES = {
  success: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  danger: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300',
  info: 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  neutral: 'bg-[var(--surface-2)] text-[var(--text)]',
};
export function StatusBadge({ children, status = 'neutral', className = '' }) {
  const tone = STATUS_TONES[status] || STATUS_TONES.neutral;
  return <span className={`inline-flex min-h-5 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone} ${className}`.trim()}>{children}</span>;
}

export function EmptyState({ title = 'Nothing here yet', description, action, icon: Icon, className = '' }) {
  return (
    <div className={`flex min-h-40 flex-col items-center justify-center px-5 py-8 text-center ${className}`.trim()}>
      {Icon && <Icon size={24} className="mb-3 text-[var(--muted)]" aria-hidden="true" />}
      <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-[var(--muted)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '', lines = 1, ...props }) {
  return (
    <div className={`animate-pulse space-y-2 ${className}`.trim()} aria-hidden="true" {...props}>
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <div key={index} className={`h-4 rounded bg-[var(--surface-2)] ${index === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'}`} />)}
    </div>
  );
}

export function FilterBar({ children, searchValue, onSearchChange, searchPlaceholder = 'Search…', className = '' }) {
  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center ${className}`.trim()}>
      {onSearchChange && <label className="relative min-w-0 flex-1 sm:max-w-xs"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" /><input value={searchValue ?? ''} onChange={event => onSearchChange(event.target.value)} placeholder={searchPlaceholder} className="h-9 w-full rounded-md border border-[var(--control-border)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]" /></label>}
      {children}
    </div>
  );
}

export function DataTable({ columns = [], rows = [], getRowKey, emptyTitle = 'No records found', emptyDescription, className = '', onRowClick }) {
  return (
    <div className={`w-full overflow-x-auto rounded-lg border border-[var(--border)] ${className}`.trim()}>
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--surface-2)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"><tr>{columns.map(column => <th key={column.key} scope="col" className={`whitespace-nowrap px-3 py-2.5 ${column.headerClassName || ''}`}>{column.header}</th>)}</tr></thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row, rowIndex) => <tr key={getRowKey ? getRowKey(row) : (row.id ?? rowIndex)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`bg-[var(--surface)] ${onRowClick ? 'cursor-pointer hover:bg-[var(--surface-2)]' : ''}`}>{columns.map(column => <td key={column.key} className={`px-3 py-2.5 align-middle text-[var(--text)] ${column.cellClassName || ''}`}>{column.render ? column.render(row, rowIndex) : row[column.key]}</td>)}</tr>)}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
    </div>
  );
}

export function ConfirmDialog({ open, title = 'Are you sure?', description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, destructive = false, busy = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel?.(); }}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby={description ? 'confirm-dialog-description' : undefined} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl">
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-[var(--text)]">{title}</h2>
        {description && <p id="confirm-dialog-description" className="mt-2 text-sm text-[var(--muted)]">{description}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onCancel} className="rounded-md border border-[var(--control-border)] px-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-60">{cancelLabel}</button><button type="button" disabled={busy} onClick={onConfirm} className={`rounded-md px-3 text-sm font-semibold disabled:opacity-60 ${destructive ? 'bg-[var(--danger)] text-white' : 'bg-[var(--action)] text-[var(--action-text)] hover:bg-[var(--action-hover)]'}`}>{busy ? 'Please wait…' : confirmLabel}</button></div>
      </section>
    </div>
  );
}

export function Drawer({ open, title, description, onClose, children, footer, side = 'right', width = 'max-w-xl' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex bg-black/40" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
      <aside role="dialog" aria-modal="true" aria-label={title} className={`flex h-full w-full flex-col bg-[var(--surface)] shadow-2xl ${width} ${side === 'left' ? 'mr-auto' : 'ml-auto'}`}>
        <header className="border-b border-[var(--border)] px-5 py-4"><div className="flex items-start justify-between gap-4"><div><h2 className="text-base font-semibold text-[var(--text)]">{title}</h2>{description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}</div><button type="button" onClick={onClose} aria-label="Close panel" className="rounded-md px-2 text-lg text-[var(--muted)] hover:bg-[var(--surface-2)]">×</button></div></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="border-t border-[var(--border)] p-4">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Tabs({ tabs = [], value, onChange, className = '' }) {
  return <div role="tablist" className={`flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--border)] ${className}`.trim()}>{tabs.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} onClick={() => onChange?.(tab.value)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${value === tab.value ? 'border-[var(--action)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>{tab.label}</button>)}</div>;
}

export function SegmentedControl({ options = [], value, onChange, className = '', ariaLabel = 'Choose an option' }) {
  return <div role="group" aria-label={ariaLabel} className={`inline-flex max-w-full flex-wrap rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1 ${className}`.trim()}>{options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange?.(option.value)} className={`rounded px-3 text-sm font-medium ${value === option.value ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{option.label}</button>)}</div>;
}

export function FormField({ label, htmlFor, hint, error, required = false, children, className = '' }) {
  return <div className={`min-w-0 space-y-1.5 ${className}`.trim()}>{label && <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--text)]">{label}{required && <span className="ml-1 text-[var(--danger)]" aria-hidden="true">*</span>}</label>}{children}{error ? <p role="alert" className="text-xs text-[var(--danger)]">{error}</p> : hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}</div>;
}
