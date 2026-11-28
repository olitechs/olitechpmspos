import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../migrations/20261128120000_phase4c_night_audit_boundary.sql');
const pmsService = read('../../src/services/pmsService.js');
const nightAudit = read('../../src/components/modules/NightAudit.jsx');
const permissions = read('../../src/lib/permissions.js');
const fixture = read('./fixtures/phase4c_night_audit_base.sql');
const runtime = read('./phase4c_night_audit_runtime.sql');
const workflow = read('../../.github/workflows/phase4c-night-audit-runtime.yml');

test('Phase 4C seeds the canonical night audit permissions without reassigning employees', () => {
  assert.match(migration, /insert into public\.employee_permission_codes[\s\S]*?'nightaudit\.run'/);
  assert.match(migration, /'nightaudit\.override'/);
  assert.match(migration, /No applied migration is rewritten, no migration is renumbered/);
  assert.match(migration, /destructive DDL, data backfill or employee reassignment is performed/);
});

test('Phase 4C night audit rows carry a replay-safe request key and audit trail', () => {
  assert.match(migration, /alter table public\.night_audits add column if not exists request_key text/);
  assert.match(migration, /alter table public\.night_audits add column if not exists request_fingerprint text/);
  assert.match(migration, /night_audits_property_request_key_uniq/);
  assert.match(migration, /create or replace function public\.fn_phase4c_run_night_audit\(/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /Night audit request key was reused with a different payload/);
  assert.match(migration, /'night_audit_failed'/);
  assert.match(migration, /'night_audit_closed'/);
  assert.match(migration, /'night_audit_variance_override'/);
});

test('Phase 4C reconciliation uses posted ledgers and blocks comparability variances', () => {
  assert.match(migration, /create or replace function public\.fn_phase4c_reconciliation_snapshot\(/);
  assert.match(migration, /from public\.folio_charges c[\s\S]*?c\.source = 'room'/);
  assert.match(migration, /from public\.payments p[\s\S]*?p\.status = 'posted'/);
  assert.match(migration, /r\.status = 'voided'/);
  assert.match(migration, /'voids_excluded'/);
  assert.match(migration, /'pos_tax_discount_variance'/);
  assert.match(migration, /'pos_split_tender_variance'/);
  assert.match(migration, /'blocking_variance'/);
});

test('the precheck surfaces reconciliation and the close is override-aware', () => {
  assert.match(migration, /create or replace function public\.fn_night_audit_precheck\(/);
  assert.match(migration, /'reconciliation', v_snapshot/);
  assert.match(migration, /'blocking_variance', \(v_snapshot ->> 'blocking_variance'\)::boolean/);
  assert.match(migration, /An override reason is required for a blocked night audit/);
  assert.match(migration, /public\.fn_phase4c_night_audit_override\(p_property_id, p_override_grant_id\)/);
});

test('the legacy close is a compatibility wrapper and accommodation uses the same permission', () => {
  assert.match(migration, /create or replace function public\.fn_run_night_audit\(p_property_id uuid, p_notes text default null\)/);
  assert.match(migration, /return public\.fn_phase4c_run_night_audit\(/);
  assert.match(migration, /per-actor and per-notes key so an ambiguous retry after the business date/);
  assert.match(migration, /create or replace function public\.fn_post_accommodation_charges\(/);
  assert.match(migration, /public\.fn_phase4c_night_audit_permission\(p_property_id\)/);
  assert.match(migration, /and status = 'closed'/);
});

test('an override grant cannot be spent by a different employee', () => {
  assert.match(migration, /Never let one employee spend another employee's grant/);
  assert.match(migration, /where s\.id = g\.staff_id[\s\S]*?s\.user_id = auth\.uid\(\)[\s\S]*?s\.is_active = true/);
});

test('the web client sends a stable request key and audited override evidence', () => {
  assert.match(pmsService, /supabase\.rpc\('fn_phase4c_run_night_audit'/);
  assert.match(pmsService, /p_request_key: requestKey/);
  assert.match(pmsService, /p_override_reason: overrideReason \|\| null/);
  assert.match(pmsService, /p_override_grant_id: overrideGrantId \|\| null/);
  assert.match(nightAudit, /ManagerAuthorizationScreen/);
  assert.match(nightAudit, /permissionCode="nightaudit\.override"/);
  assert.match(nightAudit, /requestKey,/);
  assert.match(nightAudit, /result\?\.status === 'failed'/);
  assert.match(nightAudit, /blocking_reason/);
});

test('the client permission catalogue mirrors the new server codes', () => {
  assert.match(permissions, /\{ code: 'nightaudit\.run', workspace: 'backoffice'/);
  assert.match(permissions, /\{ code: 'nightaudit\.override', workspace: 'backoffice'/);
});

test('all night audit RPCs are revoked from anonymous callers', () => {
  assert.match(migration, /revoke all on function public\.fn_night_audit_precheck\(uuid, date\) from public, anon/);
  assert.match(migration, /revoke all on function public\.fn_run_night_audit\(uuid, text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.fn_phase4c_run_night_audit\(uuid, text, date, text, text, uuid\) to authenticated/);
});

test('a disposable PostgreSQL runtime gate applies the migration and exercises the financial boundary', () => {
  assert.match(fixture, /CREATE TABLE public\.night_audits/);
  assert.match(fixture, /CREATE TABLE public\.audit_logs/);
  assert.match(fixture, /CREATE TABLE public\.pos_receipts/);
  assert.match(fixture, /Stale template reconciled by the Phase 4C-1 migration/);
  assert.match(runtime, /ROLE-002: built-in template reconciliation must be audited/);
  assert.match(runtime, /public\.fn_phase4c_reconciliation_snapshot/);
  assert.match(runtime, /status <> 'failed'/);
  assert.match(runtime, /runtime-stolen-override/);
  assert.match(runtime, /fn_post_accommodation_charges/);
  assert.match(runtime, /ROLLBACK;/);
  assert.match(workflow, /supabase\/tests\/fixtures\/phase4c_night_audit_base\.sql/);
  assert.match(workflow, /supabase\/migrations\/20261128120000_phase4c_night_audit_boundary\.sql/);
  assert.match(workflow, /supabase\/tests\/phase4c_night_audit_runtime\.sql/);
});
