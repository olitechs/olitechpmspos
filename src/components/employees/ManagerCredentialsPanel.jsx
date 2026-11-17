// PIN & security panel — manager authorization credentials.
//
// New manager PINs are 6 digits and hashed SERVER-side with bcrypt
// (extensions.crypt / gen_salt('bf', 12)) by fn_set_manager_pin; the raw PIN
// is only ever sent over HTTPS to the RPC and never stored or logged.
// Legacy staff PINs (used for the existing POS PIN wall) keep their existing
// client-hashed flow, which this panel does not touch.

import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { authService, ROLE_LABELS, STAFF_ROLES } from '@/services/authService';
import { employeeService } from '@/services/employeeService';

// Staff roles that may hold a manager authorization credential — mirrors the
// server-side check in fn_set_manager_pin.
const MANAGER_ROLES = ['hotel_admin', 'super_admin', 'front_office_manager', 'store_manager', 'fb_manager'];

export default function ManagerCredentialsPanel({ propertyId, reloadKey }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [pinDrafts, setPinDrafts] = useState({});

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const rows = await authService.listAllStaff(propertyId) || [];
      setStaff(rows.filter((row) => MANAGER_ROLES.includes(String(row.role || ''))));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, reloadKey]);

  const setPin = async (row) => {
    const pin = String(pinDrafts[row.id] || '').trim();
    if (!/^\d{6}$/.test(pin)) {
      toast.error('A manager PIN must be exactly 6 digits.');
      return;
    }
    setBusyId(row.id);
    try {
      await employeeService.setManagerPin(propertyId, row.id, pin);
      toast.success(`Manager PIN updated for ${row.full_name}. The PIN is hashed server-side and never stored in clear.`);
      setPinDrafts((d) => ({ ...d, [row.id]: '' }));
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const clearPin = async (row) => {
    if (!window.confirm(`Clear the manager authorization PIN for ${row.full_name}? They will only be able to approve with their email & password.`)) return;
    setBusyId(row.id);
    try {
      await employeeService.clearManagerPin(propertyId, row.id);
      toast.success('Manager PIN cleared.');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';

  return (
    <div>
      <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--canvas)] px-4 py-3 text-sm text-[var(--text-muted)]">
        Managers use their PIN — or their own email &amp; password — to approve restricted actions on the full-screen manager authorization. Whether a PIN exists is not exposed to the browser; setting a new PIN replaces the old one. Rate limiting is enforced server-side: 5 wrong attempts per 10 minutes lock authorization for 5 minutes.
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr><th className="p-3 text-left">Manager</th><th className="p-3 text-left">Role</th><th className="p-3 text-left">Set / replace PIN</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">Loading…</td></tr>}
            {!loading && !staff.length && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">No manager-role employees yet.</td></tr>}
            {staff.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)]">
                <td className="p-3">
                  <div className="font-bold text-[var(--text)]">{row.full_name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{row.email || '—'}</div>
                </td>
                <td className="p-3 text-[var(--text)]">{ROLE_LABELS[row.role] || row.role}</td>
                <td className="p-3">
                  <div className="flex max-w-[220px] items-center gap-2">
                    <input inputMode="numeric" autoComplete="off" placeholder="6 digits" aria-label={`Manager PIN for ${row.full_name}`}
                      value={pinDrafts[row.id] || ''}
                      onChange={(e) => setPinDrafts((d) => ({ ...d, [row.id]: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      className={inputClass} />
                  </div>
                </td>
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    <button type="button" disabled={busyId === row.id} onClick={() => setPin(row)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--primary-soft)] disabled:opacity-50">
                      {busyId === row.id ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Save PIN
                    </button>
                    <button type="button" disabled={busyId === row.id} onClick={() => clearPin(row)} aria-label={`Clear PIN for ${row.full_name}`}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)] disabled:opacity-50" title="Clear PIN">
                      <ShieldOff size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-muted)]">
        Only these built-in roles may hold a manager authorization credential: {STAFF_ROLES.filter((r) => MANAGER_ROLES.includes(r)).map((r) => ROLE_LABELS[r]).join(', ')}.
      </p>
    </div>
  );
}
