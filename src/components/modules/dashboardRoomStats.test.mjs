import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardRoomStats } from './dashboardRoomStats.js';

const today = '2026-11-28';

test('a checked-out room is no longer occupied and remains vacant dirty until housekeeping clears it', () => {
  const rooms = [{ id: '1', status: 'dirty' }];
  const reservations = [{ id: 'r1', roomId: '1', status: 'checked-out', arrival: '2026-11-20', departure: today, partySize: 2 }];
  const result = getDashboardRoomStats(rooms, reservations, today);
  assert.equal(result.counts.occupied, 0);
  assert.equal(result.counts.dirty, 1);
  assert.equal(result.inHouseGuests, 0);
});

test('a stale occupied room without a current stay is not shown as occupied or clean', () => {
  const rooms = [{ id: '1', status: 'occupied' }];
  const reservations = [{ id: 'r1', roomId: '1', status: 'checked-in', arrival: '2026-11-20', departure: '2026-11-25', partySize: 2 }];
  const result = getDashboardRoomStats(rooms, reservations, today);
  assert.equal(result.counts.occupied, 0);
  assert.equal(result.counts.dirty, 1);
  assert.equal(result.inHouseGuests, 0);
});

test('a current checked-in stay remains occupied through its departure date until checkout', () => {
  const rooms = [{ id: '1', status: 'dirty' }];
  const reservations = [{ id: 'r1', roomId: '1', status: 'checked-in', arrival: '2026-11-20', departure: today, partySize: 2 }];
  const result = getDashboardRoomStats(rooms, reservations, today);
  assert.equal(result.counts.occupied, 1);
  assert.equal(result.departures.length, 1);
  assert.equal(result.inHouseGuests, 2);
});

test('a booking awaiting check-in is booked, not occupied, and contributes to rooms sold', () => {
  const rooms = [{ id: '1', status: 'occupied' }];
  const reservations = [{ id: 'r1', roomId: '1', status: 'booked', arrival: '2026-11-27', departure: '2026-11-30', partySize: 2 }];
  const result = getDashboardRoomStats(rooms, reservations, today);
  assert.equal(result.counts.occupied, 0);
  assert.equal(result.counts.booked, 1);
  assert.equal(result.soldToday, 1);
  assert.equal(result.inHouseGuests, 0);
  assert.equal(result.arrivals.length, 0);
});

test('future bookings are shown separately and do not inflate current occupancy', () => {
  const rooms = [{ id: '1', status: 'booked' }];
  const reservations = [{ id: 'r1', roomId: '1', status: 'booked', arrival: '2026-12-02', departure: '2026-12-04', partySize: 2 }];
  const result = getDashboardRoomStats(rooms, reservations, today);
  assert.equal(result.counts.booked, 1);
  assert.equal(result.soldToday, 0);
  assert.equal(result.occupancy, 0);
});

test('out-of-order rooms are excluded from sellable inventory', () => {
  const result = getDashboardRoomStats([{ id: '1', status: 'maintenance' }], [], today);
  assert.equal(result.counts.ooo, 1);
  assert.equal(result.sellable, 0);
  assert.equal(result.occupancy, 0);
});
