import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findRoomReservationOverlap,
  getPmsDateKey,
  getPmsTodayDate,
  isValidIsoDate,
  isValidStayRange,
  overlapsStayRanges,
} from './pmsDateUtils.js';

test('PMS date key follows Africa/Nairobi across UTC date boundaries', () => {
  assert.equal(getPmsDateKey(new Date('2026-10-08T21:30:00.000Z')), '2026-10-09');
  assert.equal(getPmsDateKey(new Date('2026-10-09T20:59:59.000Z')), '2026-10-09');
  assert.equal(getPmsDateKey(new Date('2026-10-09T21:00:00.000Z')), '2026-10-10');
});

test('PMS calendar date is created at local noon to avoid midnight rollover', () => {
  const date = getPmsTodayDate(new Date('2026-10-08T21:30:00.000Z'));
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 9);
  assert.equal(date.getHours(), 12);
});

test('ISO date and stay range validation rejects impossible and zero-night stays', () => {
  assert.equal(isValidIsoDate('2024-02-29'), true);
  assert.equal(isValidIsoDate('2026-02-29'), false);
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidStayRange('2026-10-09', '2026-10-09'), false);
  assert.equal(isValidStayRange('2026-10-09', '2026-10-10'), true);
});

test('hotel stay ranges are half-open so same-day turnover is allowed', () => {
  assert.equal(overlapsStayRanges('2026-10-08', '2026-10-10', '2026-10-10', '2026-10-12'), false);
  assert.equal(overlapsStayRanges('2026-10-08', '2026-10-11', '2026-10-10', '2026-10-12'), true);
  assert.equal(overlapsStayRanges('2026-10-10', '2026-10-12', '2026-10-08', '2026-10-10'), false);
});

test('room overlap ignores other rooms, the edited reservation, cancellations and checked-out stays', () => {
  const reservations = [
    { id: 'same', roomId: 'A', checkIn: '2026-10-08', checkOut: '2026-10-12', status: 'booked' },
    { id: 'other-room', roomId: 'B', checkIn: '2026-10-08', checkOut: '2026-10-12', status: 'booked' },
    { id: 'cancelled', roomId: 'A', checkIn: '2026-10-08', checkOut: '2026-10-12', status: 'cancelled' },
    { id: 'departed', roomId: 'A', checkIn: '2026-10-08', checkOut: '2026-10-12', status: 'checked-out' },
  ];
  assert.equal(findRoomReservationOverlap(reservations, 'A', '2026-10-10', '2026-10-11')?.id, 'same');
  assert.equal(findRoomReservationOverlap(reservations, 'A', '2026-10-10', '2026-10-11', 'same'), null);
  assert.equal(findRoomReservationOverlap(reservations, 'B', '2026-10-10', '2026-10-11')?.id, 'other-room');
  assert.equal(findRoomReservationOverlap(reservations, 'C', '2026-10-10', '2026-10-11'), null);
});

test('invalid requested date ranges never report a room conflict', () => {
  assert.equal(findRoomReservationOverlap([{ id: 'x', roomId: 'A', checkIn: '2026-10-08', checkOut: '2026-10-12' }], 'A', '2026-10-11', '2026-10-10'), null);
});
