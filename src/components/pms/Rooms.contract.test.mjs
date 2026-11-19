import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const roomsPage = readFileSync(new URL('./Rooms.jsx', import.meta.url), 'utf8');
const roomManagement = readFileSync(new URL('./RoomManagement.jsx', import.meta.url), 'utf8');

test('Rooms workspace keeps room configuration separate from the dedicated Room Planner', () => {
  assert.ok(roomsPage.includes('<RoomManagement onChanged={pms.reload} />'));
  assert.ok(roomsPage.includes('<RoomPlanner rooms={pms.rooms} reservations={pms.reservations} onRefresh={pms.reload} />'));
  assert.ok(roomsPage.includes('/frontoffice/room-planner'));
});

test('deleting room configuration requires explicit confirmation before the service call', () => {
  const removals = [
    ['removeRate', 'pmsService.deleteRatePlan(id)'],
    ['removeType', 'pmsService.deleteRoomType(id)'],
    ['removeRoom', 'pmsService.deleteRoom(id)'],
  ];

  for (const [handler, serviceCall] of removals) {
    const start = roomManagement.indexOf(`const ${handler} = async`);
    const end = roomManagement.indexOf('\n  const ', start + 1);
    const body = roomManagement.slice(start, end < 0 ? roomManagement.length : end);
    const confirmation = body.indexOf('if (!confirm(');
    const deletion = body.indexOf(serviceCall);
    assert.ok(start >= 0, `${handler} handler must exist`);
    assert.ok(confirmation >= 0, `${handler} must ask for confirmation`);
    assert.ok(deletion > confirmation, `${handler} must confirm before deleting`);
  }
});
