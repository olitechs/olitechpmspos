// Roles & permissions panel — custom property permission bundles.
//
// The permission checkboxes come from the client mirror of the server catalog
// (src/lib/permissions.js). The server re-validates every submitted code
// against the seeded employee_permission_codes table, so a tampered browser
// can never invent permissions.

import React, { useEffect, useState } from 'react';
import { Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { employeeService } from '@/services/employeeService';
import { permissionsByWorkspace, permissionLabel, WORKSPACE_LABELS } from '@/lib/permissions';

const WORKSPACE_ORDER = ['pos', 'frontoffice', 'store', 'backoffice'];
const emptyForm = { name: '', workspace: 'pos', description: '', codes: [] };

export default function RolesPermissionsPanel({ propertyId, reloadKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      setRows(await employeeService.listRoles(propertyId) || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, reloadKey]);

  const toggleCode = (code) => {
    setForm((f) => ({
      ...f,
      codes: f.codes.includes(code) ? f.codes.filter((c) => c !== code) : [...f.codes, code],
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (editingId) {
        await employeeService.updateRole(editingId, form.name, form.workspace, form.codes, form.description || null);
        toast.success('Permission bundle updated.');
      } else {
        await employeeService.createRole(propertyId, form.name, form.workspace, form.codes, form.description || null);
        toast.success('Permission bundle created.');
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
    if (!window.confirm(`Delete permission bundle “${row.name}”? Employees assigned to it fall back to their built-in staff-role permissions.`)) return;
    try {
      await employeeService.deleteRole(row.id);
      toast.success('Permission bundle deleted.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const groups = permissionsByWorkspace();
  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';

  return (
    <div>
      <form onSubmit={submit} className="mb-4 rounded-2xl border border-[var(--border)] bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="role-name" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Bundle name</label>
            <input id="role-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`mt-1 ${inputClass}`} />
          </div>
          <div>
            <label htmlFor="role-workspace" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Workspace</label>
            <select id="role-workspace" value={form.workspace} onChange={(e) => setForm({ ...form, workspace: e.target.value })} className={`mt-1 ${inputClass}`}>
              {WORKSPACE_ORDER.map((w) => <option key={w} value={w}>{WORKSPACE_LABELS[w] || w}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="role-desc" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Description (optional)</label>
            <input id="role-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`mt-1 ${inputClass}`} />
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {WORKSPACE_ORDER.map((workspace) => (
            <fieldset key={workspace} className="rounded-xl border border-[var(--border)] p-3">
              <legend className="px-1 text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">{WORKSPACE_LABELS[workspace] || workspace}</legend>
              <div className="space-y-1.5">
                {(groups.get(workspace) || []).map((p) => (
                  <label key={p.code} className="flex items-start gap-2 text-sm text-[var(--text)]">
                    <input type="checkbox" className="mt-0.5" checked={form.codes.includes(p.code)} onChange={() => toggleCode(p.code)} />
                    <span>
                      {p.label}
                      {p.sensitive && <span className="ml-1.5 rounded-md bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--danger-text)]">sensitive</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-3 flex justify-end gap-2">
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }}
              className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)]">Cancel edit</button>
          )}
          <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {editingId ? 'Save changes' : 'Create bundle'}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr><th className="p-3 text-left">Bundle</th><th className="p-3 text-left">Workspace</th><th className="p-3 text-left">Permissions</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">Loading…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={4} className="p-6 text-center text-[var(--text-muted)]">No custom bundles yet — employees use built-in staff-role permissions.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)]">
                <td className="p-3 font-bold text-[var(--text)]">
                  {row.name}
                  {row.is_system && <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-[var(--canvas)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-muted)]"><Lock size={10} /> built-in</span>}
                </td>
                <td className="p-3 text-[var(--text)]">{WORKSPACE_LABELS[row.workspace] || row.workspace}</td>
                <td className="p-3 text-xs text-[var(--text-muted)]">
                  {row.permission_codes?.length
                    ? row.permission_codes.map((c) => permissionLabel(c)).join(' · ')
                    : 'No permissions granted'}
                </td>
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    {!row.is_system && (
                      <>
                        <button type="button" onClick={() => { setEditingId(row.id); setForm({ name: row.name, workspace: row.workspace, description: row.description || '', codes: [...(row.permission_codes || [])] }); }}
                          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--primary-soft)]">Edit</button>
                        <button type="button" onClick={() => remove(row)} aria-label={`Delete ${row.name}`}
                          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"><Trash2 size={14} /></button>
                      </>
                    )}
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
