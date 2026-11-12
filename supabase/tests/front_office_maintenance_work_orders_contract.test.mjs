import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page=readFileSync(new URL('../../src/pages/FrontOfficeMaintenance.jsx',import.meta.url),'utf8');
const app=readFileSync(new URL('../../src/App.jsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/0028_maintenance_2.sql',import.meta.url),'utf8');
test('Front Office maintenance route is wired to a lazy loaded operational page',()=>{
 assert.match(app,/FrontOfficeMaintenance = lazyWithRetry/);
 assert.ok(app.includes('path="services/maintenance" element={<FrontOfficeMaintenance/>}'));
});
test('maintenance workspace uses existing tenant-scoped services and status lifecycle',()=>{
 assert.match(page,/listMaintenanceTickets\(propertyId\)/);
 assert.match(page,/getMaintenanceDashboard\(propertyId\)/);
 assert.match(page,/createMaintenanceTicket/);
 assert.match(page,/updateMaintenanceTicket/);
 assert.match(page,/\.eq\('property_id',propertyId\)/);
 assert.match(page,/\.eq\('active',true\)/);
 assert.match(page,/in_progress/);
 assert.match(page,/resolution/);
});
test('existing maintenance RPC protects occupied rooms and validates room return state',()=>{
 assert.match(migration,/Cannot place an occupied or booked room into maintenance/);
 assert.match(migration,/return_status/);
 assert.match(migration,/is_member_of_property/);
 assert.match(migration,/is_platform_owner/);
});
