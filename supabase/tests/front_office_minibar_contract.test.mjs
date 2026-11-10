import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page=readFileSync(new URL('../../src/pages/FrontOfficeMinibar.jsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../migrations/20261110220000_front_office_minibar_rpc_security.sql',import.meta.url),'utf8');
const app=readFileSync(new URL('../../src/App.jsx',import.meta.url),'utf8');

test('minibar posting uses the existing stock and folio transaction',()=>{
 assert.match(page,/fn_post_minibar_consumption/);
 assert.match(page,/folio_charges/);
 assert.match(page,/products/);
 assert.match(page,/status','checked-in/);
 assert.match(migration,/SECURITY DEFINER/);
 assert.match(migration,/is_member_of_property\(p_property_id\)/);
 assert.match(migration,/fn_apply_stock_movement/);
 assert.match(migration,/INSERT INTO public\.folio_charges/);
 assert.match(migration,/REVOKE ALL ON FUNCTION .* FROM anon/i);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION .* TO authenticated/i);
});

test('minibar page never creates a parallel stock or billing ledger',()=>{
 assert.doesNotMatch(page,/insert\(.*(products|stock_movements|folio_charges)/s);
 assert.match(page,/existing inventory movement ledger and guest folio ledger/);
});

test('Front Office minibar route loads the dedicated page',()=>{
 assert.match(app,/FrontOfficeMinibar = lazyWithRetry/);
 assert.match(app,/path="services\/minibar" element={<FrontOfficeMinibar\/>}/);
});
