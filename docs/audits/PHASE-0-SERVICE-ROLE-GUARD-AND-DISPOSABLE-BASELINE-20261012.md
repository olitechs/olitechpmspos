# Phase 0 service-role guard and disposable baseline — 2026-10-12

## Status

- Service-role entitlement-update regression: **patched in a forward-only migration and behavior-tested on the existing disposable project**.
- Production: **read-only; no SQL or migration was applied**.
- Disposable schema equivalence: **not established**. It must not yet be described as a production-equivalent baseline.

## Service-role guard correction

Migration: `supabase/migrations/20261012100000_phase0_service_role_entitlement_guard.sql`

The trigger now returns without blocking when the effective PostgreSQL role is one of `service_role`, `postgres`, or `supabase_admin`. All other roles still require `public.is_platform_owner()` before changing `properties.status` or `properties.package`.

The check uses `current_user`, the effective database role, rather than trusting only a JWT role claim. The service-role key must remain server-side; this guard is not a reason to expose it to clients.

## Disposable behavior checks

Applied the guard function only to the existing disposable project `rmkcwminrizloosvegzp` (not production).

1. **Trusted service-role update:** inside a transaction, set the effective role to `service_role`, change the test property's package, assert exactly one row was affected, then roll back. Passed.
2. **Property-owner update:** set the effective role to `authenticated`, set the test JWT subject to the fixture's owner, attempt to change the same property's package, and assert SQLSTATE `42501` is raised. Passed.
3. Both checks were transaction-scoped and rolled back; fixture data was not retained.

These tests validate the guard behavior in this disposable database only. They do not constitute a complete Phase 0 or cross-tenant test suite.

## Why the disposable is not yet schema-equivalent

The latest catalog inspection showed 76 public base tables in production versus 47 in the disposable. The `public.pos_shifts` shape also differs: production has 11 columns while the disposable has 5. The disposable's migration ledger does not record the merged remediation migration even though some patched objects were already present. Therefore it is neither a clean replay of the tracked migration chain nor a schema-equivalent clone.

Six historical migration SQL bodies were not recoverable from connected sources. Reconstructing them from their names would be unsafe and would not prove historical equivalence.

## Baseline acceptance criteria

Do not call the disposable equivalent until a schema-only export of production has been restored into the existing disposable project (never into production), and a machine-generated comparison has zero unexplained differences for:

- schemas, extensions, enums/domains, tables and columns (types, nullability, defaults, generated/identity properties);
- primary/unique/foreign/check constraints, indexes, sequences, views and materialized views;
- functions/procedures (definitions, owners, volatility, security mode, search path), triggers and event triggers;
- RLS enabled state and every policy expression;
- grants/default privileges, publication membership and relevant storage/auth schema dependencies;
- migration ledger and the exact deployed definitions of the Phase 0 RPCs.

The export must be schema-only: no production tenant data, auth users, secrets, or storage objects. Preserve a checksum of the export and the diff report. If the available tooling cannot produce and restore a full schema-only dump, stop and provision no new Supabase branch/project without explicit cost approval; do not approximate the baseline by creating only the missing tables.

## Rollout gate

Production rollout remains **HOLD** until a clean, schema-equivalent disposable baseline is available, the migration is replayed from that baseline, and positive/negative tests pass for two tenants, property owners/admins, platform owners, anonymous callers, and the trusted service-role path.
