import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tags=readFileSync(new URL('../../src/pages/FrontOfficeTags.jsx',import.meta.url),'utf8');
const assistance=readFileSync(new URL('../../src/pages/FrontOfficeAssistance.jsx',import.meta.url),'utf8');
const app=readFileSync(new URL('../../src/App.jsx',import.meta.url),'utf8');

test('Front Office tags reuse the property tag schema and support all three record types',()=>{
 for(const table of ['property_tags','property_tag_assignments'])assert.match(tags,new RegExp(table));
 for(const type of ['guest','room','reservation'])assert.match(tags,new RegExp(type));
 assert.match(tags,/property_id/);
 assert.match(tags,/created_by:user\?\.id/);
 assert.match(tags,/\.delete\(\)/);
});

test('assistance history reuses the guest service request and event ledger',()=>{
 assert.match(assistance,/guest_service_requests/);
 assert.match(assistance,/guest_service_request_events/);
 assert.match(assistance,/property_id/);
 assert.match(assistance,/services\/guest-requests/);
 assert.doesNotMatch(assistance,/create table|insert into/i);
});

test('Front Office tags and assistance routes load dedicated pages',()=>{
 assert.match(app,/FrontOfficeTags = lazyWithRetry/);
 assert.match(app,/FrontOfficeAssistance = lazyWithRetry/);
 assert.match(app,/path="tags" element={<FrontOfficeTags\/>}/);
 assert.match(app,/path="assistance" element={<FrontOfficeAssistance\/>}/);
});
