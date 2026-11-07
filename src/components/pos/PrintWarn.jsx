import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ERR } from '@/data/themePalette';

export default function PrintWarn({ message }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium" style={{ background: 'var(--warning-soft)', color: 'var(--warning-text)', border: `1px solid ${ERR}` }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, color: ERR }} /> <span>{message}</span>
    </div>
  );
}
