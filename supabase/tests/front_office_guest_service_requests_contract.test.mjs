import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const migration=readFileSync(new URL('../migrations/20261110210000_front_office_guest_service_requests.sql',import.meta.url),'utf8');
const page=readFileSync(new URL('../../src/pages/FrontOfficeGuestRequests.jsx',import.meta.url),'utf8');
test('guest service requests are property scoped and retain activity history',()=>{
 assert.match(migration,/guest_service_requests_property_status_created_idx/);
 assert.match(migration,/is_member_of_property\(property_id\)/);
 assert.match(migration,/guest_service_request_events/);
 assert.match(migration,/fn_log_guest_service_request_event/);
 assert.match(migration,/security definer set search_path=public, pg_temp/i);
 assert.match(migration,/drop policy if exists guest_service_request_events_insert/i);
 assert.doesNotMatch(migration,/create policy guest_service_request_events_insert/i);
 assert.match(migration,/revoke all on public\.guest_service_requests,public\.guest_service_request_events from anon/i);
});
test('guest service page supports requests, transfers, tours and assignment',()=>{
 assert.match(page,/guest_request/);assert.match(page,/transfer/);assert.match(page,/tour/);
 assert.match(page,/assigned_to/);assert.match(page,/guest_service_request_events/);
});
