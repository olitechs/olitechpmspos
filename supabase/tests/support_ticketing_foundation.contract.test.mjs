import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../migrations/20261125193000_support_ticketing_foundation.sql', import.meta.url),
  'utf8',
);

test('support ticket tables are isolated from anonymous access and protected by RLS', () => {
  for (const table of ['support_tickets', 'support_ticket_messages', 'support_ticket_events']) {
    assert.match(migration, new RegExp('alter table public\\.' + table + ' enable row level security', 'i'));
    assert.match(migration, new RegExp('revoke all on public\\.' + table + ' from anon, authenticated', 'i'));
  }
});

test('ticket creation validates the signed-in property membership on the server', () => {
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /public\.is_member_of_property\(p_property_id\)/i);
  assert.match(migration, /create or replace function public\.create_support_ticket/i);
  assert.match(migration, /grant execute on function public\.create_support_ticket[\s\S]*to authenticated/i);
});

test('property members cannot read internal notes or mutate ticket assignment and status', () => {
  assert.match(migration, /not is_internal[\s\S]*public\.is_member_of_property/i);
  assert.match(migration, /is_internal and public\.is_platform_owner\(\)/i);
  assert.match(migration, /create policy support_tickets_platform_update[\s\S]*public\.is_platform_owner\(\)/i);
});

test('ticket replies and event history are persisted independently of maintenance work orders', () => {
  assert.match(migration, /create table if not exists public\.support_ticket_messages/i);
  assert.match(migration, /create table if not exists public\.support_ticket_events/i);
  assert.match(migration, /create trigger support_ticket_messages_record_event/i);
  assert.doesNotMatch(migration, /(?:alter|drop|truncate)\s+table\s+public\.maintenance_tickets/i);
});

test('security definer functions use a fixed search path and do not expose direct execution', () => {
  assert.match(migration, /security definer\s+set search_path = public/i);
  assert.match(migration, /revoke all on function public\.record_support_ticket_event\(\) from public, anon, authenticated/i);
});
