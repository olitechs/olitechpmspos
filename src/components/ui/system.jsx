import React from 'react';
import { Check, Search } from 'lucide-react';

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
  // Keep status meaning tied to the same semantic tokens used by the rest of
  // the application; this prevents badges drifting between operational screens.
  success: 'bg-[var(--success-soft)] text-[var(--success-text)]',
  warning: 'bg-[var(--warning-soft)] text-[var(--warning-text)]',
  danger: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
  info: 'bg-[var(--primary-soft)] text-[var(--primary)]',
  neutral: 'bg-[var(--sidebar)] text-[var(--text)]',
  // Solid emphasis tone: always pair the fill with --on-primary.
  primary: 'bg-[var(--primary)] text-[var(--on-primary)]',
};
export function StatusBadge({ children, status = 'neutral', className = '' }) {
  const tone = STATUS_TONES[status] || STATUS_TONES.neutral;
  return <span className={`inline-flex min-h-5 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone} ${className}`.trim()}>{children}</span>;
}

/**
 * Solid chip. The fill/foreground pair is fixed here so a blue chip can never
 * inherit the navy body colour.
 */
export function Chip({ children, active = false, className = '', ...props }) {
  const tone = active
    ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)]'
    : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)]';
  return (
    <span className={`inline-flex min-h-6 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone} ${className}`.trim()} {...props}>
      {active && <Check size={12} aria-hidden="true" />}
      {children}
    </span>
  );
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

/**
 * Long values truncate with an ellipsis but always keep the full text in a
 * `title`, so a clipped name is still readable on hover / long-press.
 */
export function TruncatedCell({ children, className = '', title }) {
  const text = title ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : undefined);
  return <span className={`block min-w-0 truncate ${className}`.trim()} title={text}>{children}</span>;
}

/**
 * Responsive data table.
 *
 * The wrapper is the only scroll container (horizontal), so a table never
 * pushes the page sideways and never nests a second vertical scrollbar. With
 * `stickyFirstColumn` the identity column stays visible while the rest scrolls.
 */
export function DataTable({ columns = [], rows = [], getRowKey, emptyTitle = 'No records found', emptyDescription, className = '', onRowClick, stickyFirstColumn = false }) {
  return (
    <div className={`w-full overflow-x-auto overscroll-x-contain rounded-lg border border-[var(--border)] ${className}`.trim()}>
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead className="bg-[var(--surface-2)] text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          <tr>{columns.map((column, index) => <th key={column.key} scope="col" className={`whitespace-nowrap px-3 py-2.5 ${stickyFirstColumn && index === 0 ? 'sticky left-0 z-[1] bg-[var(--surface-2)]' : ''} ${column.headerClassName || ''}`}>{column.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row, rowIndex) => <tr key={getRowKey ? getRowKey(row) : (row.id ?? rowIndex)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`bg-[var(--surface)] ${onRowClick ? 'cursor-pointer hover:bg-[var(--surface-2)]' : ''}`}>{columns.map((column, index) => { const value = column.render ? column.render(row, rowIndex) : row[column.key]; return <td key={column.key} className={`px-3 py-2.5 align-middle text-[var(--text)] ${stickyFirstColumn && index === 0 ? 'sticky left-0 z-[1] bg-[var(--surface)]' : ''} ${column.cellClassName || ''}`}>{column.truncate ? <TruncatedCell className={column.truncateClassName}>{value}</TruncatedCell> : value}</td>; })}</tr>)}
        </tbody>
      </table>
      {rows.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
    </div>
  );
}

export function ConfirmDialog({ open, title = 'Are you sure?', description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, destructive = false, busy = false }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[var(--z-overlay)] bg-[var(--overlay-scrim)]" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel?.(); }} />
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby={description ? 'confirm-dialog-description' : undefined} className="modal-panel max-w-md">
        <header className="modal-header border-b border-[var(--border)] px-[var(--modal-pad)] py-4">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-[var(--text)]">{title}</h2>
        </header>
        {description && <div className="modal-body scroll-shadow-y px-[var(--modal-pad)] py-4"><p id="confirm-dialog-description" className="text-sm text-[var(--muted)]">{description}</p></div>}
        <footer className="modal-footer flex flex-col-reverse gap-2 border-t border-[var(--border)] px-[var(--modal-pad)] py-4 sm:flex-row sm:justify-end">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-md border border-[var(--control-border)] px-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-[var(--disabled-opacity)]">{cancelLabel}</button>
          <button type="button" disabled={busy} onClick={onConfirm} className={`min-h-11 rounded-md px-3 text-sm font-semibold disabled:opacity-[var(--disabled-opacity)] ${destructive ? 'bg-[var(--danger-text)] text-[var(--danger-foreground)]' : 'bg-[var(--action)] text-[var(--action-text)] hover:bg-[var(--action-hover)]'}`}>{busy ? 'Please wait…' : confirmLabel}</button>
        </footer>
      </section>
    </>
  );
}

export function Drawer({ open, title, description, onClose, children, footer, side = 'right', width = 'max-w-xl' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex bg-[var(--overlay-scrim)]" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}>
      <aside role="dialog" aria-modal="true" aria-label={title} className={`flex h-full max-h-[100dvh] w-full flex-col overflow-hidden bg-[var(--surface)] shadow-[var(--shadow-overlay)] ${width} ${side === 'left' ? 'mr-auto' : 'ml-auto'}`}>
        <header className="modal-header border-b border-[var(--border)] px-[var(--modal-pad)] py-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 className="truncate text-base font-semibold text-[var(--text)]" title={typeof title === 'string' ? title : undefined}>{title}</h2>{description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}</div><button type="button" onClick={onClose} aria-label="Close panel" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl leading-none text-[var(--muted)] hover:bg-[var(--surface-2)]">×</button></div></header>
        <div className="modal-body scroll-shadow-y px-[var(--modal-pad)] py-4">{children}</div>
        {footer && <footer className="modal-footer border-t border-[var(--border)] px-[var(--modal-pad)] py-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Tabs({ tabs = [], value, onChange, className = '' }) {
  return <div role="tablist" className={`flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--border)] ${className}`.trim()}>{tabs.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} onClick={() => onChange?.(tab.value)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${value === tab.value ? 'border-[var(--action)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>{tab.label}</button>)}</div>;
}

export function SegmentedControl({ options = [], value, onChange, className = '', ariaLabel = 'Choose an option', layout = 'inline' }) {
  // `layout="grid"` distributes any number of options evenly with
  // repeat(auto-fit, minmax(…)), so a fourth item can never be orphaned on its
  // own row. The default stays inline so compact toolbars keep their shape.
  const container = layout === 'grid'
    ? 'grid w-full gap-1 [grid-template-columns:repeat(auto-fit,minmax(min(100%,8.5rem),1fr))]'
    : 'inline-flex max-w-full flex-wrap gap-1';
  return (
    <div role="group" aria-label={ariaLabel} className={`${container} rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-1 ${className}`.trim()}>
      {options.map(option => {
        const selected = value === option.value;
        return (
          <button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange?.(option.value)} className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded px-3 text-sm font-medium ${selected ? 'bg-[var(--primary)] text-[var(--on-primary)] shadow-sm' : 'text-[var(--text)] hover:bg-[var(--surface)]'}`}>
            {selected && <Check size={14} aria-hidden="true" />}
            <span className="min-w-0 truncate" title={typeof option.label === 'string' ? option.label : undefined}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FormField({ label, htmlFor, hint, error, required = false, children, className = '' }) {
  return <div className={`min-w-0 space-y-1.5 ${className}`.trim()}>{label && <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--text)]">{label}{required && <span className="ml-1 text-[var(--danger-text)]" aria-hidden="true">*</span>}</label>}{children}{error ? <p role="alert" className="text-xs text-[var(--danger-text)]">{error}</p> : hint ? <p className="text-xs text-[var(--muted)]">{hint}</p> : null}</div>;
}
