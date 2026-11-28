const OUT_OF_ORDER = new Set(['maintenance', 'out_of_service', 'blocked']);
const DIRTY = new Set(['dirty', 'cleaning']);

const dateOnly = (value) => String(value || '').slice(0, 10);
const statusOf = (reservation) => String(reservation?.status || '').toLowerCase();

export function getDashboardRoomStats(rooms = [], reservations = [], today) {
  const byRoom = new Map();
  reservations.forEach((reservation) => {
    const roomId = reservation.roomId || reservation.room_id;
    if (!roomId || statusOf(reservation) === 'cancelled') return;
    if (!byRoom.has(roomId)) byRoom.set(roomId, []);
    byRoom.get(roomId).push(reservation);
  });

  const counts = { occupied: 0, booked: 0, available: 0, dirty: 0, ooo: 0 };
  const inHouse = [];
  const arrivals = [];
  const departures = [];
  let dueInToday = 0;

  rooms.forEach((room) => {
    const roomReservations = byRoom.get(room.id) || [];
    const currentStay = roomReservations.find((reservation) => {
      const arrival = dateOnly(reservation.arrival || reservation.checkIn || reservation.check_in);
      const departure = dateOnly(reservation.departure || reservation.checkOut || reservation.check_out);
      return statusOf(reservation) === 'checked-in' && arrival && departure && arrival <= today && departure >= today;
    });
    const currentBooking = roomReservations.find((reservation) => {
      const departure = dateOnly(reservation.departure || reservation.checkOut || reservation.check_out);
      return statusOf(reservation) === 'booked' && departure && departure > today;
    });
    const roomStatus = String(room.status || '').toLowerCase();

    if (OUT_OF_ORDER.has(roomStatus) || room.active === false) {
      counts.ooo += 1;
    } else if (currentStay) {
      counts.occupied += 1;
      inHouse.push(currentStay);
      if (dateOnly(currentStay.departure || currentStay.checkOut || currentStay.check_out) === today) departures.push(currentStay);
    } else if (currentBooking) {
      counts.booked += 1;
      const arrival = dateOnly(currentBooking.arrival || currentBooking.checkIn || currentBooking.check_in);
      if (arrival && arrival <= today) dueInToday += 1;
      if (arrival === today) arrivals.push(currentBooking);
    } else if (roomStatus === 'available') {
      counts.available += 1;
    } else if (DIRTY.has(roomStatus) || roomStatus === 'occupied' || roomStatus === 'booked' || !roomStatus) {
      // A room without a current stay is not occupied. If its old state says
      // occupied/booked, keep it unavailable until housekeeping confirms clean.
      counts.dirty += 1;
    } else {
      counts.dirty += 1;
    }
  });

  const sellable = Math.max(0, rooms.length - counts.ooo);
  const soldToday = counts.occupied + dueInToday;
  const occupancy = sellable > 0 ? Math.round((soldToday / sellable) * 100) : 0;
  const inHouseGuests = inHouse.reduce((sum, reservation) => (
    sum + (Number(reservation.partySize ?? reservation.party_size) || 1)
  ), 0);

  return {
    counts,
    sellable,
    soldToday,
    occupancy,
    arrivals,
    departures,
    inHouse,
    inHouseGuests,
    total: rooms.length,
  };
}
