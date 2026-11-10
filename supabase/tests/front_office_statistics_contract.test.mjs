import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../../src/App.jsx',import.meta.url),'utf8');
const page=readFileSync(new URL('../../src/pages/FrontOfficeStatistics.jsx',import.meta.url),'utf8');
test('Front Office statistics routes use the dedicated report workspace',()=>{
 assert.match(app,/statistics\/:report["'] element={<FrontOfficeStatistics\/>/);
 assert.match(page,/Occupancy/);assert.match(page,/ADR and RevPAR/);assert.match(page,/Revenue/);
 assert.match(page,/Sources \/ Channels/);assert.match(page,/Guest Origin/);assert.match(page,/Cancellations and No-shows/);assert.match(page,/Forecast/);
});
test('statistics exports a period summary and labels reservation-level revenue limitations',()=>{
 assert.match(page,/Export summary/);assert.match(page,/URL\.createObjectURL/);
 assert.match(page,/not a substitute for settled folio/);
});
