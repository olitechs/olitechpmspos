import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CreditCard, FileText, Plus, RefreshCw, Save, Trash2, Pencil, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

const field = 'min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--brand-primary)]';
const primary = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
const blankRate = { code: '', name: '', description: '', meal_plan: 'room_only', cancellation_policy: '', default_rate: '0', active: true };

export default function FrontOfficeConfiguration() {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const currency = user?.property?.currency || 'KES';
  const [tab, setTab] = useState('rates');
  const [rates, setRates] = useState([]);
  const [booking, setBooking] = useState({ enabled: false, currency, terms: '', cancellation_policy: '', payment_instructions: '' });
  const [rateForm, setRateForm] = useState(blankRate);
  const [editingId, setEditingId] = useState(null);
  const [bookingId, setBookingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [rateResult, bookingResult] = await Promise.all([
        supabase.from('rate_plans').select('id,code,name,description,meal_plan,cancellation_policy,default_rate,active,created_at').eq('property_id', propertyId).order('name'),
        supabase.from('booking_engine_settings').select('id,enabled,currency,terms,cancellation_policy,payment_instructions').eq('property_id', propertyId).maybeSingle(),
      ]);
      if (rateResult.error) throw rateResult.error;
      if (bookingResult.error) throw bookingResult.error;
      setRates(rateResult.data || []);
      if (bookingResult.data) {
        setBookingId(bookingResult.data.id);
        setBooking({ enabled: !!bookingResult.data.enabled, currency: bookingResult.data.currency || currency, terms: bookingResult.data.terms || '', cancellation_policy: bookingResult.data.cancellation_policy || '', payment_instructions: bookingResult.data.payment_instructions || '' });
      } else {
        setBookingId(null);
        setBooking({ enabled: false, currency, terms: '', cancellation_policy: '', payment_instructions: '' });
      }
    } catch (error) {
      toast.error(error.message || 'Unable to load property configuration.');
    } finally { setLoading(false); }
  }, [propertyId, currency]);

  useEffect(() => { load(); }, [load]);

  const saveRate = async event => {
    event.preventDefault();
    const payload = {
      property_id: propertyId,
      code: rateForm.code.trim().toUpperCase().replace(/\s+/g, '_'),
      name: rateForm.name.trim(),
      description: rateForm.description.trim() || null,
      meal_plan: rateForm.meal_plan,
      cancellation_policy: rateForm.cancellation_policy.trim() || null,
      default_rate: Number(rateForm.default_rate),
      active: !!rateForm.active,
    };
    if (!payload.code || !payload.name || !Number.isFinite(payload.default_rate) || payload.default_rate < 0) {
      toast.error('Enter a code, name and a valid non-negative nightly rate.');
      return;
    }
    setSaving(true);
    try {
      const query = editingId
        ? supabase.from('rate_plans').update(payload).eq('id', editingId).eq('property_id', propertyId)
        : supabase.from('rate_plans').insert(payload);
      const { error } = await query;
      if (error) throw error;
      toast.success(editingId ? 'Rate plan updated.' : 'Rate plan created.');
      setRateForm(blankRate); setEditingId(null); await load();
    } catch (error) { toast.error(error.message || 'Unable to save rate plan.'); }
    finally { setSaving(false); }
  };

  const editRate = rate => {
    setEditingId(rate.id);
    setRateForm({ code: rate.code || '', name: rate.name || '', description: rate.description || '', meal_plan: rate.meal_plan || 'room_only', cancellation_policy: rate.cancellation_policy || '', default_rate: String(rate.default_rate ?? 0), active: rate.active !== false });
  };

  const deleteRate = async rate => {
    if (!window.confirm('Delete rate plan "' + rate.name + '"? Existing reservations are not changed.')) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('rate_plans').delete().eq('id', rate.id).eq('property_id', propertyId);
      if (error) throw error;
      toast.success('Rate plan deleted.'); await load();
    } catch (error) { toast.error(error.message || 'Unable to delete rate plan.'); }
    finally { setSaving(false); }
  };

  const saveBooking = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { property_id: propertyId, enabled: !!booking.enabled, currency: booking.currency.trim().toUpperCase() || currency, terms: booking.terms.trim() || null, cancellation_policy: booking.cancellation_policy.trim() || null, payment_instructions: booking.payment_instructions.trim() || null, updated_at: new Date().toISOString() };
      const query = bookingId
        ? supabase.from('booking_engine_settings').update(payload).eq('id', bookingId).eq('property_id', propertyId)
        : supabase.from('booking_engine_settings').insert(payload);
      const { error } = await query;
      if (error) throw error;
      toast.success('Booking policies saved.'); await load();
    } catch (error) { toast.error(error.message || 'Unable to save booking policies.'); }
    finally { setSaving(false); }
  };

  const tabs = [
    { id: 'rates', label: 'Rate plans', icon: CreditCard },
    { id: 'booking', label: 'Booking policies', icon: FileText },
  ];

  return <div className="h-full overflow-y-auto bg-[var(--canvas)] p-4 md:p-6">
    <div className="mx-auto max-w-[1280px] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Front Office / Property setup</p><h1 className="mt-1 text-2xl font-black text-[var(--text)]">Configuration</h1><p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">Manage property rate plans and the policies shown to guests during direct booking. All records are scoped to the signed-in property.</p></div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold"><RefreshCw size={15}/> Refresh</button>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Rate plans', rates.length], ['Active plans', rates.filter(r => r.active).length], ['Booking engine', booking.enabled ? 'Enabled' : 'Disabled'], ['Property currency', currency]].map(([label,value]) => <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="mt-1 text-xl font-black text-[var(--text)]">{loading ? '—' : value}</div></div>)}
      </div>
      <nav className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3" aria-label="Configuration sections">
        {tabs.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-pressed={tab === item.id} className={['inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold', tab === item.id ? 'bg-[var(--brand-primary)] text-white' : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'].join(' ')}><Icon size={15}/>{item.label}</button>; })}
      </nav>
      {loading ? <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center text-sm text-[var(--text-muted)]">Loading property configuration…</div> : <>
        {tab === 'rates' && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] p-4"><h2 className="font-bold text-[var(--text)]">Property rate plans</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Default nightly rates and meal/cancellation terms. Editing a plan does not rewrite existing reservations.</p></div>
            <div className="divide-y divide-[var(--border)]">
              {rates.map(rate => <article key={rate.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-[var(--text)]">{rate.name}</h3><span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold">{rate.code}</span><span className={['rounded-full px-2 py-0.5 text-[10px] font-bold',rate.active?'bg-[var(--success-soft)] text-[var(--success-text)]':'bg-[var(--surface-2)] text-[var(--text-muted)]'].join(' ')}>{rate.active?'Active':'Inactive'}</span></div><p className="mt-1 text-xs text-[var(--text-muted)]">{rate.meal_plan?.replaceAll('_',' ')} · {rate.cancellation_policy || 'No cancellation terms'}</p></div>
                <div className="flex items-center justify-between gap-3 sm:justify-end"><strong className="whitespace-nowrap text-lg tabular-nums text-[var(--text)]">{currency} {Number(rate.default_rate || 0).toLocaleString()}</strong><button type="button" onClick={() => editRate(rate)} aria-label={'Edit '+rate.name} className="rounded-lg border border-[var(--border)] p-2"><Pencil size={15}/></button><button type="button" onClick={() => deleteRate(rate)} disabled={saving} aria-label={'Delete '+rate.name} className="rounded-lg border border-[var(--border)] p-2 text-[var(--danger-text)]"><Trash2 size={15}/></button></div>
              </article>)}
              {!rates.length && <div className="p-10 text-center text-sm text-[var(--text-muted)]">No rate plans configured. Add your first plan to get started.</div>}
            </div>
          </section>
          <form onSubmit={saveRate} className="h-fit space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between"><h2 className="font-bold text-[var(--text)]">{editingId ? 'Edit rate plan' : 'Add rate plan'}</h2>{editingId && <button type="button" onClick={() => {setEditingId(null);setRateForm(blankRate);}} className="text-xs font-semibold text-[var(--brand-primary)]">Cancel edit</button>}</div>
            <label className="block text-xs font-semibold">Plan code<input required maxLength={30} className={field+' mt-1'} value={rateForm.code} onChange={e=>setRateForm(v=>({...v,code:e.target.value}))} placeholder="FLEXIBLE"/></label>
            <label className="block text-xs font-semibold">Plan name<input required className={field+' mt-1'} value={rateForm.name} onChange={e=>setRateForm(v=>({...v,name:e.target.value}))} placeholder="Flexible Rate"/></label>
            <label className="block text-xs font-semibold">Default nightly rate ({currency})<input required type="number" min="0" step="0.01" className={field+' mt-1'} value={rateForm.default_rate} onChange={e=>setRateForm(v=>({...v,default_rate:e.target.value}))}/></label>
            <label className="block text-xs font-semibold">Meal plan<select className={field+' mt-1'} value={rateForm.meal_plan} onChange={e=>setRateForm(v=>({...v,meal_plan:e.target.value}))}><option value="room_only">Room only</option><option value="bed_and_breakfast">Bed & breakfast</option><option value="half_board">Half board</option><option value="full_board">Full board</option><option value="all_inclusive">All inclusive</option></select></label>
            <label className="block text-xs font-semibold">Cancellation policy<textarea rows={2} className={field+' mt-1'} value={rateForm.cancellation_policy} onChange={e=>setRateForm(v=>({...v,cancellation_policy:e.target.value}))}/></label>
            <label className="block text-xs font-semibold">Description<textarea rows={2} className={field+' mt-1'} value={rateForm.description} onChange={e=>setRateForm(v=>({...v,description:e.target.value}))}/></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rateForm.active} onChange={e=>setRateForm(v=>({...v,active:e.target.checked}))}/> Active and available for use</label>
            <button disabled={saving} className={primary+' w-full'}><Plus size={15}/>{saving?'Saving…':editingId?'Save changes':'Create rate plan'}</button>
          </form>
        </div>}
        {tab === 'booking' && <form onSubmit={saveBooking} className="max-w-3xl space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 md:p-6">
          <div className="flex items-start gap-3"><div className="rounded-lg bg-[var(--surface-2)] p-2"><CalendarDays size={19}/></div><div><h2 className="font-bold text-[var(--text)]">Direct booking policies</h2><p className="mt-1 text-xs text-[var(--text-muted)]">These settings are stored against this property. Enabling the engine here does not itself publish or connect an external booking channel.</p></div></div>
          <label className="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-[var(--border)] p-3"><span><span className="block text-sm font-semibold">Enable direct booking engine</span><span className="text-xs text-[var(--text-muted)]">Allow the public booking flow to use this property's configuration.</span></span><input type="checkbox" checked={booking.enabled} onChange={e=>setBooking(v=>({...v,enabled:e.target.checked}))} className="h-5 w-5"/></label>
          <label className="block text-xs font-semibold">Booking currency<input maxLength={3} className={field+' mt-1'} value={booking.currency} onChange={e=>setBooking(v=>({...v,currency:e.target.value.toUpperCase()}))} placeholder="KES"/></label>
          <label className="block text-xs font-semibold">Guest booking terms<textarea rows={4} className={field+' mt-1'} value={booking.terms} onChange={e=>setBooking(v=>({...v,terms:e.target.value}))} placeholder="Terms guests must accept when booking…"/></label>
          <label className="block text-xs font-semibold">Cancellation and no-show policy<textarea rows={4} className={field+' mt-1'} value={booking.cancellation_policy} onChange={e=>setBooking(v=>({...v,cancellation_policy:e.target.value}))} placeholder="Explain cancellation windows, fees and no-show handling…"/></label>
          <label className="block text-xs font-semibold">Payment instructions<textarea rows={3} className={field+' mt-1'} value={booking.payment_instructions} onChange={e=>setBooking(v=>({...v,payment_instructions:e.target.value}))} placeholder="Explain accepted payment methods and reference requirements…"/></label>
          <button disabled={saving} className={primary}><Save size={15}/>{saving?'Saving…':'Save booking policies'}</button>
        </form>}
      </>}
      <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text-muted)]"><ShieldCheck size={16} className="mt-0.5 shrink-0"/><span>Rates, booking terms and payment instructions are property-scoped. Payment types and tax configuration remain in Back Office settings; room types remain in Structure. Seasonal pricing, document templates and fine-grained role permissions are not exposed here yet, so this page does not create duplicate configuration systems.</span></div>
    </div>
  </div>;
}
