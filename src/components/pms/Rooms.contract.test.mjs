import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Rooms.jsx', import.meta.url), 'utf8');

test('the room detail panel can actually be opened from the reservations table', () => {
  const opened = source.indexOf('setOpenRoom(room)');
  assert.ok(opened >= 0, 'the room cell must open RoomPanel');
  assert.ok(source.includes('<td className="p-0"'), 'the room cell keeps its row height when the number becomes a button');
  assert.ok(source.includes('openRoom && <RoomPanel room={openRoom} onClose={() => setOpenRoom(null)} />'));
});

test('removing a reservation asks for confirmation first', () => {
  const confirmIndex = source.indexOf('if (confirmRemove(rv))');
  const removeIndex = source.indexOf('pms.removeReservation(rv.id)');
  assert.ok(confirmIndex >= 0, 'the Remove button must be guarded by confirmRemove');
  assert.ok(confirmIndex < removeIndex, 'confirmation must run before the removal');
  assert.ok(source.includes('window.confirm('), 'use the app-wide confirm pattern');
  assert.ok(source.includes('The reservation will be marked cancelled'));
});
