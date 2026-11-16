// Pure model helpers for the PMS room planner. No JSX, no React state — the
// planner component (../RoomPlanner.jsx) consumes these. Kept free of component
// concerns so they stay unit-testable and are not re-created per render.
import { format, addDays, subDays } from 'date-fns';
import { overlapsStayRanges, findRoomReservationOverlap } from '@/lib/pmsDateUtils';
import { getPastStayOpacity, getPaymentStatusFromAmounts } from '@/lib/roomPlannerGeometry';

export { getPaymentStatusFromAmounts };

export const getPaymentStyle = (status) => ({
  fully_paid: { background: 'var(--pay-paid)', color: 'var(--pay-paid-fg)', border: 'var(--pay-paid-bd)', label: 'Total Paid' },
  partially_paid: { background: 'var(--pay-part)', color: 'var(--pay-part-fg)', border: 'var(--pay-part-bd)', label: 'Partially Paid' },
  not_paid: { background: 'var(--pay-none)', color: 'var(--pay-none-fg)', border: 'var(--pay-none-bd)', label: 'No Amount Paid' },
}[status] || { background: 'var(--pay-none)', color: 'var(--pay-none-fg)', border: 'var(--pay-none-bd)', label: 'No Amount Paid' });

export function getBarOpacity(bookingStatus, checkOut, today) { return checkOut && today ? getPastStayOpacity(checkOut, today) : bookingStatus === 'checked_out' ? 0.55 : 1; }
export function isOverlapping(r1, r2) {
  return r1.roomId === r2.roomId && overlapsStayRanges(r1.checkIn, r1.checkOut, r2.checkIn, r2.checkOut);
}
export function checkOverlap(reservationList, newRoomId, newCheckIn, newCheckOut, excludeReservationId) {
  return findRoomReservationOverlap(reservationList, newRoomId, newCheckIn, newCheckOut, excludeReservationId);
}
export function calculateDailyStats(reservations, date) {
  const key = typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
  const active = reservations.filter((r) => r.status !== 'cancelled');
  return {
    arrivals: active.filter((r) => (r.checkIn || r.arrival)?.slice(0, 10) === key).length,
    inHouse: active.filter((r) => {
      const ci = (r.checkIn || r.arrival)?.slice(0, 10);
      const co = (r.checkOut || r.departure)?.slice(0, 10);
      return ci <= key && co > key && (r.bookingStatus || normalizeBookingStatus(r.status)) !== 'checked_out';
    }).length,
    checkOuts: active.filter((r) => (r.checkOut || r.departure)?.slice(0, 10) === key).length,
  };
}

// Room status keeps the same housekeeping semantics as the Dashboard: an
// available room is clean, and dirty/cleaning share the vacant-dirty colour.
// Do not map `available` to a neutral grey or `cleaning` to the clean colour.
export const ROOM_STATUS = {
  available: { fill: 'var(--room-clean)', label: 'Vacant clean' }, booked: { fill: 'var(--primary)', label: 'Booked' }, occupied: { fill: 'var(--room-occupied)', label: 'Occupied' },
  dirty: { fill: 'var(--room-dirty)', label: 'Vacant dirty' }, cleaning: { fill: 'var(--room-dirty)', label: 'Cleaning' }, maintenance: { fill: 'var(--room-out-of-order)', label: 'Out of order' },
  out_of_service: { fill: 'var(--room-out-of-order)', label: 'Out of service' }, blocked: { fill: 'var(--room-out-of-order)', label: 'Blocked' },
};
export const UNKNOWN_ROOM_STATUS = { fill: 'var(--text-muted)', label: 'Status not set' };
export const channelLabel = { direct: 'Direct', booking_com: 'Booking.com', unknown: 'Unknown' };
export const mealLabel = { bed_only: 'Bed Only', bb: 'BB', half_board: 'HB', full_board: 'FB' };
export const paymentLabel = { fully_paid: 'Fully Paid', partially_paid: 'Deposit / Partially Paid', not_paid: 'Not Paid' };

export const dateKey = (d) => format(d, 'yyyy-MM-dd');

// The rolling planner is a 15-day window: two days before today plus today and
// twelve following days, keeping today visible immediately beside the room column.
export const getRollingPlannerRange = (today) => ({
  from: dateKey(subDays(today, 2)),
  to: dateKey(addDays(today, 12)),
});
export const parseDate = (v) => { if (!v) return null; const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const normalizeBookingStatus = (status) => ({ 'checked-in': 'checked_in', 'checked-out': 'checked_out', booked: 'booked' }[status] || status || 'booked');
export const normalizeReservation = (r) => ({
  ...r,
  guestName: r.guestName || r.guest || r.guest_name || '',
  roomId: r.roomId || r.room_id,
  roomType: r.roomType || r.room_type || '',
  checkIn: (r.checkIn || r.arrival || r.check_in || '')?.slice(0, 10),
  checkOut: (r.checkOut || r.departure || r.check_out || '')?.slice(0, 10),
  bookingStatus: r.bookingStatus || normalizeBookingStatus(r.status),
  optionExpiresAt: r.optionExpiresAt || r.option_expires_at || null,
  plannerStatus: r.plannerStatus || ((r.optionExpiresAt || r.option_expires_at) && new Date(r.optionExpiresAt || r.option_expires_at).getTime() > Date.now() ? 'optioned' : undefined),
  paymentStatus: r.paymentStatus || 'not_paid',
  channel: r.channel || 'direct',
  mealPlan: r.mealPlan || 'bed_only',
  adults: Number(r.adults ?? r.partySize ?? 1),
  kidsCount: Number(r.kidsCount ?? 0),
  kidsAges: Array.isArray(r.kidsAges) ? r.kidsAges : [],
  totalAmount: Number(r.totalAmount ?? r.total ?? r.rate ?? 0),
  amountPaid: Number(r.amountPaid ?? 0),
});
export const formatGuests = (r) => `${r.adults || 1}A${r.kidsCount ? `,${r.kidsCount}K` : ''}`;
export const formatPlannerDate = (value) => {
  const date = parseDate(value);
  return date ? format(date, 'dd/MM/yyyy') : '—';
};
export const formatPlannerAmount = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const getPlannerReservationNumber = (rv) => rv.reservationNumber || rv.reservation_number || rv.bookingReference || rv.booking_reference || String(rv.id || '').slice(0, 6).toUpperCase() || '—';
export const getPlannerCurrency = (rv) => rv.currency || rv.bookingDetails?.currency || rv.booking_details?.currency || 'USD';
export const getPlannerMealDescription = (mealPlan) => ({
  bed_only: 'Room only',
  bb: 'Breakfast included',
  half_board: 'Breakfast and dinner included',
  full_board: 'Breakfast, lunch and dinner included',
}[mealPlan] || 'Meal plan not specified');
export const getPlannerPaymentDetails = (rv) => {
  const details = rv.bookingDetails || rv.booking_details || {};
  const method = rv.paymentMethod || rv.payment_method || details.paymentMethod || details.payment_method || '';
  const paidAt = rv.paidAt || rv.paid_at || rv.paymentDate || rv.payment_date || details.paidAt || details.paid_at || details.paymentDate || details.payment_date || '';
  return { method, paidAt };
};

export const emptyForm = (room, date) => ({
  guestName: '', firstName: '', lastName: '', phone: '', alternativePhone: '', email: '', nationality: '', residenceCountry: '', address: '', idType: 'passport', idNumber: '', guestNotes: '',
  checkIn: dateKey(date), checkOut: dateKey(addDays(date, 1)), arrivalTime: '14:00', departureTime: '10:00', paymentStatus: 'not_paid', bookingStatus: 'confirmed', channel: 'direct', mealPlan: 'bed_only',
  adults: 1, kidsCount: 0, kidsAges: [], totalAmount: Number(room?.base_rate || 0), amountPaid: 0, depositRequired: 0, depositMethod: 'cash', rate: Number(room?.base_rate || 0), ratePlanId: '', services: 0, discount: 0, tax: 0,
  company: '', agent: '', externalReference: '', groupReference: '', specialRequests: '', bookingNotes: '',
  roomTypeId: room?.room_type_id || '', roomId: room?.id || '', joint: false, selectedRoomIds: room?.id ? [room.id] : [], notes: '',
});
