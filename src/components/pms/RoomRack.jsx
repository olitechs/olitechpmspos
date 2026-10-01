import React, { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, RefreshCw, Search, UserRound } from 'lucide-react';
import { usePms } from '@/data/PmsStore';
import { useAuth } from '@/lib/AuthContext';
import { usePmsAvailableRoomsQuery } from '@/hooks/usePmsQuery';
import RoomPanel from '@/components/pms/RoomPanel';

const STATUS_META = {
  available: { label: 'Available', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  booked: { label: 'Booked', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  occupied: { label: 'Occupied', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  dirty: { label: 'Dirty', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  cleaning: { label: 'Cleaning', className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  maintenance: { label: 'Maintenance', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  out_of_service: { label: 'Out of service', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  blocked: { label: 'Blocked', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const isoToday = () => new Date().toISOString().slice(0, 10);
function nextDay(value) { const d = new Date(value + 'T00:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }

function activeReservation(reservations, roomId, date) {
  return reservations.find((r) => {
    const arrival = String(r.arrival || r.checkIn || '').slice(0, 10);
    const departure = String(r.departure || r.checkOut || '').slice(0, 10);
    return r.roomId === roomId && r.status !== 'cancelled' && r.status !== 'checked_out' && arrival <= date && date < departure;
  }) || null;
}

function reservationRoomShape(room, reservation) {
  if (!reservation) return room;
  return { ...room, reservationId: reservation.id, guestName: reservation.guestName || reservation.guest || reservation.guest_name, guest: reservation.guestName || reservation.guest || reservation.guest_name, phone: reservation.phone, reservationStatus: reservation.status, checkIn: reservation.checkIn || reservation.arrival, checkOut: reservation.checkOut || reservation.departure };
}

export default function RoomRack() {
  const pms = usePms();
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const [date, setDate] = useState(isoToday());
  const [roomTypeId, setRoomTypeId] = useState('');
  const [search, setSearch] = useState('');
  const [openRoom, setOpenRoom] = useState(null);
  const departure = nextDay(date);

  const availableQuery = usePmsAvailableRoomsQuery({ propertyId, arrival: date, departure, roomTypeId: roomTypeId || null });
  const availableIds = useMemo(() => new Set((availableQuery.data || []).map((room) => room.id)), [availableQuery.data]);
  const reservations = pms.reservations || [];
  const roomTypes = pms.roomTypes || [];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (pms.rooms || []).map((room) => {
      const reservation = activeReservation(reservations, room.id, date);
      const serverAvailable = availableIds.has(room.id);
      const status = reservation?.status === 'checked-in' ? 'occupied' : reservation?.status === 'booked' ? 'booked' : serverAvailable ? 'available' : room.status;
      return { room, reservation, status, roomType: roomTypes.find((type) => type.id === room.room_type_id)?.name || room.room_type || 'Unassigned' };
    }).filter(({ room, roomType }) => {
      if (roomTypeId && room.room_type_id !== roomTypeId) return false;
      if (!term) return true;
      return [room.number, room.name, roomType].some((value) => String(value || '').toLowerCase().includes(term));
    }).sort((a, b) => Number(a.room.number) - Number(b.room.number));
  }, [pms.rooms, reservations, roomTypes, date, roomTypeId, availableIds, search]);

  const counts = useMemo(() => rows.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {}), [rows]);
  const refresh = async () => { await pms.reload(); await availableQuery.refetch(); };

  return (
    <div className="h-full overflow-y-auto bg-[#F5F3EF] p-4 lg:p-5">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Front Desk</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">Room Rack</h2><p className="mt-1 text-sm text-slate-500">Live room status and date-based availability. Booking conflicts are enforced by the database.</p></div>
          <button onClick={refresh} disabled={availableQuery.isFetching} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"><RefreshCw size={15} className={availableQuery.isFetching ? 'animate-spin' : ''} /> Refresh</button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {[['Available',counts.available||0],['Booked',counts.booked||0],['Occupied',counts.occupied||0],['Dirty',counts.dirty||0],['Cleaning',counts.cleaning||0],['Maintenance',counts.maintenance||0],['OOS',counts.out_of_service||0],['Blocked',counts.blocked||0]].map(([label,value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-lg font-bold text-slate-950">{value}</div></div>)}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 md:flex-row md:items-center">
          <div className="relative md:w-56"><CalendarDays size={15} className="absolute left-3 top-3 text-slate-400" /><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none" /></div>
          <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none md:w-56"><option value="">All room types</option>{roomTypes.filter((type) => type.active !== false).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-3 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search room number, name or type" className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none" /></div>
          <div className="text-xs text-slate-500">Stay window: <span className="font-semibold text-slate-800">{date}</span> → <span className="font-semibold text-slate-800">{departure}</span></div>
        </div>

        {availableQuery.isError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Unable to load authoritative availability: {availableQuery.error.message}</div>}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">{['Room','Type','Operational status','Guest / reservation','Stay','Guests','Action'].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr></thead>
            <tbody>{rows.map(({room,reservation,status,roomType}) => {
              const meta = STATUS_META[status] || STATUS_META.available;
              const roomForPanel = reservationRoomShape(room,reservation);
              return <tr key={room.id} className="border-b border-slate-100 hover:bg-slate-50/70">
                <td className="px-4 py-3"><button onClick={() => setOpenRoom(roomForPanel)} className="font-mono font-bold text-slate-950 hover:underline">Room {room.number}</button>{room.name && <div className="text-xs text-slate-500">{room.name}</div>}</td>
                <td className="px-4 py-3 text-slate-600">{roomType}</td>
                <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.className}`}>{meta.label}</span></td>
                <td className="px-4 py-3">{reservation ? <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100"><UserRound size={15}/></span><div><div className="font-semibold text-slate-900">{reservation.guestName || reservation.guest || 'Guest'}</div><div className="text-xs text-slate-500">{reservation.phone || 'No phone'}</div></div></div> : <span className="text-slate-400">No active reservation</span>}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{reservation ? `${String(reservation.arrival || reservation.checkIn).slice(0,10)} → ${String(reservation.departure || reservation.checkOut).slice(0,10)}` : '—'}</td>
                <td className="px-4 py-3">{reservation?.partySize ?? reservation?.adults ?? '—'}</td>
                <td className="px-4 py-3"><div className="flex gap-2"><button onClick={() => setOpenRoom(roomForPanel)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800">Open</button>{reservation?.status === 'booked' && <button onClick={async () => { try { await pms.checkInReservation(reservation.id); await refresh(); } catch (error) { window.alert(error.message || 'Check-in failed.'); } }} className="inline-flex items-center gap-1 rounded-lg bg-[#FFD300] px-3 py-1.5 text-xs font-bold text-slate-950"><CheckCircle2 size={13}/> Check in</button>}</div></td>
              </tr>;
            })}{!rows.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">No rooms match the current filters.</td></tr>}</tbody>
          </table></div>
        </div>
      </div>
      {openRoom && <RoomPanel room={openRoom} onClose={() => setOpenRoom(null)} />}
    </div>
  );
}
