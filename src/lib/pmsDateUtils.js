export const PMS_TIME_ZONE = 'Africa/Nairobi';

export function getPmsDateKey(value = new Date(), timeZone = PMS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

/** Build a local-noon Date for a PMS civil date to avoid midnight DST/UTC shifts in calendar rendering. */
export function getPmsTodayDate(now = new Date(), timeZone = PMS_TIME_ZONE) {
  const key = getPmsDateKey(now, timeZone);
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Hotel stays use a half-open [check-in, check-out) date range. */
export function isValidStayRange(checkIn, checkOut) {
  return isValidIsoDate(checkIn) && isValidIsoDate(checkOut) && checkIn < checkOut;
}

export function overlapsStayRanges(startA, endA, startB, endB) {
  if (!isValidStayRange(startA, endA) || !isValidStayRange(startB, endB)) return false;
  return startA < endB && startB < endA;
}

const inactiveStatuses = new Set(['cancelled', 'checked_out', 'checked-out']);

export function findRoomReservationOverlap(reservations, roomId, checkIn, checkOut, excludeReservationId) {
  if (!roomId || !isValidStayRange(checkIn, checkOut)) return null;
  return (reservations || []).find((reservation) => {
    if (reservation.id === excludeReservationId) return false;
    const status = reservation.bookingStatus || reservation.status;
    if (inactiveStatuses.has(String(status || '').toLowerCase())) return false;
    const reservationRoomId = reservation.roomId || reservation.room_id;
    const reservationCheckIn = String(reservation.checkIn || reservation.arrival || reservation.check_in || '').slice(0, 10);
    const reservationCheckOut = String(reservation.checkOut || reservation.departure || reservation.check_out || '').slice(0, 10);
    return reservationRoomId === roomId && overlapsStayRanges(reservationCheckIn, reservationCheckOut, checkIn, checkOut);
  }) || null;
}
