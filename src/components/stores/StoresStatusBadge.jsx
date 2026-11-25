import React from 'react';

const TONES = {
  draft: 'bg-[var(--canvas)] text-[var(--text-muted)] border-[var(--border)]',
  pending: 'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]',
  dispatched: 'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]',
  submitted: 'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]',
  approved: 'bg-[var(--primary-soft)] text-[var(--primary)] border-[var(--primary)]',
  partially_issued: 'bg-[var(--primary-soft)] text-[var(--primary)] border-[var(--primary)]',
  issued: 'bg-[var(--success-soft)] text-[var(--success-text)] border-[var(--success)]',
  received: 'bg-[var(--success-soft)] text-[var(--success-text)] border-[var(--success)]',
  completed: 'bg-[var(--success-soft)] text-[var(--success-text)] border-[var(--success)]',
  in_transit: 'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning)]',
  discrepancy: 'bg-[var(--danger-soft)] text-[var(--danger-text)] border-[var(--danger)]',
  rejected: 'bg-[var(--danger-soft)] text-[var(--danger-text)] border-[var(--danger)]',
  cancelled: 'bg-[var(--canvas)] text-[var(--text-muted)] border-[var(--border)]',
  voided: 'bg-[var(--canvas)] text-[var(--text-muted)] border-[var(--border)] line-through',
};

const LABELS = {
  draft: 'Draft',
  pending: 'Awaiting dispatch',
  dispatched: 'Dispatched',
  submitted: 'Submitted',
  approved: 'Approved',
  partially_issued: 'Partly issued',
  issued: 'Issued',
  received: 'Received',
  completed: 'Completed',
  in_transit: 'In transit',
  discrepancy: 'Discrepancy',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  voided: 'Voided',
};

export function statusLabel(status) {
  return LABELS[status] || String(status || '').replaceAll('_', ' ');
}

export default function StoresStatusBadge({ status }) {
  const key = String(status || '').toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${TONES[key] || TONES.draft}`}>
      {statusLabel(key)}
    </span>
  );
}
