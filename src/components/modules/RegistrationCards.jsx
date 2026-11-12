import React, { useEffect, useMemo, useState } from 'react';
import { PageDataSkeleton } from '@/components/ui/AppLoadingSkeleton';
import { ArrowLeft, Search, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { usePms } from '@/data/PmsStore';
import DocumentExportMenu from '@/components/shared/DocumentExportMenu';
import { createReportDefinition } from '@/services/reportDefinitions';

const valueOrDash = (value) => value === null || value === undefined || String(value).trim() === '' ? '—' : String(value);
const input = 'min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]';
const card = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4';

export default function RegistrationCards() {
  const { user } = useAuth();
  const { reservations = [], guests = [], rooms = [], loading } = usePms();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');

  const candidates = useMemo(() => reservations
    .filter((row) => !['cancelled', 'checked_out', 'checked-out'].includes(String(row.status || '').toLowerCase()))
    .filter((row) => !query.trim() || [row.guestName, row.phone, row.roomNumber, row.id].some((value) => String(value || '').toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => String(a.checkIn || '').localeCompare(String(b.checkIn || ''))), [reservations, query]);

  useEffect(() => {
    if (!candidates.some((row) => row.id === selectedId)) setSelectedId(candidates[0]?.id || '');
  }, [candidates, selectedId]);

  const reservation = candidates.find((row) => row.id === selectedId) || null;
  const guest = reservation ? guests.find((row) => row.id === reservation.guestId) : null;
  const details = guest?.guest_details || {};
  const booking = reservation?.bookingDetails || {};
  const room = reservation ? rooms.find((row) => row.id === reservation.roomId) : null;
  const propertyName = user?.property?.name || user?.property?.business_name || 'OliTechs Property';
  const generatedBy = user?.name || user?.email || 'Front Office';

  const fields = useMemo(() => reservation ? [
    ['Guest full name', guest?.name || reservation.guestName],
    ['Primary phone', guest?.phone || reservation.phone],
    ['Alternative phone', guest?.alternative_phone || details.alternativePhone],
    ['Email', guest?.email || details.email],
    ['Nationality', guest?.nationality || details.nationality],
    ['Country of residence', guest?.residence_country || details.residenceCountry],
    ['Address', guest?.address || details.address],
    ['Identification type', guest?.id_type || details.idType],
    ['Identification / passport number', guest?.id_number || details.idNumber],
    ['Room', room?.number || reservation.roomNumber],
    ['Arrival date', reservation.checkIn],
    ['Departure date', reservation.checkOut],
    ['Arrival time', booking.arrivalTime],
    ['Departure time', booking.departureTime],
    ['Adults', reservation.adults],
    ['Children', reservation.kidsCount],
    ['Children ages', (reservation.kidsAges || []).join(', ')],
    ['Meal plan', String(reservation.mealPlan || '').replaceAll('_', ' ')],
    ['Booking source', reservation.channel],
    ['Special requests', booking.specialRequests || reservation.notes],
    ['Guest profile notes', guest?.notes || details.notes],
  ] : [], [reservation, guest, details, room, booking]);

  const definition = useMemo(() => reservation ? createReportDefinition({
    key: 'guest-registration-card',
    title: 'Guest Registration Card',
    subtitle: 'Guest and stay details recorded in the property PMS',
    propertyName,
    period: { from: reservation.checkIn, to: reservation.checkOut },
    filters: { reservation: reservation.id, room: room?.number || reservation.roomNumber || 'Unassigned' },
    generatedBy,
    sections: [{
      name: 'registration-details',
      title: 'Registration Details',
      columns: [{ key: 'field', label: 'Field', type: 'text', width: 34 }, { key: 'value', label: 'Guest / Stay Information', type: 'text', width: 54 }],
      rows: fields.map(([field, value]) => ({ field, value: valueOrDash(value) })),
    }],
    notes: ['Guest signature: __________________________________________', 'Date: ____________________   Reception staff: ____________________'],
  }) : null, [reservation, propertyName, generatedBy, fields, room]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[var(--canvas)] p-3 sm:p-5">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><Link to="/frontoffice/check-in/arrivals" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--primary)]"><ArrowLeft size={14}/> Back to Check-in</Link><h1 className="text-xl font-bold text-[var(--text)]">Guest Registration Cards</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Review the saved guest and stay details, then generate a PDF registration card.</p></div>
          <DocumentExportMenu definition={definition} label="Registration card PDF" formats={['pdf', 'print']} disabled={!definition}/>
        </div>
        <div className={card}>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Find reservation</label>
          <div className="relative"><Search size={15} className="absolute left-3 top-3.5 text-[var(--text-muted)]"/><input className={input + ' pl-9'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search guest, room, phone or reservation reference"/></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {candidates.map((row) => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} aria-pressed={selectedId === row.id} className={`rounded-lg border p-3 text-left ${selectedId === row.id ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--sidebar)]'}`}>
              <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-[var(--text)]">{row.guestName}</span><span className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">{row.status}</span></div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">Room {row.roomNumber || 'Unassigned'} · {row.checkIn} → {row.checkOut}</div>
            </button>)}
          </div>
          {!loading && !candidates.length && <p className="py-6 text-center text-sm text-[var(--text-muted)]">No active reservations match this search.</p>}
        </div>

        {reservation ? <div className={card}>
          <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]"><UserRound size={19}/></div><div><div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{propertyName}</div><h2 className="text-lg font-bold text-[var(--text)]">Guest Registration</h2><p className="text-xs text-[var(--text-muted)]">Reservation {reservation.id}</p></div></div><span className="rounded-full bg-[var(--success-soft)] px-2 py-1 text-[10px] font-bold uppercase text-[var(--success-text)]">{reservation.status}</span></div>
          <div className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([name, value]) => <div key={name} className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{name}</div><div className="mt-1 break-words text-sm font-medium text-[var(--text)]">{valueOrDash(value)}</div></div>)}</div>
          <div className="mt-2 grid gap-8 border-t border-[var(--border)] pt-6 sm:grid-cols-2"><div className="border-b border-dashed border-[var(--text-muted)] pb-2 text-xs text-[var(--text-muted)]">Guest signature</div><div className="border-b border-dashed border-[var(--text-muted)] pb-2 text-xs text-[var(--text-muted)]">Reception staff signature</div></div>
          <p className="mt-3 text-[10px] text-[var(--text-muted)]">Only details already saved in the guest profile and reservation are included. Missing information is shown as — and should be completed through the authorized guest-record workflow.</p>
        </div> : <div className={card + ' py-12 text-center text-sm text-[var(--text-muted)]'}>{loading ? <PageDataSkeleton variant="list" rows={5}/> : 'Select an active reservation to preview its registration card.'}</div>}
      </div>
    </div>
  );
}
