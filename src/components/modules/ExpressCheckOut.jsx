import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, LogOut, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePms } from '@/data/PmsStore';
import { pmsService } from '@/services/pmsService';

const money = (value) => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const panel = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4';

export default function ExpressCheckOut() {
  const pms = usePms();
  const inHouse = useMemo(() => (pms.reservations || []).filter((row) => row.status === 'checked-in'), [pms.reservations]);
  const [selectedId, setSelectedId] = useState('');
  const [folio, setFolio] = useState(null);
  const [loadingFolio, setLoadingFolio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!inHouse.some((row) => row.id === selectedId)) setSelectedId(inHouse[0]?.id || '');
  }, [inHouse, selectedId]);
  const selected = inHouse.find((row) => row.id === selectedId) || null;

  useEffect(() => {
    let active = true;
    if (!selected) { setFolio(null); return undefined; }
    setLoadingFolio(true); setError('');
    pmsService.getFolio(selected.id).then((result) => { if (active) setFolio(result); })
      .catch((cause) => { if (active) { setFolio(null); setError(cause.message || 'Guest folio could not be loaded.'); } })
      .finally(() => { if (active) setLoadingFolio(false); });
    return () => { active = false; };
  }, [selected?.id]);

  const balance = Number(folio?.totals?.balance);
  const balanceKnown = Number.isFinite(balance);
  const canCheckOut = !!selected && !loadingFolio && balanceKnown && balance <= 0.005;

  const refresh = async () => { setError(''); await pms.reload(); if (selected) { setLoadingFolio(true); try { setFolio(await pmsService.getFolio(selected.id)); } catch (cause) { setError(cause.message || 'Folio refresh failed.'); } finally { setLoadingFolio(false); } } };

  const completeCheckout = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await pms.checkOutRoom(selected.roomId);
      setNotice(`${selected.guestName} checked out from Room ${selected.roomNumber || '—'}. The room has been returned to housekeeping.`);
      setSelectedId('');
      setFolio(null);
    } catch (cause) { setError(cause.message || 'Checkout was not completed. Review the guest folio balance.'); }
    finally { setBusy(false); }
  };

  return <div className="h-full min-h-0 overflow-y-auto bg-[var(--canvas)] p-3 sm:p-5">
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold text-[var(--text)]">Express Check-out</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Review the guest account and complete checkout when the folio is settled.</p></div><button type="button" onClick={refresh} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold"><RefreshCw size={14}/> Refresh</button></div>
      {error && <div role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-[var(--success)] bg-[var(--success-soft)] p-3 text-sm text-[var(--success-text)]">{notice}</div>}
      <section className={panel}>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Select in-house guest</label>
        <select className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--sidebar)] px-3 text-sm text-[var(--text)]" value={selectedId} onChange={(e)=>setSelectedId(e.target.value)}><option value="">Select guest</option>{inHouse.map((row)=><option key={row.id} value={row.id}>{row.guestName} · Room {row.roomNumber || 'Unassigned'} · {row.checkOut}</option>)}</select>
        {!inHouse.length && <p className="mt-3 text-sm text-[var(--text-muted)]">No guests are currently checked in.</p>}
      </section>
      {selected && <section className={panel}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><div className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Guest</div><div className="mt-1 text-sm font-bold text-[var(--text)]">{selected.guestName}</div></div><div><div className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Room</div><div className="mt-1 text-sm font-bold text-[var(--text)]">{selected.roomNumber || 'Unassigned'}</div></div><div><div className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Arrival</div><div className="mt-1 text-sm font-bold text-[var(--text)]">{selected.checkIn}</div></div><div><div className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">Departure</div><div className="mt-1 text-sm font-bold text-[var(--text)]">{selected.checkOut}</div></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-[var(--sidebar)] p-3"><div className="text-[10px] uppercase text-[var(--text-muted)]">Folio charges</div><div className="mt-1 text-lg font-bold text-[var(--text)]">{loadingFolio?'Loading…':money(folio?.totals?.subtotal)}</div></div><div className="rounded-lg bg-[var(--sidebar)] p-3"><div className="text-[10px] uppercase text-[var(--text-muted)]">Payments posted</div><div className="mt-1 text-lg font-bold text-[var(--text)]">{loadingFolio?'Loading…':money(folio?.totals?.paid)}</div></div><div className="rounded-lg bg-[var(--sidebar)] p-3"><div className="text-[10px] uppercase text-[var(--text-muted)]">Outstanding balance</div><div className="mt-1 text-lg font-bold" style={{color:balanceKnown&&balance<=0.005?'var(--success-text)':'var(--danger-text)'}}>{loadingFolio?'Loading…':balanceKnown?money(balance):'Unavailable'}</div></div></div>
        {!loadingFolio && balanceKnown && balance>0.005 && <div className="mt-4 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning-text)]">The guest account still has an outstanding balance. Settle it in <Link to="/frontoffice/folio" className="font-bold underline">Guest Folio</Link> before checking out.</div>}
        {!loadingFolio && !balanceKnown && <p className="mt-4 text-sm text-[var(--danger-text)]">The folio balance could not be verified. Checkout is disabled until the account can be checked.</p>}
        <div className="mt-5 flex justify-end"><button type="button" disabled={!canCheckOut || busy} onClick={completeCheckout} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--white)] disabled:opacity-50"><CheckCircle2 size={16}/>{busy?'Completing…':'Confirm express check-out'}</button></div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">The server validates the folio balance again. Successful checkout marks the room dirty and creates a checkout-cleaning task.</p>
      </section>}
    </div>
  </div>;
}
