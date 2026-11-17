// Departments panel — property-scoped department management.
// All mutations go through the audited server-side RPCs; there are no direct
// table writes for departments anywhere in the client.

import React, { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { employeeService } from '@/services/employeeService';
import { WORKSPACE_LABELS, PERMISSION_CODES } from '@/lib/permissions';

// Workspaces offered for a department default, derived from the catalog.
const WORKSPACE_OPTIONS = [...new Set(PERMISSION_CODES.map((p) => p.workspace))];

const emptyForm = { name: '', defaultWorkspace: 'pos', description: '' };

export default function DepartmentsPanel({ propertyId, reloadKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      setRows(await employeeService.listDepartments(propertyId) || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, reloadKey]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (editingId) {
        await employeeService.updateDepartment(editingId, form.name, form.defaultWorkspace, form.description || null);
        toast.success('Department updated.');
      } else {
        await employeeService.createDepartment(propertyId, form.name, form.defaultWorkspace, form.description || null);
        toast.success('Department created.');
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete department “${row.name}”? Employees keep their records but lose this department assignment.`)) return;
    try {
      await employeeService.deleteDepartment(row.id);
      toast.success('Department deleted.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';

  return (
    <div>
      <form onSubmit={submit} className="mb-4 rounded-2xl border border-[var(--border)] bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="dept-name" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Department name</label>
            <input id="dept-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`mt-1 ${inputClass}`} />
          </div>
          <div>
            <label htmlFor="dept-workspace" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Default workspace</label>
            <select id="dept-workspace" value={form.defaultWorkspace} onChange={(e) => setForm({ ...form, defaultWorkspace: e.target.value })} className={`mt-1 ${inputClass}`}>
              {WORKSPACE_OPTIONS.map((w) => <option key={w} value={w}>{WORKSPACE_LABELS[w] || w}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dept-desc" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Description (optional)</label>
            <input id="dept-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`mt-1 ${inputClass}`} />
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}
              className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)]">Cancel edit</button>
          )}
          <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {editingId ? 'Save changes' : 'Create department'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr><th className="p-3 text-left">Department</th><th className="p-3 text-left">Default workspace</th><th className="p-3 text-left">Description</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">Loading…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">No departments yet. Create the first one above.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)]">
                <td className="p-3 font-bold text-[var(--text)]">{row.name}</td>
                <td className="p-3 text-[var(--text)]">{WORKSPACE_LABELS[row.default_workspace] || row.default_workspace}</td>
                <td className="p-3 text-[var(--text-muted)]">{row.description || '—'}</td>
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    <button type="button" onClick={() => { setEditingId(row.id); setForm({ name: row.name, defaultWorkspace: row.default_workspace, description: row.description || '' }); }}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--primary-soft)]">Edit</button>
                    <button type="button" onClick={() => remove(row)} aria-label={`Delete ${row.name}`}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"><Trash2 size={14} /></button>
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
