import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [app, posApp, reservations, channels, registration, service, store, shell] = await Promise.all([
  read('../../src/App.jsx'),
  read('../../src/pages/POSApp.jsx'),
  read('../../src/components/modules/Reservations.jsx'),
  read('../../src/components/modules/ChannelManager.jsx'),
  read('../../src/components/modules/RegistrationCards.jsx'),
  read('../../src/services/pmsService.js'),
  read('../../src/data/PmsStore.jsx'),
  read('../../src/components/layout/FrontOfficeShell.jsx'),
]);

test('Front Office routes open the real reservation, check-in, registration and channel modules', () => {
  for (const route of ['reservations', 'check-in/arrivals', 'check-in/in-house', 'check-in/departures']) {
    assert.match(app, new RegExp(`path="${route}" element={<POSApp initialModule="reservations"`));
  }
  assert.match(app, /path="channels" element={<POSApp initialModule="channels"/);
  assert.match(app, /path="check-in\/registration-cards" element={<POSApp initialModule="registration-cards"/);
  assert.match(posApp, /case 'registration-cards':[\s\S]*?<RegistrationCards \/>/);
  assert.match(shell, /Sparkles, Tags, Users/);
  assert.match(posApp, /flex h-full min-h-0 w-full flex-col bg-\[var\(--bg\)\]/);
  assert.match(posApp, /flex min-h-0 min-w-0 flex-1 flex-col/);
});

test('reservation views provide separate arrivals, in-house and departures queues', () => {
  assert.match(reservations, /path\.endsWith\('\/check-in\/arrivals'\)/);
  assert.match(reservations, /path\.endsWith\('\/check-in\/in-house'\)/);
  assert.match(reservations, /path\.endsWith\('\/check-in\/departures'\)/);
  assert.match(reservations, /pms\.checkInReservation\(r\.id\)/);
  assert.match(reservations, /pms\.checkOutRoom\(r\.roomId\)/);
  assert.match(reservations, /Save guest profile/);
  assert.match(service, /async updateGuestProfile/);
  assert.match(store, /guestId: r\.guest_id/);
});

test('channel workspace manages profiles, room mappings and real activity feeds without claiming live sync', () => {
  for (const name of ['listChannelRoomMappings', 'createChannelRoomMapping', 'updateChannelRoomMapping', 'deleteChannelRoomMapping']) {
    assert.match(service, new RegExp(`async ${name}\\(`));
  }
  assert.match(channels, /Channel property profiles/);
  assert.match(channels, /External room-type ID/);
  assert.match(channels, /Outbound queue/);
  assert.match(channels, /Inbound events/);
  assert.match(channels, /Confirmation messages/);
  assert.match(channels, /Pending is not live inventory synchronisation/);
  assert.doesNotMatch(channels, /credentials.*password/i);
});

test('registration cards use saved guest data and the audited PDF export engine', () => {
  assert.match(registration, /guest\.guest_details/);
  assert.match(registration, /guest\.id_number/);
  assert.match(registration, /reservation\.bookingDetails/);
  assert.match(registration, /DocumentExportMenu/);
  assert.match(registration, /formats=\{\['pdf', 'print'\]\}/);
  assert.match(registration, /createReportDefinition/);
  assert.match(registration, /Missing information is shown as —/);
});
