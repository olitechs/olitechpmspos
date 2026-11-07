import React from 'react';
import { Sun } from 'lucide-react';

export default function ThemeToggle({ compact = false }) {
  return (
    <span
      className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--primary-soft)] px-3 text-sm font-semibold text-[var(--primary)]"
      role="status"
      aria-label="Coastal Linen light theme"
      title="Coastal Linen · Light"
    >
      <Sun size={15} aria-hidden="true" />
      {!compact && <span>Coastal Linen · Light</span>}
    </span>
  );
}
