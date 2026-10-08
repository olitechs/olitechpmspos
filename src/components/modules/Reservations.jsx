import React, { useMemo, useState } from 'react';
import {
  CalendarDays, CheckCircle2, ChevronRight, DoorOpen, LogOut, MoveRight,
  Plus, RefreshCw, Search, Trash2, X
} from 'lucide-react';
import { usePms } from '@/data/PmsStore';

const STATUS = {
  booked: 'Booked',
  'checked-in': 'In House',
  cancelled: 'Cancelled',
  checked_out: 'Checked Out',
};

function money(value) {
  return `KES ${Number(value || 0).toLocaleString('en-KE')}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export default function Reservations() {
  const pms = usePms();
  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  const availableRooms = rooms.filter((room) => room.status !== 'maintenance' && room.status !== 'out_of_service' && !occupiedRoomIds.has(room.id));

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return reservations
      .filter((r) => filter === 'all' || r.status === filter)
      .filter((r) => !term || [r.guestName, r.phone, r.roomNumber, r.channel].some((v) => String(v || '').toLowerCase().includes(term)))
      .sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || '')));
  }, [reservations, search, filter]);

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
    await run(async () => {
      await pms.addReservation(data);
      setShowNew(false);
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8f8f7] p-4 lg:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">Front Desk & Reservations</h1>
            <p className="mt-1 text-sm text-slate-500">Manage arrivals, departures, room assignments and reservation status from one workspace.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass + " border border-slate-200 bg-white text-slate-800"} onClick={refresh} disabled={busy}>
              <RefreshCw size={15} /> Refresh
            </button>
            <button className={buttonClass + " bg-[#FFD300] text-slate-950"} onClick={() => setShowNew(true)}>
              <Plus size={15} /> New reservation
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-1 text-2xl font-bold text-slate-950">{value}</div>
              <div className="mt-2 h-1 rounded-full bg-slate-100">
                <div className="h-1 rounded-full bg-slate-900" style={{ width: `${Math.min(100, value * 12 + 8)}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <div className="relative max-w-md flex-1">
                <Search size={15} className="absolute left-3 top-3 text-slate-400" />
                <input className={inputClass + " pl-9"} placeholder="Search guest, phone, room or channel" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className={inputClass + " sm:w-44"} value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All reservations</option>
                <option value="booked">Booked</option>
                <option value="checked-in">In house</option>
                <option value="checked-out">Checked out</option>
              </select>
              <div className="relative sm:w-44">
                <CalendarDays size={15} className="absolute left-3 top-3 text-slate-400" />
                <input type="date" className={inputClass + " pl-9"} value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  {['Guest', 'Room', 'Stay', 'Guests', 'Channel', 'Payment', 'Status', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <button className="text-left font-semibold text-slate-900 hover:underline" onClick={() => setSelected(r)}>{r.guestName}</button>
                      <div className="text-xs text-slate-500">{r.phone || 'No phone'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800">{r.roomNumber || 'Unassigned'}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{r.checkIn} → {r.checkOut}</td>
                    <td className="px-4 py-3">{r.partySize}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{r.channel}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">{r.paymentStatus?.replace('_', ' ')}</span>
                      <div className="mt-1 text-xs text-slate-500">{money(r.amountPaid)} / {money(r.totalAmount)}</div>
                    </td>
                    <td className="px-4 py-3"><span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">{STATUS[r.status] || r.status}</span></td>
                    <td className="px-4 py-3 text-right"><button className="text-slate-500 hover:text-slate-950" onClick={() => setSelected(r)}><ChevronRight size={17} /></button></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">No reservations match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <QueueCard title={`Arrivals · ${selectedDate}`} items={arrivals} actionLabel="Check in" onAction={(r) => run(() => pms.checkInReservation(r.id))} />
          <QueueCard title={`Departures · ${selectedDate}`} items={departures} actionLabel="Check out" onAction={(r) => run(() => pms.checkOutRoom(r.roomId))} />
        </div>
      </div>

      {showNew && <NewReservationModal rooms={availableRooms} onClose={() => setShowNew(false)} onCreate={createReservation} busy={busy} />}
      {selected && <ReservationDrawer reservation={selected} rooms={rooms} pms={pms} busy={busy} onClose={() => setSelected(null)} onRun={run} />}
    </div>
  );
}

function QueueCard({ title, items, actionLabel, onAction }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-bold text-slate-950">{title}</div>
      <div className="divide-y divide-slate-100">
        {items.slice(0, 6).map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div><div className="font-semibold text-slate-900">{r.guestName}</div><div className="text-xs text-slate-500">Room {r.roomNumber} · {r.partySize} guests</div></div>
            <button className={buttonClass + " border border-slate-200 bg-white text-slate-800"} onClick={() => onAction(r)}><CheckCircle2 size={14} /> {actionLabel}</button>
          </div>
        ))}
        {!items.length && <div className="px-4 py-6 text-sm text-slate-500">Nothing queued for this date.</div>}
      </div>
    </div>
  );
}

function NewReservationModal({ rooms, onClose, onCreate, busy }) {
  const [data, setData] = useState({ guest: '', phone: '', roomId: rooms[0]?.id || '', arrival: todayIso(), departure: todayIso(), partySize: 1, rate: '', channel: 'direct', mealPlan: 'bed_only' });
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!data.guest || !data.roomId || !data.arrival || !data.departure || data.arrival >= data.departure) {
      setError('Guest, room and a valid arrival/departure range are required.');
      return;
    }
    try {
      await onCreate({ ...data, rate: Number(data.rate) || 0, partySize: Number(data.partySize) || 1 });
    } catch (err) {
      setError(err.message || 'Could not create reservation.');
    }
  };

  return (
    <Modal title="New reservation" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Guest name"><input className={inputClass} value={data.guest} onChange={(e) => setData({ ...data, guest: e.target.value })} /></Field>
          <Field label="Phone"><input className={inputClass} value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} /></Field>
          <Field label="Room"><select className={inputClass} value={data.roomId} onChange={(e) => setData({ ...data, roomId: e.target.value })}><option value="">Select room</option>{rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number} · {r.roomTypeName || r.roomType || 'Room'}</option>)}</select></Field>
          <Field label="Rate / night"><input type="number" min="0" step="0.01" className={inputClass} value={data.rate} onChange={(e) => setData({ ...data, rate: e.target.value })} /><span className="mt-1 block text-[11px] text-slate-400">Total is calculated from the number of nights.</span></Field>
          <Field label="Arrival"><input type="date" className={inputClass} value={data.arrival} onChange={(e) => setData({ ...data, arrival: e.target.value })} /></Field>
          <Field label="Departure"><input type="date" className={inputClass} value={data.departure} onChange={(e) => setData({ ...data, departure: e.target.value })} /></Field>
          <Field label="Guests"><input type="number" min="1" className={inputClass} value={data.partySize} onChange={(e) => setData({ ...data, partySize: e.target.value })} /></Field>
          <Field label="Channel"><select className={inputClass} value={data.channel} onChange={(e) => setData({ ...data, channel: e.target.value })}><option value="direct">Direct</option><option value="booking_com">Booking.com</option><option value="unknown">Other / OTA</option></select></Field>
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" className={buttonClass + " border border-slate-200 bg-white"} onClick={onClose}>Cancel</button><button disabled={busy} className={buttonClass + " bg-[#FFD300] text-slate-950"} type="submit"><Plus size={15} /> Create reservation</button></div>
      </form>
    </Modal>
  );
}

function ReservationDrawer({ reservation: r, rooms, pms, busy, onClose, onRun }) {
  const [moveRoomId, setMoveRoomId] = useState(r.roomId || '');
  const [newDeparture, setNewDeparture] = useState(r.checkOut || '');
  const [amountPaid, setAmountPaid] = useState(String(r.amountPaid || 0));

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
      amountPaid: patch.amountPaid ?? Number(amountPaid || 0),
      notes: patch.notes ?? r.notes,
    }));
  };

  const move = async () => {
    if (!moveRoomId || moveRoomId === r.roomId) return;
    await onRun(() => pms.movePlannerReservation({ reservationId: r.id, roomId: moveRoomId, checkIn: r.checkIn, checkOut: r.checkOut }));
  };

  const checkIn = () => onRun(() => pms.checkInReservation(r.id));
  const checkOut = () => onRun(() => pms.checkOutRoom(r.roomId));
  const cancel = () => onRun(() => pms.removeReservation(r.id));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div><div className="text-lg font-bold text-slate-950">{r.guestName}</div><div className="text-xs text-slate-500">Reservation details</div></div>
          <button onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info label="Room" value={r.roomNumber || 'Unassigned'} />
            <Info label="Status" value={STATUS[r.status] || r.status} />
            <Info label="Arrival" value={r.checkIn} />
            <Info label="Departure" value={r.checkOut} />
          </div>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-950">Stay dates</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Departure"><input type="date" className={inputClass} value={newDeparture} onChange={(e) => setNewDeparture(e.target.value)} /></Field>
              <div className="flex items-end"><button disabled={busy || newDeparture <= r.checkIn} className={buttonClass + " w-full bg-slate-950 text-white"} onClick={() => save({ checkOut: newDeparture })}>Save extension</button></div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-950">Room assignment</h3>
            <div className="flex gap-2">
              <select className={inputClass} value={moveRoomId} onChange={(e) => setMoveRoomId(e.target.value)}>
                <option value="">Select room</option>
                {rooms.filter((room) => room.id === r.roomId || room.status !== 'maintenance' && room.status !== 'out_of_service').map((room) => <option key={room.id} value={room.id}>Room {room.number} · {room.roomTypeName || room.roomType || 'Room'}</option>)}
              </select>
              <button disabled={busy || moveRoomId === r.roomId} className={buttonClass + " bg-slate-950 text-white"} onClick={move}><MoveRight size={15} /> Move</button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-950">Payment status</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Info label="Total" value={money(r.totalAmount)} />
              <Field label="Amount paid"><input type="number" min="0" className={inputClass} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} /></Field>
            </div>
            <button disabled={busy} className={buttonClass + " mt-3 bg-slate-950 text-white"} onClick={() => save({ amountPaid: Number(amountPaid || 0), paymentStatus: Number(amountPaid || 0) >= Number(r.totalAmount || 0) && Number(r.totalAmount || 0) > 0 ? 'fully_paid' : Number(amountPaid || 0) > 0 ? 'partially_paid' : 'not_paid' })}>Update payment status</button>
          </section>

          <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
            {r.status === 'booked' && <button disabled={busy} className={buttonClass + " bg-[#FFD300] text-slate-950"} onClick={checkIn}><DoorOpen size={15} /> Check in</button>}
            {r.status === 'checked-in' && <button disabled={busy} className={buttonClass + " bg-slate-950 text-white"} onClick={checkOut}><LogOut size={15} /> Check out</button>}
            {r.status === 'booked' && <button disabled={busy} className={buttonClass + " border border-red-200 bg-red-50 text-red-700"} onClick={cancel}><Trash2 size={15} /> Remove reservation</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-sm font-semibold text-slate-900">{value}</div></div>;
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-950">{title}</h2><button onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
