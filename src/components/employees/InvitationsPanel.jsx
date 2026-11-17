// Invitations panel — email invitations with one-time claim tokens.
//
// Tokens are bcrypt-hashed at rest by the server; the raw token is returned
// to the admin exactly once and either emailed through the employee-invite
// edge function or shown once here for manual sharing. Acceptance happens on
// the public /accept-invite screen.

import React, { useEffect, useState } from 'react';
import { Copy, Loader2, Mail, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getDefaultModulesForRole, ROLE_LABELS, STAFF_ROLES } from '@/services/authService';
import { employeeService } from '@/services/employeeService';

const emptyForm = { email: '', fullName: '', role: 'waiter', departmentId: '', roleId: '' };

function inviteUrl(token) {
  return `${window.location.origin}/accept-invite?token=${encodeURIComponent(token)}`;
}

export default function InvitationsPanel({ propertyId, reloadKey }) {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  // Shown exactly once after creation/resend; never stored in component state
  // beyond this session and never persisted anywhere.
  const [oneTimeLink, setOneTimeLink] = useState(null);

  const load = async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [invitationRows, depts, roleRows] = await Promise.all([
        employeeService.listInvitations(propertyId),
        employeeService.listDepartments(propertyId),
        employeeService.listRoles(propertyId),
      ]);
      setRows(invitationRows || []);
      setDepartments(depts || []);
      setRoles(roleRows || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [propertyId, reloadKey]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Could not copy — select the link manually.');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await employeeService.createInvitation({
        propertyId,
        email: form.email,
        fullName: form.fullName,
        staffRole: form.role,
        assignedModules: getDefaultModulesForRole(form.role),
        roleId: form.roleId || null,
        departmentId: form.departmentId || null,
      });
      const token = result?.token;
      setForm(emptyForm);
      setFormOpen(false);
      load();
      if (token) {
        try {
          await employeeService.sendInvitationEmail(result.invitation.id, token);
          toast.success(`Invitation email sent to ${result.invitation.email}.`);
        } catch (emailError) {
          // Edge function not deployed or transport failed: the token is still
          // valid, so fall back to the manual link.
          setOneTimeLink({ email: result.invitation.email, url: inviteUrl(token) });
          toast.warning('Invitation created, but the email could not be sent. Share the link manually.');
        }
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (row) => {
    setBusy(true);
    try {
      const result = await employeeService.resendInvitation(row.id);
      if (result?.token) {
        try {
          await employeeService.sendInvitationEmail(row.id, result.token);
          toast.success(`Invitation email re-sent to ${result.email}.`);
        } catch {
          setOneTimeLink({ email: result.email, url: inviteUrl(result.token) });
          toast.warning('Token regenerated; the email could not be sent. Share the link manually.');
        }
      }
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const revoke = async (row) => {
    if (!window.confirm(`Revoke the pending invitation for ${row.email}?`)) return;
    try {
      await employeeService.revokeInvitation(row.id);
      toast.success('Invitation revoked.');
      load();
    } catch (e) { toast.error(e.message); }
  };

  const inputClass = 'w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';

  return (
    <div>
      {oneTimeLink && (
        <div role="alert" className="mb-3 rounded-xl border border-[var(--brand-blue)] bg-[var(--primary-soft)] px-4 py-3 text-sm text-[var(--text)]">
          <p className="font-bold">One-time invitation link for {oneTimeLink.email}</p>
          <p className="mt-1 break-all text-xs text-[var(--text-muted)]">{oneTimeLink.url}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => copy(oneTimeLink.url)} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)]"><Copy size={13} /> Copy link</button>
            <button type="button" onClick={() => setOneTimeLink(null)} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)]">Done</button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">This link is shown only once. It expires in 7 days and works for exactly one claim.</p>
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <button type="button" onClick={() => setFormOpen((v) => !v)}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-xs font-bold text-primary-foreground">
          <Plus size={15} /> Invite employee
        </button>
      </div>

      {formOpen && (
        <form onSubmit={submit} className="mb-4 rounded-2xl border border-[var(--border)] bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="inv-email" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Email</label>
              <input id="inv-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`mt-1 ${inputClass}`} />
            </div>
            <div>
              <label htmlFor="inv-name" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Full name</label>
              <input id="inv-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={`mt-1 ${inputClass}`} />
            </div>
            <div>
              <label htmlFor="inv-role" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Staff role</label>
              <select id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={`mt-1 ${inputClass}`}>
                {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="inv-dept" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Department</label>
              <select id="inv-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className={`mt-1 ${inputClass}`}>
                <option value="">— none —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="inv-bundle" className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Permission bundle</label>
              <select id="inv-bundle" value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} className={`mt-1 ${inputClass}`}>
                <option value="">— role defaults —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setFormOpen(false); setForm(emptyForm); }}
              className="min-h-10 rounded-xl border border-[var(--border)] px-4 text-sm font-semibold text-[var(--text)]">Cancel</button>
            <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send invitation
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-primary text-primary-foreground">
            <tr><th className="p-3 text-left">Invitee</th><th className="p-3 text-left">Staff role</th><th className="p-3 text-left">Status</th><th className="p-3 text-left">Expires</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="p-6 text-center text-[var(--text-muted)]">Loading…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={5} className="p-6 text-center text-[var(--text-muted)]">No invitations yet.</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--border)]">
                <td className="p-3">
                  <div className="font-bold text-[var(--text)]">{row.full_name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{row.email}</div>
                </td>
                <td className="p-3 capitalize text-[var(--text)]">{String(row.staff_role || '').replaceAll('_', ' ')}</td>
                <td className="p-3">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${row.status === 'pending' ? 'bg-[var(--primary-soft)] text-[var(--primary)]' : row.status === 'accepted' ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'bg-[var(--canvas)] text-[var(--text-muted)]'}`}>{row.status}</span>
                </td>
                <td className="p-3 text-xs text-[var(--text-muted)]">{row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '—'}</td>
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    {row.status === 'pending' && (
                      <>
                        <button type="button" disabled={busy} onClick={() => resend(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--primary-soft)] disabled:opacity-50"><Mail size={13} /> Resend</button>
                        <button type="button" onClick={() => revoke(row)} aria-label={`Revoke invitation for ${row.email}`}
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
