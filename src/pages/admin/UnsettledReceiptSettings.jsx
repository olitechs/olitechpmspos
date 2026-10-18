import React, { useEffect, useState } from 'react';
import { Save, FileText } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getPropertySettings, savePropertySettings } from '@/services/settingsService';

export default function UnsettledReceiptSettings() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [form, setForm] = useState({
    unsettled_receipt_title: 'UNSETTLED RECEIPT',
    unsettled_receipt_copy_count: 2,
    unsettled_receipt_front_office_copy: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!propertyId) return;
    setLoading(true);
    getPropertySettings(propertyId)
      .then((row) => setForm((current) => ({
        ...current,
        unsettled_receipt_title: row?.unsettled_receipt_title || current.unsettled_receipt_title,
        unsettled_receipt_copy_count: Number(row?.unsettled_receipt_copy_count || current.unsettled_receipt_copy_count),
        unsettled_receipt_front_office_copy: row?.unsettled_receipt_front_office_copy !== false,
      })))
      .catch((e) => setError(e.message || 'Unable to load unsettled receipt settings.'))
      .finally(() => setLoading(false));
  }, [propertyId]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!propertyId) return;
    setSaving(true); setMessage(''); setError('');
    try {
      await savePropertySettings(propertyId, form);
      setMessage('Unsettled receipt settings saved.');
    } catch (e) {
      setError(e.message || 'Could not save unsettled receipt settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading unsettled receipt settings…</div>;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-[#FFF7D6] p-3"><FileText size={20} /></div>
        <div>
          <h1 className="text-xl font-black text-foreground">Unsettled Receipt Settings</h1>
          <p className="text-sm text-muted-foreground">Configure what is printed when staff use Print Bill before payment is settled.</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-5">
          <label className="text-sm font-bold text-foreground">
            Receipt title
            <input
              value={form.unsettled_receipt_title}
              onChange={(e) => update('unsettled_receipt_title', e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5 outline-none focus:border-primary"
            />
          </label>

          <label className="text-sm font-bold text-foreground">
            Number of copies
            <select
              value={form.unsettled_receipt_copy_count}
              onChange={(e) => update('unsettled_receipt_copy_count', Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2.5"
            >
              <option value={1}>1 copy — Customer</option>
              <option value={2}>2 copies — Customer + Front Office</option>
            </select>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-4">
            <input
              type="checkbox"
              checked={form.unsettled_receipt_front_office_copy}
              disabled={Number(form.unsettled_receipt_copy_count) < 2}
              onChange={(e) => update('unsettled_receipt_front_office_copy', e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-bold text-foreground">Print Front Office copy</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">The second copy is labeled FRONT OFFICE COPY and uses the same assigned unsettled-bill printers.</span>
            </span>
          </label>
        </div>

        <div className="mt-5 rounded-xl bg-[#F8F8F7] p-4 text-xs leading-5 text-muted-foreground">
          Unsettled receipts are open bills. They do not include a payment method and do not mark the sale as paid. Final receipt settings remain separate.
        </div>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#090C11] px-5 py-3 text-sm font-black text-[#FFD300] disabled:opacity-50"
        >
          <Save size={16} /> {saving ? 'Saving…' : 'Save Unsettled Receipt Settings'}
        </button>
      </section>
    </div>
  );
}
