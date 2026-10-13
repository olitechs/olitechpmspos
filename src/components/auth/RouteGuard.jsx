import React, { useEffect, useState } from 'react';
import { ShieldAlert, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { authService, normalizeStaffRole } from '@/services/authService';
import PinPad from './PinPad';

const ACCESS_KEY = 'olitech_module_access_v2';
const ACTIVE_STAFF_KEY = 'olitech_active_staff_v2';
const TTL = 30 * 60 * 1000;

export function getModuleAccess() {
  try { return JSON.parse(sessionStorage.getItem(ACCESS_KEY) || '{}'); } catch { return {}; }
}
export function hasModuleAccess(module) {
  const row = getModuleAccess()[module];
  return !!row && Date.now() - Number(row.at || 0) < TTL;
}
export function touchModuleAccess(module) {
  const all = getModuleAccess(); all[module] = { ...(all[module] || {}), at: Date.now() }; sessionStorage.setItem(ACCESS_KEY, JSON.stringify(all));
}
export function clearModuleAccess(module) {
  const all = getModuleAccess(); delete all[module]; sessionStorage.setItem(ACCESS_KEY, JSON.stringify(all));
}
export function clearAllModuleAccess() {
  try { sessionStorage.removeItem(ACCESS_KEY); sessionStorage.removeItem(ACTIVE_STAFF_KEY); } catch {}
}
export function getActiveStaff() {
  try { return JSON.parse(sessionStorage.getItem(ACTIVE_STAFF_KEY) || 'null'); } catch { return null; }
}

const moduleLabel = { pos: 'POS & F&B', frontoffice: 'Front Office · PMS', backoffice: 'Back Office', store: 'Stores', admin: 'Admin' };
const masterRoles = new Set(['super_admin', 'hotel_admin']);

export default function RouteGuard({ module, children }) {
  const { user } = useAuth();
  const moduleKey = module === 'stores' ? 'store' : module;
  const role = normalizeStaffRole(user?.staff?.role || user?.propertyRole || user?.role);
  const propertyRole = String(user?.propertyRole || '').toLowerCase();
  // Property/platform administrators authenticate with their Supabase email + password.
  // A staff PIN never elevates an account to administrator access.
  const master = !!user?.isPlatformOwner || masterRoles.has(role) ||
    (!user?.staff?.role && ['owner', 'admin', 'manager'].includes(propertyRole));
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState(getActiveStaff());
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState('');
  const [, setRefresh] = useState(0);
  const propertyId = user?.property?.id;

  useEffect(() => {
    if (master || !propertyId) return undefined;
    let alive = true;
    authService.listStaff(propertyId, moduleKey)
      .then((rows) => { if (alive) setStaff(rows); })
      .catch((err) => { if (alive) setError(err?.message || 'Could not load staff for this property.'); });
    return () => { alive = false; };
  }, [propertyId, moduleKey, master]);

  useEffect(() => {
    if (master) return undefined;
    const check = async () => {
      const current = getActiveStaff();
      if (current) {
        try {
          const rows = await authService.listStaff(propertyId, moduleKey);
          if (!rows.some((row) => row.id === current.id)) {
            clearAllModuleAccess();
            setSelected(null);
            setPinOpen(false);
          }
        } catch { /* Do not break an already-open workspace during a transient network issue. */ }
      }
      setRefresh((v) => v + 1);
    };
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [moduleKey, master, propertyId]);

  useEffect(() => {
    if (master || !hasModuleAccess(moduleKey)) return undefined;
    let last = 0;
    const activity = () => {
      const now = Date.now();
      if (now - last > 60000) {
        last = now;
        touchModuleAccess(moduleKey);
        authService.touchActiveStaffSession().catch(() => {});
      }
    };
    const events = ['click', 'keydown', 'mousemove', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, activity));
  }, [moduleKey, master]);

  useEffect(() => {
    if (master) return undefined;
    const lock = (event) => {
      const requested = event?.detail?.module;
      if (requested && requested !== moduleKey && requested !== 'all') return;
      clearAllModuleAccess();
      setSelected(null);
      setPinOpen(false);
      setError('');
      setRefresh((v) => v + 1);
      authService.clearActiveStaffSession().catch(() => {});
    };
    const close = () => clearAllModuleAccess();
    window.addEventListener('olitech:lock-workspace', lock);
    // Require a fresh PIN after a tab/window is closed or refreshed.
    window.addEventListener('beforeunload', close);
    return () => {
      window.removeEventListener('olitech:lock-workspace', lock);
      window.removeEventListener('beforeunload', close);
    };
  }, [moduleKey, master]);

  if (master || hasModuleAccess(moduleKey)) return <>{children}</>;

  const choose = (person) => { setSelected(person); setError(''); setPinOpen(true); };
  const verify = async (pin) => {
    setError('');
    try {
      const result = await authService.verifyStaffPin({ propertyId, module: moduleKey, pin });
      if (!result?.ok) {
        setError(result?.reason === 'locked'
          ? `Too many incorrect attempts. Try again in ${Math.max(1, Math.ceil((result.retry_after_seconds || 60) / 60))} minute(s).`
          : 'Incorrect PIN. Please try again.');
        return;
      }
      sessionStorage.setItem(ACTIVE_STAFF_KEY, JSON.stringify(result.staff));
      const all = getModuleAccess();
      all[moduleKey] = { staffId: result.staff.id, at: Date.now() };
      sessionStorage.setItem(ACCESS_KEY, JSON.stringify(all));
      setSelected(result.staff);
      setPinOpen(false);
      setError('');
      setRefresh((v) => v + 1);
      window.dispatchEvent(new CustomEvent('olitech:staff-changed', { detail: result.staff }));
    } catch (err) {
      setError(err?.message || 'Unable to verify PIN. Check your connection and try again.');
    }
  };

  if (!propertyId) return <DeniedScreen message="No hotel property is assigned to this account." />;

  const activeStaff = getActiveStaff();
  const visibleStaff = activeStaff
    ? staff.filter((row) => row.id === activeStaff.id && row.is_active)
    : staff.filter((row) => row.is_active && Array.isArray(row.assigned_modules) && row.assigned_modules.includes(moduleKey));

  if (activeStaff && !(activeStaff.assigned_modules || []).includes(moduleKey)) {
    return <DeniedScreen message="This staff member is not assigned to this workspace. Contact the Property Admin." />;
  }

  return (
    <main className="flex min-h-full w-full flex-1 items-center justify-center bg-[#F5F3EF] px-4 py-8">
      <section className="w-full max-w-xl rounded-3xl border border-[#E4E1D9] bg-white p-6 shadow-xl sm:p-9" aria-labelledby="pin-wall-title">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#090C11] text-lg font-black text-[#FFD300]">OT</div>
        <p className="text-center text-[10px] font-black uppercase tracking-[.25em] text-[#8B8B83]">OliTechs secure access</p>
        <h1 id="pin-wall-title" className="mt-2 text-center text-2xl font-black tracking-tight text-[#090C11]">ENTER PIN TO LOG IN</h1>
        <p className="mt-2 text-center text-sm text-[#5F666D]">
          {moduleLabel[moduleKey] || 'Protected workspace'} · Select your staff profile, then enter your assigned 4–6 digit PIN.
        </p>
        {error && !pinOpen && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleStaff.length ? visibleStaff.map((person) => (
            <button key={person.id} type="button" onClick={() => choose(person)}
              className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-3 text-left transition hover:border-[#090C11] hover:bg-[#FFF8CC] focus:outline-none focus:ring-2 focus:ring-[#FFD300]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFD300] font-black text-[#090C11]">{person.avatar || person.full_name?.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black text-[#090C11]">{person.full_name}</span><span className="mt-1 block truncate text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">{String(person.role || 'staff').replaceAll('_', ' ')}</span></span>
              <LockKeyhole size={16} className="shrink-0 text-[#6B7280]" />
            </button>
          )) : (
            <div className="col-span-full rounded-2xl border border-dashed border-[#D1D5DB] bg-[#FAFAF8] p-5 text-center text-sm text-[#6B7280]">
              {staff.length ? 'No active staff member is assigned to this workspace.' : 'No staff profiles are available. Ask the Property Admin to create a staff profile and assign a PIN.'}
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-[10px] font-semibold uppercase tracking-[.16em] text-[#8B8B83]">Property-scoped access · Attempts are monitored</p>
      </section>
      {pinOpen && selected && <PinPad fullscreen title="ENTER PIN TO LOG IN" staffName={selected.full_name} error={error} onSubmit={verify} onClose={() => { setPinOpen(false); setError(''); }} />}
    </main>
  );
}

export function DeniedScreen({ message = 'Access Denied — Contact Property Admin.' }) {
  return <div className="flex h-full flex-1 items-center justify-center bg-[#F5F3EF] p-6"><div className="text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#090C11] text-xl font-black text-[#FFD300]">OT</div><ShieldAlert className="mx-auto h-8 w-8 text-red-600"/><h2 className="mt-3 text-xl font-black text-[#090C11]">Access Denied</h2><p className="mt-1 text-sm text-[#6B7280]">{message}</p></div></div>;
}
