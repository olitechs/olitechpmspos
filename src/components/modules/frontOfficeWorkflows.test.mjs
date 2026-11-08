import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [app, posApp, reservations, channels, registration, walkIn, expressCheckout, service, store, shell, styles] = await Promise.all([
  read('../../App.jsx'),
  read('../../pages/POSApp.jsx'),
  read('../../components/modules/Reservations.jsx'),
  read('../../components/modules/ChannelManager.jsx'),
  read('../../components/modules/RegistrationCards.jsx'),
  read('../../components/modules/WalkInCheckIn.jsx'),
  read('../../components/modules/ExpressCheckOut.jsx'),
  read('../../services/pmsService.js'),
  read('../../data/PmsStore.jsx'),
  read('../../components/layout/FrontOfficeShell.jsx'),
  read('../../index.css'),
]);

test('Front Office routes open the real reservation, check-in, registration and channel modules', () => {
  for (const route of ['reservations', 'check-in/arrivals', 'check-in/in-house', 'check-in/departures']) {
    assert.match(app, new RegExp(`path="${route}" element={<POSApp initialModule="reservations"`));
  }
  assert.match(app, /path="channels" element={<POSApp initialModule="channels"/);
  assert.match(app, /path="check-in\/registration-cards" element={<POSApp initialModule="registration-cards"/);
  assert.match(posApp, /case 'registration-cards':[\s\S]*?<RegistrationCards \/>/);
  assert.ok(app.includes('path="check-in/walk-in" element={<POSApp initialModule="walk-in-checkin"'));
  assert.ok(app.includes('path="check-in/express-checkout" element={<POSApp initialModule="express-checkout"'));
  assert.ok(posApp.includes("case 'walk-in-checkin':\n        content = <WalkInCheckIn />;"));
  assert.ok(posApp.includes("case 'express-checkout':\n        content = <ExpressCheckOut />;"));
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
  assert.match(channels, /Confirmations/);
  assert.match(channels, /profile marked Pending is not live inventory synchronisation/);
  assert.doesNotMatch(channels, /credentials.*password/i);
});

test('registration cards use saved guest data and the audited PDF export engine', () => {
  assert.match(registration, /guest\?\.guest_details/);
  assert.match(registration, /guest\?\.id_number/);
  assert.match(registration, /reservation\?\.bookingDetails/);
  assert.match(registration, /DocumentExportMenu/);
  assert.match(registration, /formats=\{\['pdf', 'print'\]\}/);
  assert.match(registration, /createReportDefinition/);
  assert.match(registration, /Missing information is shown as —/);
});


test('walk-in check-in validates room capacity and uses the transactional PMS walk-in RPC', () => {
  assert.match(walkIn, /arrival !== today/);
  assert.match(walkIn, /Number\(partySize\) > Number\(room\.capacity/);
  assert.match(walkIn, /pms\.checkInRoom\(room\.id/);
  assert.match(walkIn, /The room charge is posted to the guest folio/);
});

test('express checkout verifies posted payments and requires a zero folio balance', () => {
  assert.match(expressCheckout, /pmsService\.listPayments/);
  assert.match(expressCheckout, /row\.status === 'posted'/);
  assert.match(expressCheckout, /pms\.checkOutRoom\(selected\.roomId\)/);
  assert.match(expressCheckout, /balance <= 0\.005/);
  assert.match(expressCheckout, /outstanding balance/);
});


test('responsive CSS keeps the planner toolbar usable at tablet and phone widths', () => {
  assert.match(shell, /min-\[1100px\]:hidden/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /\.room-planner-toolbar-actions \{ width: 100%; \}/);
  assert.match(styles, /\.room-planner-tool-button \{ min-height: 44px; \}/);
});
