import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const read = (name) => readFileSync(new URL('../../src/pages/' + name + '.jsx', import.meta.url), 'utf8');
const pages = {
  assistance: read('FrontOfficeAssistance'), configuration: read('FrontOfficeConfiguration'),
  requests: read('FrontOfficeGuestRequests'), laundry: read('FrontOfficeLaundry'),
  maintenance: read('FrontOfficeMaintenance'), minibar: read('FrontOfficeMinibar'),
  statistics: read('FrontOfficeStatistics'), tags: read('FrontOfficeTags'),
};

test('Front Office coming-soon routes now load dedicated lazy pages', () => {
  for (const name of ['Assistance','Configuration','GuestRequests','Laundry','Maintenance','Minibar','Statistics','Tags']) assert.ok(app.includes('FrontOffice' + name + ' = lazyWithRetry'));
  for (const path of ['assistance','configuration','tags','statistics/:report','services/minibar','services/laundry','services/maintenance','services/guest-requests']) assert.ok(app.includes('path="' + path + '" element={<FrontOffice'));
});

test('configuration and tags use the existing property-scoped tables', () => {
  for (const value of ["from('rate_plans')", "from('booking_engine_settings')", ".eq('property_id', propertyId)"]) assert.ok(pages.configuration.includes(value), value);
  for (const value of ["from('property_tags')", "from('property_tag_assignments')", 'entity_type', 'created_by:user?.id']) assert.ok(pages.tags.includes(value), value);
});

test('guest requests and assistance reuse the property request and event ledgers', () => {
  for (const value of ["from('guest_service_requests')", "from('guest_service_request_events')", ".eq('property_id',propertyId)", 'assigned_to', 'created_by:user?.id']) assert.ok(pages.requests.includes(value), value);
  assert.ok(pages.assistance.includes('guest_service_requests'));
  assert.ok(pages.assistance.includes('guest_service_request_events'));
});

test('laundry and minibar post through existing atomic database workflows', () => {
  for (const value of ['fn_create_laundry_order_with_folio', 'fn_update_laundry_order', 'qty:Number(x.quantity)', 'unit_price:Number(x.unitPrice)']) assert.ok(pages.laundry.includes(value), value);
  for (const value of ['fn_post_minibar_consumption', "from('products')", "from('folio_charges')", "status','checked-in"]) assert.ok(pages.minibar.includes(value), value);
  assert.ok(!pages.minibar.includes("from('products').update("));
  assert.ok(!pages.minibar.includes("from('folio_charges').insert("));
});

test('maintenance uses the existing maintenance service and safe room workflow', () => {
  for (const value of ['listMaintenanceTickets(propertyId)', 'createMaintenanceTicket', 'updateMaintenanceTicket', 'getMaintenanceDashboard(propertyId)']) assert.ok(pages.maintenance.includes(value), value);
});

test('statistics period is initialized before the effect that reads it', () => {
  assert.ok(pages.statistics.indexOf('const [period') < pages.statistics.indexOf('useEffect('));
  for (const value of ['Occupancy', 'ADR and RevPAR', 'Revenue', 'Sources / Channels', 'Guest Origin', 'Cancellations and No-shows', 'Forecast', 'Export summary']) assert.ok(pages.statistics.includes(value), value);
});
