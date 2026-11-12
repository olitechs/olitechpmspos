import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync(new URL('../migrations/20261110200000_front_office_laundry_folio_posting.sql',import.meta.url),'utf8');
const page=readFileSync(new URL('../../src/pages/FrontOfficeLaundry.jsx',import.meta.url),'utf8');
const app=readFileSync(new URL('../../src/App.jsx',import.meta.url),'utf8');
test('laundry folio RPC validates property, in-house guest and itemized pricing atomically',()=>{
 assert.match(sql,/auth\.uid\(\) is null/i);
 assert.match(sql,/is_member_of_property\(p_property_id\)/);
 assert.match(sql,/status::text\s*<>\s*'checked-in'/);
 assert.match(sql,/for update/i);
 assert.match(sql,/insert into public\.laundry_orders/i);
 assert.match(sql,/insert into public\.folio_charges/i);
 assert.match(sql,/jsonb_array_elements\(p_items\)/i);
 assert.match(sql,/revoke execute .* from public,anon/i);
 assert.match(sql,/grant execute .* to authenticated/i);
});
test('Front Office laundry page uses existing orders and folio RPC',()=>{
 assert.match(page,/fn_create_laundry_order_with_folio/);
 assert.match(page,/fn_update_laundry_order/);
 assert.match(page,/\.eq\('property_id',propertyId\)/);
 assert.match(page,/\.eq\('status','checked-in'\)/);
 assert.ok(app.includes('path="services/laundry" element={<FrontOfficeLaundry/>}'));
});
