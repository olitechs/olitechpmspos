// Access history panel — the property's employee_access_audit trail.
//
// Read-only. Rows are written only by the server-side RPCs, contain no
// credentials (PINs/passwords are never logged), and are protected by RLS:
// only property administrators and the platform owner can select them.

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { employeeService } from '@/services/employeeService';

const RESULT_STYLES = {
  allowed: 'bg-[var(--success-soft)] text-[var(--success-text)]',
  granted: 'bg-[var(--success-soft)] text-[var(--success-text)]',
  denied: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
  rejected: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
  error: 'bg-[var(--danger-soft)] text-[var(--danger-text)]',
  expired: 'bg-[var(--canvas)] text-[var(--text-muted)]',
  revoked: 'bg-[var(--canvas)] text-[var(--text-muted)]',
};

function describe(row) {
  switch (row.action) {
    case 'manager_authorization': return `Manager authorization — ${row.permission_code || ''}`;
    case 'manager_pin_set': return 'Manager PIN set / replaced';
    case 'manager_pin_cleared': return 'Manager PIN cleared';
    case 'manager_grant_revoked': return 'Temporary grant revoked';
    default: return row.action.replaceAll('_', ' ');
  }
}

export default function AccessHistoryPanel({ propertyId, reloadKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      setRows(await employeeService.listAccessAudit(propertyId) || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, reloadKey]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-primary text-primary-foreground">
          <tr><th className="p-3 text-left">When</th><th className="p-3 text-left">Event</th><th className="p-3 text-left">Result</th><th className="p-3 text-left">Details</th></tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">Loading…</td></tr>}
          {!loading && !rows.length && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">No access events recorded yet.</td></tr>}
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-[var(--border)]">
              <td className="p-3 whitespace-nowrap text-xs text-[var(--text-muted)]">
                {new Date(row.created_at).toLocaleString()}
              </td>
              <td className="p-3 font-semibold text-[var(--text)]">{describe(row)}</td>
              <td className="p-3">
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${RESULT_STYLES[row.result] || 'bg-[var(--canvas)] text-[var(--text-muted)]'}`}>{row.result}</span>
              </td>
              <td className="p-3 text-xs text-[var(--text-muted)]">
                {row.details && Object.keys(row.details).length
                  ? Object.entries(row.details).filter(([k]) => k !== 'pin' && k !== 'password').map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join(' · ')
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
