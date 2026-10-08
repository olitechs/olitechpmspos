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
export function clearModuleAccess(module) { const all = getModuleAccess(); delete all[module]; sessionStorage.setItem(ACCESS_KEY, JSON.stringify(all)); }
export function clearAllModuleAccess() { sessionStorage.removeItem(ACCESS_KEY); sessionStorage.removeItem(ACTIVE_STAFF_KEY); }
export function getActiveStaff() { try { return JSON.parse(sessionStorage.getItem(ACTIVE_STAFF_KEY) || 'null'); } catch { return null; } }

const moduleLabel = { pos: 'POS & F&B', frontoffice: 'Front Office · PMS', backoffice: 'Back Office · Property Admin', store: 'Stores', admin: 'Admin' };
const masterRoles = new Set(['super_admin','hotel_admin']);

export default function RouteGuard({ module, children }) {
  const { user } = useAuth();
  const role = normalizeStaffRole(user?.staff?.role || user?.propertyRole || user?.role);
  const propertyRole = String(user?.propertyRole || '').toLowerCase();
  const master = user?.isPlatformOwner || masterRoles.has(role) || (!user?.staff?.role && ['owner','admin','manager'].includes(propertyRole));
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState(getActiveStaff());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const propertyId = user?.property?.id;

  useEffect(() => {
    if (master || !propertyId) return;
    let alive = true;
    authService.listStaff(propertyId, module).then((rows) => { if (alive) setStaff(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [propertyId, module, master]);

  useEffect(() => {
    if (master) return;
    const check = async () => {
      const current = getActiveStaff();
      if (current) {
        try {
          const rows = await authService.listStaff(propertyId, module);
          if (!rows.some((row) => row.id === current.id)) {
            clearModuleAccess(module);
            sessionStorage.removeItem(ACTIVE_STAFF_KEY);
            setSelected(null);
            setOpen(false);
            return;
          }
        } catch { /* keep the current session when the network is temporarily unavailable */ }
      }
      if (!hasModuleAccess(module)) setOpen(true);
    };
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [module, master, propertyId]);

  useEffect(() => {
    if (master || !hasModuleAccess(module)) return;
    let last = 0;
    const activity = () => {
      const now = Date.now();
      if (now - last > 60000) { last = now; touchModuleAccess(module); authService.touchActiveStaffSession().catch(() => {}); }
    };
    const events = ['click','keydown','mousemove','touchstart'];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, activity));
  }, [module, master]);

  if (master || hasModuleAccess(module)) return <>{children}</>;

  const choose = (person) => { setSelected(person); setError(''); setOpen(true); };
  const verify = async (pin) => {
    setError('');
    try {
      const result = await authService.verifyStaffPin({ propertyId, module, pin });
      if (!result?.ok) { setError('Wrong PIN'); return; }
      sessionStorage.setItem(ACTIVE_STAFF_KEY, JSON.stringify(result.staff));
      const all = getModuleAccess(); all[module] = { staffId: result.staff.id, at: Date.now() }; sessionStorage.setItem(ACCESS_KEY, JSON.stringify(all));
      setSelected(result.staff); setOpen(false); setError('');
      window.dispatchEvent(new CustomEvent('olitech:staff-changed', { detail: result.staff }));
    } catch (e) { setError(e.message || 'Unable to verify PIN.'); }
  };

  if (!propertyId) return <DeniedScreen message="No hotel property is assigned to this account." />;
  const activeStaff = getActiveStaff();
  const visibleStaff = activeStaff ? staff.filter((row) => row.id === activeStaff.id) : staff;
  if (activeStaff && !(activeStaff.assigned_modules || []).includes(module)) {
    return <DeniedScreen message="Access Denied — this staff member is not assigned to this workspace. Contact the Hotel Admin." />;
  }

  return (
    <>
      <div className="flex h-full flex-1 items-center justify-center bg-[#F5F3EF] p-6">
        <div className="max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#090C11] text-xl font-black text-[#FFD300]">OT</div>
          <h2 className="text-xl font-black text-[#090C11]">{moduleLabel[module] || 'Protected Module'}</h2>
          <p className="mt-2 text-sm text-[#5F666D]">Select an active staff member assigned to this module, then enter their PIN.</p>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">{visibleStaff.length ? visibleStaff.map((person) => <button key={person.id} onClick={() => choose(person)} className="flex items-center gap-3 rounded-2xl border-2 border-[#090C11] bg-white p-3 text-left hover:bg-[#FFD300]"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFD300] font-black text-[#090C11]">{person.avatar || person.full_name?.slice(0,2).toUpperCase()}</div><div className="min-w-0"><div className="truncate text-sm font-black">{person.full_name}</div><div className="text-[10px] font-bold uppercase text-[#6B7280]">{person.role.replaceAll('_',' ')}</div></div><LockKeyhole size={15} className="ml-auto"/></button>) : <div className="col-span-full rounded-2xl border-2 border-dashed border-[#D1D5DB] bg-white p-5 text-sm text-[#6B7280]">No staff is assigned to this module yet. A Hotel Admin must add or assign staff in Admin → Roles.</div>}</div>
        </div>
      </div>
      {open && selected && <PinPad title={`Enter PIN for ${moduleLabel[module]}`} staffName={selected.full_name} error={error} onSubmit={verify} onClose={() => setOpen(false)} />}
      {!open && selected && !hasModuleAccess(module) && <PinPad title={`Enter PIN for ${moduleLabel[module]}`} staffName={selected.full_name} error={error} onSubmit={verify} onClose={() => setSelected(null)} />}

    </>
  );
}

export function DeniedScreen({ message = 'Access Denied — Contact Hotel Admin.' }) {
  return <div className="flex h-full flex-1 items-center justify-center bg-[#F5F3EF] p-6"><div className="text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#090C11] text-xl font-black text-[#FFD300]">OT</div><ShieldAlert className="mx-auto h-8 w-8 text-red-600"/><h2 className="mt-3 text-xl font-black text-[#090C11]">Access Denied</h2><p className="mt-1 text-sm text-[#6B7280]">{message}</p></div></div>;
}
