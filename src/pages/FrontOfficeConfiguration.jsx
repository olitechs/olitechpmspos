import { useCallback, useEffect, useState } from 'react';
import { Building2, CalendarClock, CreditCard, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { backOfficeService } from '@/services/backOfficeService';
import { getPropertySettings, savePropertySettings } from '@/services/settingsService';
import { Link } from 'react-router-dom';

const input = 'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)]';
const sections = [
  { id: 'rates', label: 'Room rates', icon: CalendarClock },
  { id: 'payments', label: 'Payment methods', icon: CreditCard },
  { id: 'taxes', label: 'Taxes', icon: ShieldCheck },
  { id: 'company', label: 'Property details', icon: Building2 },
];
const emptyRate = { code: '', name: '', meal_plan: 'room_only', default_rate: '0', cancellation_policy: '' };

export default function FrontOfficeConfiguration() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [section, setSection] = useState('rates');
  const [rates, setRates] = useState([]);
  const [payments, setPayments] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [company, setCompany] = useState({});
  const [draft, setDraft] = useState(emptyRate);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [rateRows, paymentRows, taxRows, companyRow] = await Promise.all([
        supabase.from('rate_plans').select('*').eq('property_id', propertyId).order('name'),
        backOfficeService.listPaymentTypes(propertyId),
        backOfficeService.listTaxes(propertyId),
        getPropertySettings(propertyId),
      ]);
      if (rateRows.error) throw rateRows.error;
      setRates(rateRows.data || []);
      setPayments(paymentRows || []);
      setTaxes(taxRows || []);
      setCompany(companyRow || {});
    } catch (error) { toast.error(error.message || 'Unable to load property configuration.'); }
    finally { setLoading(false); }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const saveRate = async event => {
    event.preventDefault();
    if (!propertyId || !draft.name.trim() || !draft.code.trim()) return;
    setBusy(true);
    try {
      const payload = {
        property_id: propertyId,
        code: draft.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_'),
        name: draft.name.trim(),
        meal_plan: draft.meal_plan,
        default_rate: Math.max(0, Number(draft.default_rate) || 0),
        cancellation_policy: draft.cancellation_policy.trim() || null,
        active: true,
      };
      const query = editing
        ? supabase.from('rate_plans').update(payload).eq('id', editing).eq('property_id', propertyId)
        : supabase.from('rate_plans').insert(payload);
      const { error } = await query;
      if (error) throw error;
      setDraft(emptyRate); setEditing(null); await load(); toast.success('Room rate plan saved.');
    } catch (error) { toast.error(error.message || 'Could not save rate plan.'); }
    finally { setBusy(false); }
  };

  const editRate = row => {
    setEditing(row.id);
    setDraft({ code: row.code || '', name: row.name || '', meal_plan: row.meal_plan || 'room_only', default_rate: String(row.default_rate ?? 0), cancellation_policy: row.cancellation_policy || '' });
    setSection('rates');
  };

  const archiveRate = async row => {
    if (!window.confirm('Deactivate this rate plan? Existing reservations will keep their saved rates.')) return;
    try {
      const { error } = await supabase.from('rate_plans').update({ active: false }).eq('id', row.id).eq('property_id', propertyId);
      if (error) throw error;
      await load(); toast.success('Rate plan deactivated.');
    } catch (error) { toast.error(error.message || 'Could not deactivate rate plan.'); }
  };

  const saveCompany = async event => {
    event.preventDefault(); setBusy(true);
    try { await savePropertySettings(propertyId, company); await load(); toast.success('Property receipt details saved.'); }
    catch (error) { toast.error(error.message || 'Could not save property details.'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-full bg-[var(--canvas)] p-4 text-[var(--text)] sm:p-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Front Office · Setup</div><h1 className="mt-1 text-2xl font-bold">Property Configuration</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Manage rates and property settings using the existing PMS configuration services.</p></div><button type="button" onClick={load} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><RefreshCw size={15}/> Refresh</button></header>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Property configuration sections">{sections.map(item => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={section === item.id} onClick={() => setSection(item.id)} className={['inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold', section === item.id ? 'bg-[var(--brand-primary)] text-white' : 'border border-[var(--border)] bg-[var(--surface)]'].join(' ')}><Icon size={15}/>{item.label}</button>; })}</div>
      {loading ? <div className="space-y-3"><div className="h-24 animate-pulse rounded-xl bg-[var(--surface-2)]"/><div className="h-64 animate-pulse rounded-xl bg-[var(--surface-2)]"/></div> : <>
        {section === 'rates' && <div className="space-y-4">
          <form onSubmit={saveRate} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs font-semibold">Rate code<input required maxLength={24} value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} className={input + ' mt-1'} placeholder="BBL"/></label>
            <label className="text-xs font-semibold">Rate name<input required maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={input + ' mt-1'} placeholder="Bed & breakfast"/></label>
            <label className="text-xs font-semibold">Meal plan<select value={draft.meal_plan} onChange={e => setDraft({ ...draft, meal_plan: e.target.value })} className={input + ' mt-1'}>{[['room_only','Room only'],['bed_only','Bed only'],['breakfast','Breakfast'],['half_board','Half board'],['full_board','Full board'],['all_inclusive','All inclusive']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="text-xs font-semibold">Default rate<input required type="number" min="0" step="0.01" value={draft.default_rate} onChange={e => setDraft({ ...draft, default_rate: e.target.value })} className={input + ' mt-1'}/></label>
            <label className="text-xs font-semibold">Cancellation policy<input maxLength={500} value={draft.cancellation_policy} onChange={e => setDraft({ ...draft, cancellation_policy: e.target.value })} className={input + ' mt-1'} placeholder="Optional policy"/></label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-5"><button disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50"><Plus size={15}/>{editing ? 'Update rate plan' : 'Add rate plan'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setDraft(emptyRate); }} className="rounded-lg border px-4 text-sm">Cancel edit</button>}</div>
          </form>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]"><table className="w-full min-w-[680px] text-sm"><thead className="bg-[var(--sidebar)] text-left text-xs uppercase"><tr>{['Code','Rate plan','Meal plan','Default rate','Status',''].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{rates.map(row => <tr key={row.id} className="border-t border-[var(--border)]"><td className="p-3 font-mono">{row.code}</td><td className="p-3 font-semibold">{row.name}</td><td className="p-3 capitalize">{String(row.meal_plan || '').replaceAll('_',' ')}</td><td className="p-3 tabular-nums">{new Intl.NumberFormat(undefined, { style: 'currency', currency: user?.property?.currency || 'KES' }).format(Number(row.default_rate || 0))}</td><td className="p-3">{row.active ? 'Active' : 'Inactive'}</td><td className="p-3 text-right"><button type="button" onClick={() => editRate(row)} className="mr-2 rounded-md border px-3 py-1.5 text-xs">Edit</button>{row.active && <button type="button" onClick={() => archiveRate(row)} className="rounded-md border px-3 py-1.5 text-xs text-[var(--danger-text)]">Deactivate</button>}</td></tr>)}</tbody></table>{!rates.length && <p className="p-8 text-center text-sm text-[var(--text-muted)]">No rate plans configured.</p>}</div>
        </div>}
        {section === 'payments' && <DataList title="Payment methods" rows={payments} fields={['name','code','active']} empty="No payment methods configured."/>}
        {section === 'taxes' && <DataList title="Tax configuration" rows={taxes} fields={['name','rate','inclusive','active']} empty="No tax rules configured."/>}
        {section === 'company' && <form onSubmit={saveCompany} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2">
          {[[ 'property_name','Property name'],['address_line1','Address line 1'],['address_line2','Address line 2'],['phone','Phone'],['email','Email'],['website','Website'],['kra_pin','KRA PIN'],['footer_line1','Receipt footer line 1'],['footer_line2','Receipt footer line 2']].map(([key,label]) => <label key={key} className="text-xs font-semibold">{label}<input value={company[key] || ''} onChange={e => setCompany({ ...company, [key]: e.target.value })} className={input + ' mt-1'}/></label>)}
          <div className="sm:col-span-2"><button disabled={busy} className="rounded-lg bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save property details</button></div>
        </form>}
      </>}
      <div className="grid gap-3 sm:grid-cols-2"><Link to="/backoffice/settings/payment-types" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm hover:border-[var(--brand-primary)]"><div className="font-semibold">Advanced payment settings</div><p className="mt-1 text-xs text-[var(--text-muted)]">Manage payment type activation and references in the existing Back Office settings.</p></Link><Link to="/backoffice/settings/receipt" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm hover:border-[var(--brand-primary)]"><div className="font-semibold">Receipt templates and printing</div><p className="mt-1 text-xs text-[var(--text-muted)]">Open the existing receipt settings and printer workflow.</p></Link></div>
    </div>
  </div>;
}

function DataList({ title, rows, fields, empty }) {
  return <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="border-b border-[var(--border)] p-4 font-semibold">{title}</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--sidebar)] text-left text-xs uppercase"><tr>{fields.map(field => <th key={field} className="p-3">{field.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-[var(--border)]">{fields.map(field => <td key={field} className="p-3">{field === 'active' ? (row.active ? 'Active' : 'Inactive') : field === 'inclusive' ? (row.inclusive ? 'Inclusive' : 'Exclusive') : field === 'rate' ? Number(row.rate || 0) + '%' : row[field] ?? '—'}</td>)}</tr>)}</tbody></table></div>{!rows.length && <p className="p-8 text-center text-sm text-[var(--text-muted)]">{empty}</p>}</section>;
}
