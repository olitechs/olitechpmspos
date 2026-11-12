import test from 'node:test';
import assert from 'node:assert/strict';
import { activeWorkstations, workstationPresence } from './printerAgentCredentialsCore.js';

const NOW = Date.parse('2026-11-12T10:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('a workstation seen moments ago is online', () => {
  assert.equal(workstationPresence({ last_seen_at: ago(30_000) }, NOW).state, 'online');
});

test('a small clock skew is still online rather than "in the future"', () => {
  assert.equal(workstationPresence({ last_seen_at: new Date(NOW + 60_000).toISOString() }, NOW).state, 'online');
});

test('recent and older last-seen times read as a manager expects', () => {
  const recent = workstationPresence({ last_seen_at: ago(12 * 60_000) }, NOW);
  assert.equal(recent.label, 'Last seen 12 min ago');

  const earlier = workstationPresence({ last_seen_at: ago(3 * 3_600_000) }, NOW);
  assert.equal(earlier.label, 'Last seen 3 hr ago');

  const stale = workstationPresence({ last_seen_at: ago(9 * 24 * 3_600_000) }, NOW);
  assert.equal(stale.tone, 'warning');
  assert.match(stale.label, /^Not seen for /);
});

test('an unpaired or revoked workstation never looks healthy', () => {
  assert.equal(workstationPresence({}, NOW).state, 'never');
  assert.equal(workstationPresence({ revoked_at: ago(1000), last_seen_at: ago(1000) }, NOW).state, 'revoked');
  assert.equal(workstationPresence(null, NOW).state, 'unknown');
});

test('revoked rows are excluded from the active list', () => {
  const rows = [{ id: 'a' }, { id: 'b', revoked_at: ago(1000) }];
  assert.deepEqual(activeWorkstations(rows).map((r) => r.id), ['a']);
  assert.deepEqual(activeWorkstations(null), []);
});
