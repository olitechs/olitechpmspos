import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ShieldCheck, UserX } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { authService } from '@/services/authService';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { NAVY, TEAL, TEAL_DARK, SAND, SURFACE, SURFACE2, BORDER, MUTED, ERR } from '@/data/themePalette';

// Read-only view of the staff who can be assigned to a POS table. The records
// live in Supabase (`public.staff`); roles, PINs and access are edited on the
// Users & Roles screen.
function initials(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function StaffAdmin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const propertyId = user?.property?.id;
  const canOpenRoles = isFeatureEnabled('backoffice');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!propertyId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      setRows(await authService.listStaff(propertyId, 'pos'));
    } catch (cause) {
      setError(cause?.message || 'Staff could not be loaded.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex-1 overflow-y-auto p-4" style={{ background: SAND }}>
      <div className="max-w-xl overflow-hidden rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
        <div className="flex items-start justify-between gap-3 px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <div className="text-sm font-bold" style={{ color: NAVY }}>POS staff</div>
            <div className="text-xs" style={{ color: MUTED }}>Active staff assigned to the Point of Sale module. This list is what the waiter field offers when opening a table.</div>
          </div>
          <button type="button" onClick={load} disabled={loading} aria-label="Reload staff" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border disabled:opacity-50" style={{ borderColor: BORDER, color: TEAL_DARK }}>
            <RefreshCw size={15} />
          </button>
        </div>

        {error && (
          <div role="alert" className="border-b px-5 py-3 text-xs font-semibold" style={{ borderColor: BORDER, color: ERR }}>
            {error} Check the connection and reload.
          </div>
        )}

        {loading ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: MUTED }}>Loading staff…</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: MUTED }}>
            <UserX size={18} className="mx-auto mb-2" />
            {propertyId ? 'No active staff are assigned to the Point of Sale.' : 'No property is selected for this login.'}
          </div>
        ) : (
          rows.map((row, index) => (
            <div key={row.id} className="flex items-center gap-2 px-5 py-2.5" style={{ borderBottom: `1px solid ${BORDER}`, background: index % 2 ? SURFACE2 : SURFACE }}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: `${NAVY}14`, color: NAVY }}>
                {initials(row.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: NAVY }}>{row.full_name}</div>
                <div className="truncate text-xs capitalize" style={{ color: MUTED }}>{String(row.role || 'staff').replaceAll('_', ' ')}</div>
              </div>
            </div>
          ))
        )}

        {canOpenRoles && (
          <div className="px-5 py-3">
            <button type="button" onClick={() => navigate('/backoffice/employees/access-rights')} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold" style={{ background: TEAL, color: 'var(--on-primary)' }}>
              <ShieldCheck size={14} /> Manage staff & roles
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
