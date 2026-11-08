import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  CalendarDays, CheckCircle2, ChevronRight, DoorOpen, LogOut, MoveRight,
  Plus, RefreshCw, Search, Trash2, X
} from 'lucide-react';
import { usePms } from '@/data/PmsStore';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';
import { getPmsDateKey } from '@/lib/pmsDateUtils';

const STATUS = {
  booked: 'Booked',
  'checked-in': 'In House',
  cancelled: 'Cancelled',
  checked_out: 'Checked Out',
  'checked-out': 'Checked Out',
};

function money(value) {
  return `KES ${Number(value || 0).toLocaleString('en-KE')}`;
}

function todayIso() {
  return getPmsDateKey();
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-[var(--border)] bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--focus)]";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export default function Reservations() {
  const pms = usePms();
  const location = useLocation();
  const path = location.pathname;
  const view = path.endsWith('/check-in/arrivals') ? 'arrivals' : path.endsWith('/check-in/in-house') ? 'in-house' : path.endsWith('/check-in/departures') ? 'departures' : 'all';
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(view === 'arrivals' ? 'booked' : view === 'in-house' || view === 'departures' ? 'checked-in' : 'all');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setFilter(view === 'arrivals' ? 'booked' : view === 'in-house' || view === 'departures' ? 'checked-in' : 'all'); }, [view]);

  const reservations = pms.reservations || [];
  const rooms = pms.rooms || [];

  const occupiedRoomIds = useMemo(() => {
    const ids = new Set();
    reservations.forEach((r) => {
      if (r.status === 'cancelled' || r.status === 'checked_out') return;
      if (r.checkIn && r.checkOut && r.checkIn <= selectedDate && selectedDate < r.checkOut) {
        ids.add(r.roomId);
      }
    });
    return ids;
  }, [reservations, selectedDate]);

  const availableRooms = rooms.filter((room) => room.active !== false && !['maintenance', 'out_of_service', 'blocked'].includes(room.status) && !occupiedRoomIds.has(room.id));

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reservations
      .filter((r) => filter === 'all' || r.status === filter || (filter === 'checked_out' && r.status === 'checked-out'))
      .filter((r) => view === 'arrivals' ? r.checkIn === selectedDate && r.status === 'booked' : view === 'in-house' ? r.status === 'checked-in' : view === 'departures' ? r.checkOut === selectedDate && r.status === 'checked-in' : true)
      .filter((r) => !term || [r.guestName, r.phone, r.roomNumber, r.channel, r.id].some((v) => String(v || '').toLowerCase().includes(term)))
      .sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || '')));
  }, [reservations, search, filter, view, selectedDate]);

  const arrivals = reservations.filter((r) => r.checkIn === selectedDate && r.status === 'booked');
  const departures = reservations.filter((r) => r.checkOut === selectedDate && r.status === 'checked-in');
  const inHouse = reservations.filter((r) => r.status === 'checked-in');

  const refresh = async () => {
    setError('');
    await pms.reload();
  };

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setSelected(null);
    } catch (e) {
      setError(e.message || 'Operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const createReservation = async (data) => {
    const { keepOpen, ...reservation } = data;
    setBusy(true);
    setError('');
    try {
      await pms.addReservation(reservation);
      if (!keepOpen) setShowNew(false);
    } catch (e) {
      setError(e.message || 'Could not create reservation.');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-canvas p-4 lg:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">{view === 'arrivals' ? 'Arrivals' : view === 'in-house' ? 'In-House Guests' : view === 'departures' ? 'Departures' : 'Reservations'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{view === 'arrivals' ? 'Review scheduled arrivals and complete check-in.' : view === 'in-house' ? 'Review current guests and room assignments.' : view === 'departures' ? 'Review guests due to depart and complete checkout.' : 'Manage bookings, room assignments, guest details and reservation status.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass + " border border-[var(--border)] bg-surface text-[var(--text)]"} onClick={refresh} disabled={busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            <Link className={buttonClass + " border border-[var(--border)] bg-surface text-[var(--text)]"} to="/frontoffice/check-in/registration-cards">Registration cards</Link>
            <button className={buttonClass + " bg-primary text-primary-foreground"} onClick={() => setShowNew(true)}>
              <Plus size={15} /> New reservation
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center justify-between rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-text)]">
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Arrivals', arrivals.length, 'booked'],
            ['Departures', departures.length, 'checked-in'],
            ['In house', inHouse.length, 'checked-in'],
            ['Available today', availableRooms.length, 'available'],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-border bg-surface p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
              <div className="mt-2 h-1 rounded-full bg-secondary">
                <div className="h-1 rounded-full bg-primary" style={{ width: `${Math.min(100, value * 12 + 8)}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-surface">
          <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <div className="relative max-w-md flex-1">
                <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
                <input className={inputClass + " pl-9"} placeholder="Search guest, phone, room or channel" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className={inputClass + " sm:w-44"} value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All reservations</option>
                <option value="booked">Booked</option>
                <option value="checked-in">In house</option>
                <option value="checked_out">Checked out</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <div className="relative sm:w-44">
                <CalendarDays size={15} className="absolute left-3 top-3 text-muted-foreground" />
                <input type="date" className={inputClass + " pl-9"} value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  {['Guest', 'Room', 'Stay', 'Guests', 'Channel', 'Payment', 'Status', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border hover:bg-secondary/70">
                    <td className="px-4 py-3">
                      <button className="text-left font-semibold text-foreground hover:underline" onClick={() => setSelected(r)}>{r.guestName}</button>
                      <div className="text-xs text-muted-foreground">{r.phone || 'No phone'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-foreground">{r.roomNumber || 'Unassigned'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.checkIn} → {r.checkOut}</td>
                    <td className="px-4 py-3">{r.partySize}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{r.channel}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground">{r.paymentStatus?.replace('_', ' ')}</span>
                      <div className="mt-1 text-xs text-muted-foreground">{money(r.amountPaid)} / {money(r.totalAmount)}</div>
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground">{STATUS[r.status] || r.status}</span></td>
                    <td className="px-4 py-3 text-right"><button className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(r)}><ChevronRight size={17} /></button></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">{view === 'arrivals' ? 'No arrivals are scheduled for this date.' : view === 'in-house' ? 'There are no guests currently in house.' : view === 'departures' ? 'No departures are scheduled for this date.' : 'No reservations match the current filters.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {view === 'all' && <div className="grid gap-4 lg:grid-cols-2">
          <QueueCard title={`Arrivals · ${selectedDate}`} items={arrivals} actionLabel="Check in" onAction={(r) => run(() => pms.checkInReservation(r.id))} />
          <QueueCard title={`Departures · ${selectedDate}`} items={departures} actionLabel="Check out" onAction={(r) => run(() => pms.checkOutRoom(r.roomId))} />
        </div>}
        {view !== 'all' && <div className="flex flex-wrap gap-2 text-xs"><Link className="rounded-lg border border-[var(--border)] bg-surface px-3 py-2" to="/frontoffice/check-in/arrivals">Arrivals</Link><Link className="rounded-lg border border-[var(--border)] bg-surface px-3 py-2" to="/frontoffice/check-in/in-house">In-House</Link><Link className="rounded-lg border border-[var(--border)] bg-surface px-3 py-2" to="/frontoffice/check-in/departures">Departures</Link></div>}
      </div>

      {showNew && <NewReservationModal rooms={rooms} reservations={reservations} ratePlans={pms.ratePlans || []} onClose={() => setShowNew(false)} onCreate={createReservation} busy={busy} />}
      {selected && <ReservationDrawer reservation={selected} rooms={rooms} pms={pms} propertyId={propertyId} busy={busy} onClose={() => setSelected(null)} onRun={run} />}
    </div>
  );
}

function QueueCard({ title, items, actionLabel, onAction }) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3 text-sm font-bold text-foreground">{title}</div>
      <div className="divide-y divide-border">
        {items.slice(0, 6).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div><div className="font-semibold text-foreground">{r.guestName}</div><div className="text-xs text-muted-foreground">Room {r.roomNumber} · {r.partySize} guests</div></div>
            <button disabled={r.plannerStatus === 'optioned'} title={r.plannerStatus === 'optioned' ? 'Confirm the 24-hour option in the Room Planner before check-in.' : undefined} className={buttonClass + " border border-[var(--border)] bg-surface text-[var(--text)]"} onClick={() => onAction(r)}><CheckCircle2 size={14} /> {r.plannerStatus === 'optioned' ? 'Optioned' : actionLabel}</button>
          </div>
        ))}
        {!items.length && <div className="px-4 py-6 text-sm text-muted-foreground">Nothing queued for this date.</div>}
      </div>
    </div>
  );
}

function dateNights(arrival, departure) {
  if (!arrival || !departure) return 0;
  const start = new Date(`${arrival}T00:00:00Z`);
  const end = new Date(`${departure}T00:00:00Z`);
  return Math.max(0, Math.round((end - start) / 86400000));
}

function NewReservationModal({ rooms, reservations, ratePlans, onClose, onCreate, busy }) {
  const [data, setData] = useState({
    firstName: '', lastName: '', email: '', phone: '', alternativePhone: '', nationality: '', residenceCountry: '',
    address: '', idType: 'passport', idNumber: '', guestNotes: '',
    roomIds: [], arrival: todayIso(), arrivalTime: '14:00', departure: '', departureTime: '10:00', adults: '1', kidsCount: '0', kidsAges: [],
    rate: '', ratePlanId: '', mealPlan: 'bed_only', channel: 'direct', company: '', agent: '', externalReference: '', groupReference: '',
    bookingNotes: '', specialRequests: '', services: '0', discount: '0', tax: '0', depositRequired: '0', deposit: '0', depositMethod: 'cash',
  });
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState('guest');
  const [submitting, setSubmitting] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const nights = dateNights(data.arrival, data.departure);
  const selectedRooms = rooms.filter((room) => data.roomIds.includes(room.id));
  const selectableRooms = rooms.filter((room) => room.active !== false && !['maintenance', 'out_of_service', 'blocked'].includes(room.status) && !reservations.some((reservation) => reservation.roomId === room.id && !['cancelled', 'checked-out', 'checked_out'].includes(reservation.status) && reservation.checkIn < data.departure && data.arrival < reservation.checkOut));
  const conflictingSelectedRooms = selectedRooms.filter((room) => !selectableRooms.some((candidate) => candidate.id === room.id));
  const nightlyRate = Math.max(0, Number(data.rate) || 0);
  const accommodation = nightlyRate * nights * Math.max(1, selectedRooms.length);
  const services = Math.max(0, Number(data.services) || 0);
  const discount = Math.max(0, Number(data.discount) || 0);
  const tax = Math.max(0, Number(data.tax) || 0);
  const total = Math.max(0, accommodation + services + tax - discount);
  const depositRequired = Math.max(0, Number(data.depositRequired) || 0);
  const deposit = Math.max(0, Number(data.deposit) || 0);
  const balance = Math.max(0, total - deposit);
  const guestCount = (Number(data.adults) || 0) + (Number(data.kidsCount) || 0);
  const capacity = selectedRooms.reduce((sum, room) => sum + Number(room.capacity || 2), 0);
  const set = (key, value) => setData((current) => ({ ...current, [key]: value }));
  const toggleRoom = (id) => set('roomIds', data.roomIds.includes(id) ? data.roomIds.filter((item) => item !== id) : [...data.roomIds, id]);
  const sections = [
    ['guest', 'Guest details'], ['stay', 'Stay & rooms'], ['booking', 'Booking details'], ['rates', 'Rates & deposit'], ['requests', 'Requests'],
  ];

  const submit = async (e, createAnother = false) => {
    e?.preventDefault();
    if (busy || submitting) return;
    setError('');
    const guest = `${data.firstName.trim()} ${data.lastName.trim()}`.trim();
    if (!data.firstName.trim() || !data.lastName.trim() || !data.phone.trim()) return setError('First name, last name and primary phone are required.');
    if (!data.roomIds.length) return setError('Select at least one room.');
    if (conflictingSelectedRooms.length) return setError(`These selected rooms are not available for the full stay: ${conflictingSelectedRooms.map((room) => room.number).join(', ')}.`);
    if (!data.arrival || !data.departure || data.arrival >= data.departure) return setError('Departure must be after arrival.');
    if (Number(data.adults) < 1 || Number(data.adults) > 10 || Number(data.kidsCount) < 0 || Number(data.kidsCount) > 6) return setError('Enter 1–10 adults and 0–6 children.');
    if (data.kidsAges.length !== Number(data.kidsCount) || data.kidsAges.some((age) => age === '' || Number(age) < 0 || Number(age) > 17)) return setError('Enter a valid age for every child.');
    if (guestCount > capacity) return setError(`Selected rooms accommodate ${capacity} guests, but ${guestCount} guests are entered. Add rooms or reduce occupancy.`);
    if (nightlyRate <= 0) return setError('Enter a nightly room rate greater than zero.');
    if (discount > accommodation + services + tax) return setError('Discount cannot exceed the booking subtotal.');
    if (depositRequired > total) return setError('Required deposit cannot exceed the reservation total.');
    if (deposit > total) return setError('Deposit received cannot exceed the reservation total.');
    if (deposit > 0 && deposit < total * 0.5) return setError('The current reservation workflow requires a deposit of at least 50% for partially-paid bookings. Use the cashier workflow for a smaller advance payment.');
    const paymentStatus = deposit >= total && total > 0 ? 'fully_paid' : deposit > 0 ? 'partially_paid' : 'not_paid';
    const rpcChannel = ['direct', 'booking_com'].includes(data.channel) ? data.channel : 'unknown';
    setSubmitting(true);
    try {
      await onCreate({
        guest, phone: data.phone.trim(), roomIds: data.roomIds, arrival: data.arrival, departure: data.departure,
        adults: Number(data.adults), kidsCount: Number(data.kidsCount), kidsAges: data.kidsAges.map(Number),
        rate: nightlyRate, totalAmount: total, amountPaid: deposit, paymentStatus, channel: rpcChannel, mealPlan: data.mealPlan,
        notes: data.bookingNotes, keepOpen: createAnother, details: {
          guest: { firstName: data.firstName.trim(), lastName: data.lastName.trim(), email: data.email.trim(), alternativePhone: data.alternativePhone.trim(), nationality: data.nationality.trim(), residenceCountry: data.residenceCountry.trim(), address: data.address.trim(), idType: data.idType, idNumber: data.idNumber.trim(), notes: data.guestNotes.trim() },
          booking: { submissionId, ratePlanId: data.ratePlanId || null, source: data.channel, company: data.company.trim(), agent: data.agent.trim(), externalReference: data.externalReference.trim(), groupReference: data.groupReference.trim(), accommodationSubtotal: accommodation, services, discount, tax, depositRequired, depositMethod: data.depositMethod, specialRequests: data.specialRequests.trim(), arrivalTime: data.arrivalTime, departureTime: data.departureTime, roomCount: data.roomIds.length },
        },
      });
      if (createAnother) {
        setData((current) => ({ ...current, firstName: '', lastName: '', email: '', phone: '', alternativePhone: '', address: '', idNumber: '', guestNotes: '', roomIds: [], depositRequired: '0', deposit: '0', externalReference: '', groupReference: '', bookingNotes: '', specialRequests: '' }));
        setActiveSection('guest');
        setSubmissionId(crypto.randomUUID());
      } else onClose();
    } catch (err) { setError(err.message || 'Could not create reservation.'); }
    finally { setSubmitting(false); }
  };

  const sectionContent = () => {
    if (activeSection === 'guest') return <div className="grid gap-3 sm:grid-cols-2">
      <Field label="First name *"><input required className={inputClass} value={data.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
      <Field label="Last name *"><input required className={inputClass} value={data.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
      <Field label="Primary phone *"><input required type="tel" className={inputClass} value={data.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Alternative phone"><input type="tel" className={inputClass} value={data.alternativePhone} onChange={(e) => set('alternativePhone', e.target.value)} /></Field>
      <Field label="Email"><input type="email" className={inputClass} value={data.email} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label="Nationality"><input className={inputClass} value={data.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
      <Field label="Country of residence"><input className={inputClass} value={data.residenceCountry} onChange={(e) => set('residenceCountry', e.target.value)} /></Field>
      <Field label="ID / passport type"><select className={inputClass} value={data.idType} onChange={(e) => set('idType', e.target.value)}><option value="passport">Passport</option><option value="national_id">National ID</option><option value="other">Other</option></select></Field>
      <Field label="ID / passport number"><input className={inputClass} value={data.idNumber} onChange={(e) => set('idNumber', e.target.value)} /></Field>
      <Field label="Address"><input className={inputClass} value={data.address} onChange={(e) => set('address', e.target.value)} /></Field>
      <div className="sm:col-span-2"><Field label="Guest profile notes"><textarea rows={2} className={inputClass} value={data.guestNotes} onChange={(e) => set('guestNotes', e.target.value)} /></Field></div>
    </div>;
    if (activeSection === 'stay') return <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Arrival date *"><input type="date" required className={inputClass} value={data.arrival} onChange={(e) => set('arrival', e.target.value)} /></Field><Field label="Arrival time"><input type="time" className={inputClass} value={data.arrivalTime} onChange={(e) => set('arrivalTime', e.target.value)} /></Field><Field label="Departure date *"><input type="date" required min={data.arrival || undefined} className={inputClass} value={data.departure} onChange={(e) => set('departure', e.target.value)} /></Field><Field label="Departure time"><input type="time" className={inputClass} value={data.departureTime} onChange={(e) => set('departureTime', e.target.value)} /></Field><Field label="Adults *"><input type="number" min="1" max="10" className={inputClass} value={data.adults} onChange={(e) => set('adults', e.target.value)} /></Field><Field label="Children"><input type="number" min="0" max="6" className={inputClass} value={data.kidsCount} onChange={(e) => { const count = Math.max(0, Math.min(6, Number(e.target.value) || 0)); setData((current) => ({ ...current, kidsCount: String(count), kidsAges: Array.from({ length: count }, (_, i) => current.kidsAges[i] ?? '') })); }} /></Field></div>
      {Number(data.kidsCount) > 0 && <div className="grid grid-cols-2 gap-3">{data.kidsAges.map((age, index) => <Field key={index} label={`Child ${index + 1} age`}><input type="number" min="0" max="17" className={inputClass} value={age} onChange={(e) => setData((current) => ({ ...current, kidsAges: current.kidsAges.map((item, i) => i === index ? e.target.value : item) }))} /></Field>)}</div>}
      <div><div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Select rooms · {selectedRooms.length} selected</div><div className="grid gap-2 sm:grid-cols-2">{selectableRooms.map((room) => <label key={room.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${data.roomIds.includes(room.id) ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-border bg-surface'}`}><input type="checkbox" checked={data.roomIds.includes(room.id)} onChange={() => toggleRoom(room.id)} /><span className="min-w-0"><span className="block text-sm font-semibold text-foreground">Room {room.number}</span><span className="block text-xs text-muted-foreground">{room.roomTypeName || room.roomType || 'Room'} · Capacity {room.capacity || 2}</span></span></label>)}</div>{conflictingSelectedRooms.length > 0 && <p className="mt-2 text-xs text-[var(--danger-text)]">One or more selected rooms conflict with these dates. Change the dates or room selection.</p>}</div>
      <div className="rounded-lg bg-secondary px-3 py-2 text-sm text-foreground">{nights} night(s) · {guestCount} guest(s) · room capacity {capacity}</div>
    </div>;
    if (activeSection === 'booking') return <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Booking source"><select className={inputClass} value={data.channel} onChange={(e) => set('channel', e.target.value)}><option value="direct">Direct</option><option value="website">Website</option><option value="booking_com">Booking.com</option><option value="expedia">Expedia</option><option value="travel_agent">Travel agent</option><option value="corporate">Corporate</option><option value="walk_in">Walk-in</option><option value="other">Other</option></select></Field>
      <Field label="Configured rate plan"><select className={inputClass} value={data.ratePlanId} onChange={(e) => { const plan = ratePlans.find((item) => item.id === e.target.value); const planMeal = plan?.meal_plan === 'room_only' ? 'bed_only' : ['bb', 'half_board', 'full_board'].includes(plan?.meal_plan) ? plan.meal_plan : data.mealPlan; setData((current) => ({ ...current, ratePlanId: e.target.value, rate: plan?.default_rate > 0 ? String(plan.default_rate) : current.rate, mealPlan: planMeal })); }}><option value="">Select configured rate plan (optional)</option>{ratePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.default_rate)} / night</option>)}</select></Field>
      <Field label="Meal plan"><select className={inputClass} value={data.mealPlan} onChange={(e) => set('mealPlan', e.target.value)}><option value="bed_only">Room only</option><option value="bb">Bed & breakfast</option><option value="half_board">Half board</option><option value="full_board">Full board</option></select></Field>
      <Field label="Company"><input className={inputClass} value={data.company} onChange={(e) => set('company', e.target.value)} /></Field>
      <Field label="Travel agent"><input className={inputClass} value={data.agent} onChange={(e) => set('agent', e.target.value)} /></Field>
      <Field label="External booking reference"><input className={inputClass} value={data.externalReference} onChange={(e) => set('externalReference', e.target.value)} /></Field>
      <Field label="Group reference"><input className={inputClass} value={data.groupReference} onChange={(e) => set('groupReference', e.target.value)} /></Field>
      <div className="sm:col-span-2"><Field label="Internal booking notes"><textarea rows={3} className={inputClass} value={data.bookingNotes} onChange={(e) => set('bookingNotes', e.target.value)} /></Field></div>
    </div>;
    if (activeSection === 'rates') return <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Nightly rate per room (KES) *"><input type="number" min="0" step="0.01" className={inputClass} value={data.rate} onChange={(e) => set('rate', e.target.value)} /></Field><Field label="Additional services (KES)"><input type="number" min="0" step="0.01" className={inputClass} value={data.services} onChange={(e) => set('services', e.target.value)} /></Field><Field label="Discount (KES)"><input type="number" min="0" step="0.01" className={inputClass} value={data.discount} onChange={(e) => set('discount', e.target.value)} /></Field><Field label="Taxes (KES)"><input type="number" min="0" step="0.01" className={inputClass} value={data.tax} onChange={(e) => set('tax', e.target.value)} /></Field><Field label="Deposit required (KES)"><input type="number" min="0" step="0.01" className={inputClass} value={data.depositRequired} onChange={(e) => set('depositRequired', e.target.value)} /></Field><Field label="Deposit received (KES)"><input type="number" min="0" step="0.01" className={inputClass} value={data.deposit} onChange={(e) => set('deposit', e.target.value)} /></Field><Field label="Deposit method"><select className={inputClass} value={data.depositMethod} onChange={(e) => set('depositMethod', e.target.value)}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></Field></div>
      <div className="rounded-xl border border-border bg-secondary/60 p-4"><div className="mb-3 text-sm font-bold text-foreground">Live booking summary</div><div className="space-y-2 text-sm"><SummaryLine label={`Accommodation · ${nights} nights × ${selectedRooms.length} room(s)`} value={money(accommodation)} /><SummaryLine label="Additional services" value={money(services)} /><SummaryLine label="Discount" value={`− ${money(discount)}`} /><SummaryLine label="Taxes" value={money(tax)} /><div className="border-t border-border pt-2"><SummaryLine label="Total" value={money(total)} strong /></div><SummaryLine label="Deposit required" value={money(depositRequired)} /><SummaryLine label="Deposit received" value={money(deposit)} /><SummaryLine label="Balance" value={money(balance)} strong /></div><p className="mt-3 text-xs text-muted-foreground">A received deposit is posted through the front-desk payment ledger using the selected method. The current initial-payment rule requires at least 50% of the booking total; smaller advances must be handled through the cashier workflow.</p></div>
    </div>;
    return <div className="space-y-3"><Field label="Special requests"><textarea rows={5} className={inputClass} placeholder="Airport transfer, dietary needs, arrival time, accessibility requests…" value={data.specialRequests} onChange={(e) => set('specialRequests', e.target.value)} /></Field><div className="rounded-lg bg-secondary p-3 text-sm text-muted-foreground">Requests are saved with the reservation for front-desk reference.</div></div>;
  };

  return <Modal title="Register reservation" onClose={onClose}>
    <form onSubmit={(e) => submit(e)} className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border pb-3">{sections.map(([id, label], index) => <button key={id} type="button" onClick={() => setActiveSection(id)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${activeSection === id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}><span className="mr-1 opacity-70">{index + 1}.</span>{label}</button>)}</div>
      {sectionContent()}
      {error && <div role="alert" className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-text)]">{error}</div>}
      <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4"><button type="button" className={buttonClass + ' border border-[var(--border)] bg-surface'} onClick={onClose}>Cancel</button><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || submitting} className={buttonClass + ' border border-[var(--border)] bg-surface text-foreground'} onClick={() => submit(null, true)}>Save & register another</button><button disabled={busy || submitting} className={buttonClass + ' bg-primary text-primary-foreground'} type="submit"><Plus size={15} /> {busy || submitting ? 'Saving…' : 'Save reservation'}</button></div></div>
    </form>
  </Modal>;
}

function SummaryLine({ label, value, strong = false }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? 'font-bold text-foreground' : 'text-muted-foreground'}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}

function ReservationDrawer({ reservation: r, rooms, pms, propertyId, busy, onClose, onRun }) {
  const [moveRoomId, setMoveRoomId] = useState(r.roomId || '');
  const [newDeparture, setNewDeparture] = useState(r.checkOut || '');
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const guest = (pms.guests || []).find((row) => row.id === r.guestId) || null;
  const [guestForm, setGuestForm] = useState({ name: '', phone: '', email: '', alternative_phone: '', nationality: '', residence_country: '', id_type: 'passport', id_number: '', address: '', notes: '' });
  useEffect(() => {
    if (!guest) return;
    setGuestForm({ name: guest.name || r.guestName || '', phone: guest.phone || r.phone || '', email: guest.email || '', alternative_phone: guest.alternative_phone || '', nationality: guest.nationality || '', residence_country: guest.residence_country || '', id_type: guest.id_type || 'passport', id_number: guest.id_number || '', address: guest.address || '', notes: guest.notes || '' });
  }, [guest, r.guestName, r.phone]);
  const [auditError, setAuditError] = useState('');

  useEffect(() => {
    let active = true;
    if (!propertyId || !r?.id) {
      setAuditEvents([]);
      setAuditLoading(false);
      return undefined;
    }
    setAuditLoading(true);
    setAuditError('');
    pmsService.listReservationAuditEvents({ propertyId, reservationId: r.id })
      .then((rows) => { if (active) setAuditEvents(rows); })
      .catch((error) => { if (active) { setAuditEvents([]); setAuditError(error.message || 'Audit history is unavailable.'); } })
      .finally(() => { if (active) setAuditLoading(false); });
    return () => { active = false; };
  }, [propertyId, r?.id]);

  const save = async (patch) => {
    await onRun(() => pms.updatePlannerReservation(r.id, {
      roomId: patch.roomId ?? r.roomId,
      checkIn: patch.checkIn ?? r.checkIn,
      checkOut: patch.checkOut ?? newDeparture,
      guestName: patch.guestName ?? r.guestName,
      paymentStatus: patch.paymentStatus ?? r.paymentStatus,
      channel: patch.channel ?? r.channel,
      mealPlan: patch.mealPlan ?? r.mealPlan,
      adults: patch.adults ?? r.adults,
      kidsCount: patch.kidsCount ?? r.kidsCount,
      kidsAges: patch.kidsAges ?? r.kidsAges,
      totalAmount: patch.totalAmount ?? r.totalAmount,
      amountPaid: patch.amountPaid ?? Number(r.amountPaid || 0),
      notes: patch.notes ?? r.notes,
    }));
  };

  const move = async () => {
    if (!moveRoomId || moveRoomId === r.roomId) return;
    await onRun(() => pms.movePlannerReservation({ reservationId: r.id, roomId: moveRoomId, checkIn: r.checkIn, checkOut: r.checkOut }));
  };

  const saveGuest = async () => {
    if (!guest?.id || !propertyId) return;
    await onRun(async () => {
      const patch = { ...guestForm, guest_details: { ...(guest.guest_details || {}), alternativePhone: guestForm.alternative_phone, residenceCountry: guestForm.residence_country, idType: guestForm.id_type, idNumber: guestForm.id_number } };
      await pmsService.updateGuestProfile({ propertyId, guestId: guest.id, patch });
      if (guestForm.name.trim() && guestForm.name.trim() !== r.guestName) {
        await pms.updatePlannerReservation(r.id, { guestName: guestForm.name.trim() });
      } else {
        await pms.reload();
      }
    });
  };

  const checkIn = () => onRun(() => pms.checkInReservation(r.id));
  const checkOut = () => onRun(() => pms.checkOutRoom(r.roomId));
  const cancel = () => onRun(() => pms.removeReservation(r.id));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--overlay-scrim)]" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-xl overflow-y-auto bg-surface shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-5 py-4">
          <div><div className="text-lg font-bold text-foreground">{r.guestName}</div><div className="text-xs text-muted-foreground">Reservation details</div></div>
          <button onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info label="Room" value={r.roomNumber || 'Unassigned'} />
            <Info label="Status" value={STATUS[r.status] || r.status} />
            <Info label="Arrival" value={r.checkIn} />
            <Info label="Departure" value={r.checkOut} />
          </div>

          <section className="rounded-xl border border-border p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-foreground">Guest profile</h3><span className="text-[10px] text-muted-foreground">Saved guest record</span></div>
            {guest ? <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Guest name"><input className={inputClass} value={guestForm.name} onChange={(e) => setGuestForm((v) => ({...v,name:e.target.value}))}/></Field>
              <Field label="Primary phone"><input className={inputClass} value={guestForm.phone} onChange={(e) => setGuestForm((v) => ({...v,phone:e.target.value}))}/></Field>
              <Field label="Email"><input type="email" className={inputClass} value={guestForm.email} onChange={(e) => setGuestForm((v) => ({...v,email:e.target.value}))}/></Field>
              <Field label="Alternative phone"><input className={inputClass} value={guestForm.alternative_phone} onChange={(e) => setGuestForm((v) => ({...v,alternative_phone:e.target.value}))}/></Field>
              <Field label="Nationality"><input className={inputClass} value={guestForm.nationality} onChange={(e) => setGuestForm((v) => ({...v,nationality:e.target.value}))}/></Field>
              <Field label="Country of residence"><input className={inputClass} value={guestForm.residence_country} onChange={(e) => setGuestForm((v) => ({...v,residence_country:e.target.value}))}/></Field>
              <Field label="ID type"><select className={inputClass} value={guestForm.id_type} onChange={(e) => setGuestForm((v) => ({...v,id_type:e.target.value}))}><option value="passport">Passport</option><option value="national_id">National ID</option><option value="other">Other</option></select></Field>
              <Field label="ID / passport number"><input className={inputClass} value={guestForm.id_number} onChange={(e) => setGuestForm((v) => ({...v,id_number:e.target.value}))}/></Field>
              <div className="sm:col-span-2"><Field label="Address"><input className={inputClass} value={guestForm.address} onChange={(e) => setGuestForm((v) => ({...v,address:e.target.value}))}/></Field></div>
              <div className="sm:col-span-2"><Field label="Guest notes"><textarea rows={2} className={inputClass} value={guestForm.notes} onChange={(e) => setGuestForm((v) => ({...v,notes:e.target.value}))}/></Field></div>
              <div className="sm:col-span-2"><button disabled={busy} className={buttonClass + " bg-primary text-primary-foreground"} onClick={saveGuest}>Save guest profile</button></div>
            </div> : <p className="text-xs text-muted-foreground">This reservation has no linked guest profile available to edit.</p>}
          </section>

          <section className="rounded-xl border border-border p-4">
            <h3 className="mb-3 text-sm font-bold text-foreground">Stay dates</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Departure"><input type="date" className={inputClass} value={newDeparture} onChange={(e) => setNewDeparture(e.target.value)} /></Field>
              <div className="flex items-end"><button disabled={busy || newDeparture <= r.checkIn} className={buttonClass + " w-full bg-primary text-primary-foreground"} onClick={() => save({ checkOut: newDeparture })}>Save extension</button></div>
            </div>
          </section>

          <section className="rounded-xl border border-border p-4">
            <h3 className="mb-3 text-sm font-bold text-foreground">Room assignment</h3>
            <div className="flex gap-2">
              <select className={inputClass} value={moveRoomId} onChange={(e) => setMoveRoomId(e.target.value)}>
                <option value="">Select room</option>
                {rooms.filter((room) => room.id === r.roomId || !['maintenance', 'out_of_service', 'blocked'].includes(room.status)).map((room) => <option key={room.id} value={room.id}>Room {room.number} · {room.roomTypeName || room.roomType || 'Room'}</option>)}
              </select>
              <button disabled={busy || moveRoomId === r.roomId} className={buttonClass + " bg-primary text-primary-foreground"} onClick={move}><MoveRight size={15} /> Move</button>
            </div>
          </section>

          <section className="rounded-xl border border-border p-4">
            <h3 className="mb-2 text-sm font-bold text-foreground">Booking payment metadata</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Booking total" value={money(r.totalAmount)} />
              <Info label="Booking payment status" value={(r.paymentStatus || 'not_paid').replace(/_/g, ' ')} />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Actual payments must be posted and reconciled in Guest Folio. This reservation screen does not create or edit payment transactions.</p>
          </section>

          <section className="rounded-xl border border-border p-4">
            <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-foreground">Reservation audit history</h3><span className="text-xs text-muted-foreground">{auditEvents.length} events</span></div>
            {auditLoading ? <p className="text-sm text-muted-foreground">Loading audit history…</p> :
              auditError ? <p className="text-xs leading-5 text-muted-foreground">{auditError} Audit visibility is restricted to property administrators.</p> :
              auditEvents.length ? <ol className="space-y-3">{auditEvents.map((event) => {
                const snapshot = event.new_value || event.old_value || {};
                const room = rooms.find((item) => item.id === snapshot.room_id);
                const details = [snapshot.guest_name || r.guestName, room ? `Room ${room.number}` : null, snapshot.arrival && snapshot.departure ? `${snapshot.arrival} → ${snapshot.departure}` : null, snapshot.status, snapshot.amount != null ? `KES ${Number(snapshot.amount).toLocaleString('en-KE')}` : null, snapshot.method, snapshot.source, snapshot.description].filter(Boolean).join(' · ');
                return <li key={event.id} className="border-l-2 border-border pl-3">
                  <div className="text-xs font-semibold capitalize text-foreground">{String(event.action || 'reservation event').replace(/^pms_/, '').replace(/_/g, ' ')}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{new Date(event.created_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} · {event.actor_id ? `Staff ${event.actor_id.slice(0, 8)}` : 'System / integration'}</div>
                  {details && <div className="mt-1 text-xs text-muted-foreground">{details}</div>}
                </li>;
              })}</ol> : <p className="text-sm text-muted-foreground">No recorded changes for this reservation.</p>}
          </section>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {r.status === 'booked' && r.plannerStatus !== 'optioned' && <button disabled={busy} className={buttonClass + " bg-primary text-primary-foreground"} onClick={checkIn}><DoorOpen size={15} /> Check in</button>}
            {r.status === 'booked' && r.plannerStatus === 'optioned' && <span className="rounded-lg border border-[var(--pay-opt-bd)] bg-[var(--pay-opt)] px-3 py-2 text-xs font-semibold text-[var(--pay-opt-fg)]">Confirm option before check-in</span>}
            {r.status === 'checked-in' && <button disabled={busy} className={buttonClass + " bg-primary text-primary-foreground"} onClick={checkOut}><LogOut size={15} /> Check out</button>}
            {r.status === 'booked' && <button disabled={busy} className={buttonClass + " border border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger-text)]"} onClick={cancel}><Trash2 size={15} /> Remove reservation</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold text-foreground">{value}</div></div>;
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="font-bold text-foreground">{title}</h2><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
