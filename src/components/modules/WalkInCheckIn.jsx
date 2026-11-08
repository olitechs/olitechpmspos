import React, { useMemo, useState } from 'react';
import { DoorOpen, RefreshCw, UserRound } from 'lucide-react';
import { usePms } from '@/data/PmsStore';
import { getPmsDateKey } from '@/lib/pmsDateUtils';

const field = 'min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]';
const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]';
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const nextDay = (key) => { const date = new Date(key + 'T12:00:00'); date.setDate(date.getDate() + 1); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };

export default function WalkInCheckIn() {
  const pms = usePms();
  const today = getPmsDateKey();
  const availableRooms = useMemo(() => (pms.rooms || []).filter((room) => room.active !== false && room.status === 'available'), [pms.rooms]);
  const [roomId, setRoomId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [phone, setPhone] = useState('');
  const [arrival, setArrival] = useState(today);
  const [departure, setDeparture] = useState(nextDay(today));
  const [partySize, setPartySize] = useState('1');
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const room = availableRooms.find((item) => item.id === roomId) || null;
  const nights = arrival && departure ? Math.max(0, Math.round((new Date(departure+'T00:00:00') - new Date(arrival+'T00:00:00')) / 86400000)) : 0;

  const submit = async (event) => {
    event.preventDefault();
    setError(''); setNotice('');
    if (!room) return setError('Select an available room.');
    if (!guestName.trim()) return setError('Guest name is required.');
    if (arrival !== today) return setError('A walk-in check-in must use today’s property date.');
    if (!departure || departure <= arrival) return setError('Check-out must be after check-in.');
    if (Number(partySize) < 1 || Number(partySize) > Number(room.capacity || 2)) return setError(`This room accommodates up to ${room.capacity || 2} guests.`);
    if (!Number.isFinite(Number(rate)) || Number(rate) < 0) return setError('Enter a valid nightly room rate.');
    setBusy(true);
    try {
      await pms.checkInRoom(room.id, { name: guestName.trim(), phone: phone.trim(), checkIn: arrival, checkOut: departure, partySize: Number(partySize), rate: Number(rate) });
      setNotice(`${guestName.trim()} checked in to Room ${room.number}.`);
      setGuestName(''); setPhone(''); setRate(''); setPartySize('1'); setRoomId('');
    } catch (cause) { setError(cause.message || 'Walk-in check-in could not be completed.'); }
    finally { setBusy(false); }
  };

  return <div className="h-full min-h-0 overflow-y-auto bg-[var(--canvas)] p-3 sm:p-5">
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold text-[var(--text)]">Walk-in Check-in</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Assign an available room and register a guest arriving today.</p></div><button type="button" onClick={pms.reload} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold"><RefreshCw size={14}/> Refresh rooms</button></div>
      {error && <div role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-[var(--success)] bg-[var(--success-soft)] p-3 text-sm text-[var(--success-text)]">{notice}</div>}
      <form onSubmit={submit} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><UserRound size={17} className="text-[var(--primary)]"/><h2 className="text-sm font-bold text-[var(--text)]">Guest and stay details</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className={label}>Guest full name *</span><input required className={field} value={guestName} onChange={(e)=>setGuestName(e.target.value)} autoComplete="name"/></label>
          <label><span className={label}>Phone number</span><input type="tel" className={field} value={phone} onChange={(e)=>setPhone(e.target.value)} autoComplete="tel"/></label>
          <label><span className={label}>Available room *</span><select required className={field} value={roomId} onChange={(e)=>setRoomId(e.target.value)}><option value="">Select room</option>{availableRooms.map((item)=><option key={item.id} value={item.id}>Room {item.number} · {item.roomTypeName || item.roomTypeName || 'Room'} · up to {item.capacity || 2} guests</option>)}</select></label>
          <label><span className={label}>Guests *</span><input required type="number" min="1" max={room?.capacity || 10} className={field} value={partySize} onChange={(e)=>setPartySize(e.target.value)}/></label>
          <label><span className={label}>Check-in date</span><input type="date" className={field} value={arrival} min={today} max={today} onChange={(e)=>setArrival(e.target.value)}/></label>
          <label><span className={label}>Check-out date *</span><input required type="date" className={field} value={departure} min={nextDay(arrival || today)} onChange={(e)=>setDeparture(e.target.value)}/></label>
          <label><span className={label}>Nightly room rate (KES) *</span><input required type="number" min="0" step="0.01" className={field} value={rate} onChange={(e)=>setRate(e.target.value)}/></label>
          <div className="rounded-lg bg-[var(--sidebar)] p-3"><div className={label}>Stay summary</div><div className="text-sm font-semibold text-[var(--text)]">{nights} night{nights===1?'':'s'} · {room ? `Room ${room.number}` : 'No room selected'}</div><div className="mt-1 text-xs text-[var(--text-muted)]">The room charge is posted to the guest folio. Record payments separately in Guest Folio.</div></div>
        </div>
        {!availableRooms.length && <p className="mt-3 text-sm text-[var(--warning-text)]">No rooms are currently marked available. Refresh after housekeeping updates the room status.</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="submit" disabled={busy || !availableRooms.length} className={button+' bg-[var(--brand-primary)] text-[var(--white)]'}><DoorOpen size={16}/>{busy?'Checking in…':'Complete walk-in check-in'}</button></div>
      </form>
    </div>
  </div>;
}
