import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, RefreshCw, Building2, Settings2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import storesService from '@/services/storesService';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const TYPES = [
  ['kitchen', 'Kitchen'],
  ['bar', 'Bar'],
  ['restaurant', 'Restaurant'],
  ['housekeeping', 'Housekeeping'],
  ['laundry', 'Laundry'],
  ['maintenance', 'Maintenance'],
  ['front_office', 'Front Office'],
  ['spa', 'Spa'],
  ['admin', 'Admin'],
  ['other', 'Other'],
];

const FIELD = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]';
const PANEL = 'rounded-xl border border-[var(--border)] bg-[var(--surface)]';

const EMPTY_FORM = {
  id: '',
  name: '',
  code: '',
  type: 'other',
  default_location_id: '',
  consumes_on_issue: false,
  approval_required: true,
  approval_limit: '0',
  active: true,
};

function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex min-h-11 items-start gap-3 py-1">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
      />
      <span className="text-sm">
        <span className="block font-medium text-[var(--text)]">{label}</span>
        {description ? <span className="block text-xs text-[var(--text-muted)]">{description}</span> : null}
      </span>
    </label>
  );
}

export default function CostCentresPage() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;

  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError('');
    try {
      const [centres, locationsData, settingsData] = await Promise.all([
        storesService.listCostCentres(propertyId),
        storesService.listLocations(propertyId),
        storesService.getSettings(propertyId),
      ]);
      setRows(Array.isArray(centres?.rows) ? centres.rows : []);
      setCanManage(Boolean(centres?.can_manage));
      setLocations(Array.isArray(locationsData?.rows) ? locationsData.rows : []);
      setSettingsDraft(settingsData);
    } catch (err) {
      setError(err?.message || 'Unable to load cost centres.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, default_location_id: locations[0]?.id || '' });
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      name: row.name,
      code: row.code,
      type: row.type,
      default_location_id: row.default_location_id || '',
      consumes_on_issue: Boolean(row.consumes_on_issue),
      approval_required: Boolean(row.approval_required),
      approval_limit: String(row.approval_limit ?? 0),
      active: Boolean(row.active),
    });
    setFormOpen(true);
  };

  const saveCostCentre = async () => {
    if (!form.name.trim()) {
      toast.error('A cost centre name is required.');
      return;
    }
    if (!/^[a-z0-9_]{2,32}$/.test(form.code || '')) {
      toast.error('Use 2-32 lowercase letters, digits or underscores for the code.');
      return;
    }
    setSaving(true);
    try {
      await storesService.upsertCostCentre(propertyId, {
        id: form.id || undefined,
        name: form.name.trim(),
        code: form.code.trim().toLowerCase(),
        type: form.type,
        default_location_id: form.default_location_id || null,
        consumes_on_issue: form.consumes_on_issue,
        approval_required: form.approval_required,
        approval_limit: Number(form.approval_limit || 0),
        active: form.active,
      });
      toast.success(form.id ? 'Cost centre updated.' : 'Cost centre created.');
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || 'Unable to save the cost centre.');
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const updated = await storesService.updateSettings(propertyId, {
        segregation_of_duties: settingsDraft.segregation_of_duties,
        requisition_approval_required: settingsDraft.requisition_approval_required,
        direct_issue_enabled: settingsDraft.direct_issue_enabled,
        issue_discrepancy_window_hours: Number(settingsDraft.issue_discrepancy_window_hours),
        transfer_overdue_hours: Number(settingsDraft.transfer_overdue_hours),
      });
      setSettingsDraft(updated);
      toast.success('Stores settings saved.');
    } catch (err) {
      toast.error(err?.message || 'Unable to save Stores settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setSetting = (key, value) => setSettingsDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="min-h-full bg-[var(--canvas)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-normal text-[var(--text)]">Cost centres</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Departments that request and receive stock, their default issuing store and approval rules.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            {canManage ? (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95"
              >
                <Plus size={16} /> New cost centre
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger-text)]" role="alert">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className={`${PANEL} overflow-hidden`} aria-labelledby="cost-centres-heading">
            <h2 id="cost-centres-heading" className="border-b border-[var(--border)] px-4 py-3 text-base font-semibold text-[var(--text)]">
              Departments
            </h2>
            {loading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded bg-[var(--border)]/40" />)}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <Building2 size={30} className="mx-auto mb-2 text-[var(--text-muted)]" />
                <p className="text-sm font-medium text-[var(--text)]">No cost centres yet</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  {canManage ? 'Create a cost centre to start receiving requests.' : 'Ask a Stores manager to configure cost centres.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--text)]">{row.name}</span>
                        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{row.code}</span>
                        {!row.active ? <span className="rounded-full bg-[var(--canvas)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">Inactive</span> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {row.default_location_name || 'No default store'}
                        {row.consumes_on_issue ? ' · Consumes on issue' : ' · Moves to department'}
                        {row.approval_required ? ' · Approval required' : ' · No approval'}
                      </p>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]"
                      >
                        <Pencil size={15} /> Edit
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="space-y-4">
            <section className={`${PANEL} p-4`} aria-labelledby="stores-settings-heading">
              <h2 id="stores-settings-heading" className="mb-3 flex items-center gap-2 text-base font-semibold text-[var(--text)]">
                <Settings2 size={17} /> Stores settings
              </h2>
              {loading || !settingsDraft ? (
                <div className="h-40 animate-pulse rounded bg-[var(--border)]/40" />
              ) : (
                <div className="space-y-3">
                  <Toggle
                    label="Segregation of duties"
                    description="The requester cannot approve and the issuer cannot confirm receipt."
                    checked={settingsDraft.segregation_of_duties}
                    onChange={(value) => canManage && setSetting('segregation_of_duties', value)}
                  />
                  <Toggle
                    label="Requisitions need approval"
                    description="Applies unless a cost centre opts out."
                    checked={settingsDraft.requisition_approval_required}
                    onChange={(value) => canManage && setSetting('requisition_approval_required', value)}
                  />
                  <Toggle
                    label="Allow direct issues"
                    description="Stores can issue without a requisition, always against a cost centre."
                    checked={settingsDraft.direct_issue_enabled}
                    onChange={(value) => canManage && setSetting('direct_issue_enabled', value)}
                  />
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-[var(--text)]">Receipt discrepancy window (hours)</span>
                    <input
                      type="number"
                      min="0"
                      className={FIELD}
                      value={settingsDraft.issue_discrepancy_window_hours}
                      onChange={(event) => setSetting('issue_discrepancy_window_hours', event.target.value)}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium text-[var(--text)]">Transfer overdue after (hours)</span>
                    <input
                      type="number"
                      min="0"
                      className={FIELD}
                      value={settingsDraft.transfer_overdue_hours}
                      onChange={(event) => setSetting('transfer_overdue_hours', event.target.value)}
                    />
                  </label>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={saveSettings}
                      disabled={savingSettings}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95 disabled:opacity-50"
                    >
                      {savingSettings ? 'Saving…' : 'Save settings'}
                    </button>
                  ) : (
                    <p className="rounded-md bg-[var(--canvas)] px-3 py-2 text-xs text-[var(--text-muted)]">
                      You can view these settings but not change them.
                    </p>
                  )}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit cost centre' : 'New cost centre'}</DialogTitle>
            <DialogDescription>Departments receive stock here and set their own approval rules.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-[var(--text)]">Name</span>
                <input className={FIELD} value={form.name} onChange={(event) => setValue('name', event.target.value)} placeholder="e.g. Kitchen" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-[var(--text)]">Code</span>
                <input className={FIELD} value={form.code} onChange={(event) => setValue('code', event.target.value.toLowerCase())} placeholder="e.g. kitchen" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-[var(--text)]">Type</span>
                <select className={FIELD} value={form.type} onChange={(event) => setValue('type', event.target.value)}>
                  {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-[var(--text)]">Default issuing store</span>
                <select className={FIELD} value={form.default_location_id} onChange={(event) => setValue('default_location_id', event.target.value)}>
                  <option value="">Use property default</option>
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium text-[var(--text)]">Approval limit</span>
                <input type="number" min="0" step="0.01" className={FIELD} value={form.approval_limit} onChange={(event) => setValue('approval_limit', event.target.value)} />
              </label>
            </div>
            <Toggle
              label="Consumes on issue"
              description="On: stock leaves the store (Kitchen, Bar). Off: stock moves to the department location."
              checked={form.consumes_on_issue}
              onChange={(value) => setValue('consumes_on_issue', value)}
            />
            <Toggle
              label="Approval required"
              description="Requests from this department must be approved before issue."
              checked={form.approval_required}
              onChange={(value) => setValue('approval_required', value)}
            />
            <Toggle
              label="Active"
              description="Inactive cost centres cannot be selected on new requests."
              checked={form.active}
              onChange={(value) => setValue('active', value)}
            />
          </DialogBody>
          <DialogFooter>
            <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--border)] px-4 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={saveCostCentre} disabled={saving} className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-95 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save cost centre'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
