// Employees panel — the licence-aware employee register.
//
// Additive to the existing staff console (Roles.jsx / EmployeeListPage): this
// panel creates employees through fn_create_employee_with_licence (licence
// enforced server-side), assigns departments and custom permission bundles,
// and activates/deactivates/suspends accounts through audited RPCs. The
// legacy per-staff PIN flows (authService.resetStaffPin / deleteStaff) are
// untouched and reused here.

import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { authService, generatePin, getDefaultModulesForRole, ROLE_LABELS, STAFF_ROLES, hashPin } from '@/services/authService';
import { employeeService } from '@/services/employeeService';
import { WORKSPACE_LABELS } from '@/lib/permissions';

const WORKSPACE_OPTIONS = [
  { value: 'backoffice', label: WORKSPACE_LABELS.backoffice },
  { value: 'frontoffice', label: WORKSPACE_LABELS.frontoffice },
  { value: 'pos', label: WORKSPACE_LABELS.pos },
  { value: 'store', label: WORKSPACE_LABELS.stores },
];

const emptyForm = { fullName: '', email: '', phone: '', role: 'waiter', departmentId: '', roleId: '', pin: '', assignedModules: ['pos'] };

export default function EmployeesPanel({ propertyId, reloadKey, licenceState, onLicenceRefused }) {
  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [licenceRefusal, setLicenceRefusal] = useState(null);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [rows, depts, roleRows] = await Promise.all([
        authService.listAllStaff(propertyId),
        employeeService.listDepartments(propertyId),
        employeeService.listRoles(propertyId),
      ]);
      setStaff(rows || []);
      setDepartments(depts || []);
      setRoles(roleRows || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, reloadKey]);

  const available = Number(licenceState?.available_licences ?? 0);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setLicenceRefusal(null);
    try {
      const pin = form.pin.trim() || generatePin(6);
      const pinHash = await hashPin(pin);
      await employeeService.createEmployee({
        propertyId,
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        staffRole: form.role,
        assignedModules: form.assignedModules,
        pinHash,
        roleId: form.roleId || null,
        departmentId: form.departmentId || null,
      });
      toast.success(`Employee created. Their staff PIN is ${pin} — share it securely.`);
      setForm(emptyForm);
      setFormOpen(false);
      load();
    } catch (err) {
      if (err.code === 'licence_limit_reached') {
        setLicenceRefusal(err.licenceState || licenceState);
        onLicenceRefused?.();
      } else {
        toast.error(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const assignModules = async (staffId, modules) => {
    try {
      await employeeService.setModules(staffId, modules);
      toast.success('Workspace access updated.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const assignDepartment = async (staffId, departmentId) => {
    try {
      await employeeService.setDepartment(staffId, departmentId || null);
      toast.success('Department updated.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const assignRole = async (staffId, roleId) => {
    try {
      await employeeService.setRole(staffId, roleId || null);
      toast.success('Permission bundle updated.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const toggleStatus = async (row, status) => {
    try {
      await employeeService.setStatus(row.id, status);
      toast.success(status === 'active' ? 'Employee reactivated.' : status === 'suspended' ? 'Employee suspended — temporary grants revoked.' : 'Employee deactivated — temporary grants revoked.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete ${row.full_name}? This removes their employee record permanently.`)) return;
    try {
      await authService.deleteStaff(row.id);
      toast.success('Employee deleted.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--text-muted)]">
          {available > 0
            ? <><b>{available}</b> licence seat(s) available.</>
            : <span className="font-semibold text-[var(--danger-text)]">No licence seats available. Deactivate an employee or add licences to register more.</span>}
        </p>
        <button type="button" onClick={() => setFormOpen((v) => !v)} disabled={available < 1 && !formOpen}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-xs font-bold text-primary-foreground disabled:opacity-50">
          <Plus size={15} /> Add employee
        </button>
      </div>

      {licenceRefusal && (
        <div role="alert" className="mb-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-text)]">
          <b>Licence limit reached.</b> This plan includes {licenceRefusal.included_employees} employee seat(s)
          {Number(licenceRefusal.additional_employees || 0) > 0 ? ` plus ${licenceRefusal.additional_employees} additional` : ''}, and all are in use.
          Deactivate an employee or add licences under <b>Employee licences</b>.
        </div>
      )}

      {formOpen && (
        <form onSubmit={submit} className="mb-4 rounded-2xl border border-[var(--border)] bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="emp-name" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Full name</label>
              <input id="emp-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={`mt-1 ${inputClass}`} />
            </div>
            <div>
              <label htmlFor="emp-email" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Email</label>
              <input id="emp-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`mt-1 ${inputClass}`} />
            </div>
            <div>
              <label htmlFor="emp-phone" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Phone</label>
              <input id="emp-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`mt-1 ${inputClass}`} />
            </div>
            <div>
              <label htmlFor="emp-role" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Staff role</label>
              <select id="emp-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value, assignedModules: getDefaultModulesForRole(e.target.value) })} className={`mt-1 ${inputClass}`}>
                {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="emp-dept" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Department</label>
              <select id="emp-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className={`mt-1 ${inputClass}`}>
                <option value="">— none —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name} ({WORKSPACE_LABELS[d.default_workspace] || d.default_workspace})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="emp-bundle" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Permission bundle</label>
              <select id="emp-bundle" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} className={`mt-1 ${inputClass}`}>
                <option value="">— role defaults —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="emp-pin" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Staff PIN (4–6 digits, optional)</label>
              <input id="emp-pin" inputMode="numeric" value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                placeholder="Auto-generated if empty" className={`mt-1 ${inputClass}`} />
            </div>
          </div>
          <fieldset className="mt-4 rounded-xl border border-[var(--border)] p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Assigned workspaces</legend>
            <p className="mb-2 text-xs text-[var(--text-muted)]">The employee can only enter the workspaces selected here. Their permission bundle is further restricted to these workspaces.</p>
            <div className="flex flex-wrap gap-3">
              {WORKSPACE_OPTIONS.map((workspace) => (
                <label key={workspace.value} className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                  <input type="checkbox" checked={form.assignedModules.includes(workspace.value)}
                    onChange={(e) => setForm({ ...form, assignedModules: e.target.checked ? [...form.assignedModules, workspace.value] : form.assignedModules.filter((value) => value !== workspace.value) })} />
                  {workspace.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setFormOpen(false); setForm(emptyForm); }}
              className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)]">Cancel</button>
            <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {busy && <Loader2 size={15} className="animate-spin" />} Create employee
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr>
              <th className="p-3 text-left">Employee</th>
              <th className="p-3 text-left">Staff role</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Permission bundle</th>
              <th className="p-3 text-left">Assigned workspaces</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-6 text-center text-[var(--text-muted)]">Loading…</td></tr>}
            {!loading && !staff.length && <tr><td colSpan={7} className="p-6 text-center text-[var(--text-muted)]">No employees yet.</td></tr>}
            {staff.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)]">
                <td className="p-3">
                  <div className="font-black text-[var(--text)]">{row.full_name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{row.email || '—'}</div>
                </td>
                <td className="p-3 capitalize text-[var(--text)]">{String(row.role || 'staff').replaceAll('_', ' ')}</td>
                <td className="p-3">
                  <select value={row.department_id || ''} onChange={(e) => assignDepartment(row.id, e.target.value)} aria-label={`Department for ${row.full_name}`} className={inputClass}>
                    <option value="">— none —</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </td>
                <td className="p-3">
                  <select value={row.role_id || ''} onChange={(e) => assignRole(row.id, e.target.value)} aria-label={`Permission bundle for ${row.full_name}`} className={inputClass}>
                    <option value="">— role defaults —</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td className="p-3">
                  <div className="flex min-w-[190px] flex-wrap gap-x-3 gap-y-2">
                    {WORKSPACE_OPTIONS.map((workspace) => (
                      <label key={workspace.value} className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text)]">
                        <input type="checkbox" checked={(row.assigned_modules || []).includes(workspace.value)}
                          onChange={(e) => assignModules(row.id, e.target.checked ? [...(row.assigned_modules || []), workspace.value] : (row.assigned_modules || []).filter((value) => value !== workspace.value))} />
                        {workspace.label}
                      </label>
                    ))}
                  </div>
                </td>
                <td className="p-3">
                  {row.is_active
                    ? <span className="inline-flex items-center gap-1 text-[var(--success-text)]"><UserCheck size={15} /> Active</span>
                    : <span className="inline-flex items-center gap-1 text-[var(--text-muted)]"><UserX size={15} /> Inactive</span>}
                </td>
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    <button type="button" onClick={() => toggleStatus(row, row.is_active ? 'inactive' : 'active')}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--primary-soft)]">
                      {row.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" onClick={() => remove(row)} title="Delete employee"
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]" aria-label={`Delete ${row.full_name}`}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
