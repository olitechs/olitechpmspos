# Phase 4A — Governance and applied-state baseline

**Branch:** `audit/phase4-reports-night-audit`
**Base:** `main` at `e0aa0c217704d4ca4ba749dd8c6f3915eac35b09`
**Date:** 2026-11-27
**Status:** BASELINE PREPARED — no migration applied, no database connection used, no implementation authorized.

This note is the Phase 4A governance/baseline deliverable from `PHASE4-AUDIT.md` section 5. It is read-only repository evidence plus preflight SQL for a controlled staging or production-equivalent database. It does not reconcile the live migration ledger and does not approve Phase 4B–4E.

## 1. Scope and evidence limits

The repository is at `225` SQL migration files: `82` legacy four-digit prefixes and `143` fourteen-digit timestamp prefixes. Earlier audits recorded smaller snapshots (`docs/architecture/PHASE-0-MIGRATION-BASELINE-AUDIT.md`: `129` files; `docs/DATABASE_MIGRATION_RECONCILIATION.md`: `69` timestamped files), so those counts are historical and must not be treated as current.

Known historical baseline facts:

- `docs/architecture/PHASE-0-MIGRATION-BASELINE-AUDIT.md` recorded `38` applied ledger entries, incomplete file-to-ledger mapping, duplicate prefixes, no verified schema-only dump, and no clean local rebuild evidence.
- `docs/DATABASE_MIGRATION_RECONCILIATION.md` recorded eight exact SQL files applied on 2026-11-14 under generated remote versions different from their repository prefixes. It states that `supabase_migrations.schema_migrations` is the ledger comparison point, that matching schema objects are not proof of application, and that migration repair must use the supported Supabase CLI rather than direct ledger DML.
- `docs/PHASE_10_PRODUCTION_QA.md` records later live verification for specific integrity items but is not a full migration reconciliation.

No live Supabase project was queried for this note. Every “applied” or “unapplied” statement below is therefore a repository-static classification or a historical snapshot, not a current production fact.

## 2. Governance rules

1. Never edit, rename, renumber, delete, or replay an applied migration to make history look clean.
2. Do not infer application from a matching function, table, policy, or migration name. Compare file content, ledger version/name, live catalog, and data effects.
3. Do not insert or delete rows in `supabase_migrations.schema_migrations` directly. Use `supabase migration repair` only after content verification and explicit approval.
4. Any correction must be a new forward-only migration with a unique timestamp, idempotent guards, and a deployment note.
5. Database changes deploy before frontend changes that depend on them.
6. Capture function definitions, grants, policies, triggers, and schema-only dumps to a restricted release artifact. Do not commit business rows, credentials, or catalog dumps containing sensitive data.
7. A staging database is a valid proxy only after its catalog/version inventory is compared with production.

## 3. Duplicate migration prefixes

Duplicate prefixes are deployment-history ambiguity, not proof that a migration was or was not applied. Do not resolve them by renaming applied files. Each pair must be classified against the ledger and live catalog before `supabase db push --dry-run --remote` is trusted.

| Prefix | Repository files | Governance note |
|---|---|---|
| `0016` | `0016_fix_room_planner_raise.sql`, `0016_store_controls_inventory.sql` | Legacy pair; map by content and ledger before any repair. |
| `0028` | `0028_inventory_recipe_laundry_transfers.sql`, `0028_maintenance_2.sql` | Legacy pair; both touch Phase 4 advanced surfaces. |
| `0032` | `0032_property_paywall.sql`, `0032_property_subscriptions.sql` | `property_paywall` is statically unapplyable; `property_subscriptions` is the likely applied authority. Verify both. |
| `0033` | `0033_platform_owner_controls.sql`, `0033_pos_table_sessions.sql` | Legacy pair; unrelated domains sharing a prefix. |
| `0034` | `0034_live_dashboard_activity.sql`, `0034_platform_owner_property_management.sql` | Legacy pair; dashboard function must be verified separately. |
| `0035` | `0035_exclude_voided_pos_reporting.sql`, `0035_subscription_access_bootstrap.sql` | Legacy pair; both affect Phase 4 reporting/entitlements. |
| `0037` | `0037_persistent_printer_config.sql`, `0037_property_members_rpc_schema_cache_fix.sql` | Legacy pair; printer path is protected. |
| `0040` | `0040_platform_property_status_and_subscription_visibility.sql`, `0040_pos_table_sessions_realtime.sql`, `0040_property_workspace_roles.sql` | Three files share a version; do not assume apply order. |
| `0045` | `0045_property_admin_unsettled_receipt_settings.sql`, `0045_unsettled_receipt_settings.sql` | Legacy pair; likely related but not proven identical. |
| `0047` | `0047_hardened_direct_printer_transport.sql`, `0047_pos_kot_sent_at.sql` | Legacy pair; printer path is protected. |
| `0048` | `0048_default_void_printer_assignments.sql`, `0048_direct_printer_schema_hardening.sql` | Legacy pair; void/printer path is protected. |
| `0049` | `0049_multi_transport_physical_printers.sql`, `0049_void_print_status_policies.sql` | Legacy pair; void/printer path is protected. |
| `20261008170000` | `20261008170000_phase7_backoffice_timecards.sql`, `20261008170000_phase8_daily_hotel_metrics.sql` | Timestamp duplicate already called out in reconciliation doc. |
| `20261008223000` | `20261008223000_fix_inventory_location_function_volatility.sql`, `20261008223000_phase10_production_index_cleanup.sql` | Timestamp duplicate already called out in reconciliation doc. |

## 4. Static applyability blockers

These are repository-file defects. They must not be “fixed” in place if the file was ever applied. A forward-only correction is required after the applied-state inventory.

| File | Static blocker | Consequence |
|---|---|---|
| `0031_booking_engine_channel_connectivity.sql` | Literal `=======` marker at line 225; unsupported `create policy if not exists` at lines 144–151 and 191–193. | The file cannot be treated as a clean replayable migration. The post-marker branch has corrected policy syntax, but the whole file is not safely applyable as committed. |
| `0031_booking_engine_channel_connectivity.sql` | Pre-marker `fn_receive_channel_reservation` has no caller check (lines 204–212) and grants `EXECUTE` to `anon,authenticated` (line 222). | If the pre-marker branch was ever applied to a live database, browser callers may be able to fabricate channel reservation events. Verify grants and definition; restore service-role/member+ownership behavior forward-only. |
| `0032_property_paywall.sql` | Invalid dollar quoting at lines 10 and 15 (`as $ ... $;`); unsupported `CREATE POLICY IF NOT EXISTS` at lines 9 and 49; `s.id` at line 32 although `property_subscriptions` is keyed by `property_id` at line 2. | The file cannot be relied on as a replayable source. Verify the actual subscription functions from `0032_property_subscriptions.sql` and later engines. |
| `20261114100000_pos_shift_opening_notes.sql` | Drops the old `(uuid,numeric)` signature and creates `(uuid,numeric,text)` with defaults (lines 19–25). `20261117133000_...` later creates `(uuid,numeric)` again (line 526). | Depending on applied order, two overloads can coexist. `shiftService.js` omits `p_notes` when blank, so note-free and note-bearing opens can resolve to different permissions and duplicate-shift rules. |
| `20261115120000_pos_cash_variance_threshold.sql` | Adds property threshold column on `property_settings` (lines 10–18). `20261117134500_...` still hardcodes `500` at lines 165–178. | Frontend setting is not authoritative until the close RPC reads the property value. |
| `20261119120000_phase2_folio_room_charge_control.sql` | Posted accommodation RPC uses `nightaudit.run`; `fn_run_night_audit` in `20261117133000_...` uses `back_office.reports.view`. | Night Audit and accommodation posting do not share one permission contract. |
| `fn_create_laundry_order_with_folio` | No migration defines this RPC. Only `src/pages/FrontOfficeLaundry.jsx:32`, `docs/adr/ADR-0004-services-only-data-access.md:47`, and a source-string assertion in `supabase/tests/front_office_workspace_contract.test.mjs:31` reference it. | The current route calls a missing server function; a string-only contract test gives false confidence. |

## 5. Function supersession chains

These are static chains by repository filename order. Filename order is not proof of apply order. The live `pg_proc` definition, result type, `SECURITY DEFINER` flag, `proconfig`, and `EXECUTE` grants must be captured before any correction.

| Domain | Function | Repository chain | Latest static definition |
|---|---|---|---|
| Reporting | `fn_daily_pos_summary` | `0024_live_daily_reporting.sql` → `0035_exclude_voided_pos_reporting.sql` → `0060_pos_phase4b_reporting.sql` | `0060` posts only, uses Africa/Nairobi business date, exposes discount/modifier totals. |
| Reporting | `fn_recent_dashboard_activity` | `0034_live_dashboard_activity.sql` | Property-scoped, posted POS only; reservations are not status-filtered. |
| Reporting | `fn_management_report` | `20261008190000_phase8_reporting_management.sql` → `20261008200000_phase8_reporting_accuracy.sql` | `20261008200000` uses reservation `rate × nights`, POS gross/tax, refunds, voids, inventory valuation. |
| Reporting | `fn_management_sales_detail` | `20261008190000_phase8_reporting_management.sql` | No later redefinition found. |
| Night Audit | `fn_get_business_date` | `0026_night_audit.sql` | No later redefinition found. |
| Night Audit | `fn_night_audit_precheck` | `0026_night_audit.sql` → `20261117133000_gate_workspace_rpc_actions_with_employee_permissions.sql` | Gated by `back_office.reports.view`; checks open shifts and pending adjustments. |
| Night Audit | `fn_run_night_audit` | `0026_night_audit.sql` → `20261117133000_gate_workspace_rpc_actions_with_employee_permissions.sql` | Locks business date, rechecks blockers, inserts one `closed` audit row, advances date. Room revenue still comes from `pos_receipts.payment_method='room'`. |
| Night Audit | `fn_night_audit_history` | `0026_night_audit.sql` | No later redefinition found. |
| Shift | `fn_open_cashier_shift` | `0025_cashier_controls.sql` → `20261109071304_shift_control_v2_single_open_shift_and_reports.sql` → `20261114100000_pos_shift_opening_notes.sql` → `20261117133000_gate_workspace_rpc_actions_with_employee_permissions.sql` | Both `(uuid,numeric,text)` and `(uuid,numeric)` may exist; permissions and duplicate rules differ. |
| Shift | `fn_close_cashier_shift` | `0025_cashier_controls.sql` → `20261008150000_phase6_cashier_financial_hardening.sql` → `20261109070503_...` → `20261109071304_...` → `20261117134500_...` | Latest enforces table clearing, permission checks, and hardcoded KES 500 manager threshold. |
| Shift | `fn_cashier_shift_summary` | `0025_cashier_controls.sql` → `20261008150000_...` → `20261117134500_...` | Latest version is used by the close path. |
| Shift | `fn_shift_report` | `20261109071304_...` → `20261117140000_gate_folio_reversal_and_shift_report_permissions.sql` | Server-authoritative split tender, VAT, discounts, voids, refunds, and drawer report; no `src/` caller found. |
| Channel | `fn_channel_connection_upsert` | `0031` pre-marker branch → `0031` post-marker branch | Membership/platform-owner check only; no employee permission code. |
| Channel | `fn_queue_channel_sync` | `0031` pre-marker branch → `20261115044500_restore_channel_sync_rpc_functions.sql` | Restored version checks member/platform owner and connection ownership. |
| Channel | `fn_receive_channel_reservation` | `0031` pre-marker branch → `20261115044500_restore_channel_sync_rpc_functions.sql` | Restored version allows service role or member/platform owner plus connection ownership; browser anon grant revoked in repository. |
| Subscription | `fn_get_subscription` | `0032_property_paywall.sql` → `0032_property_subscriptions.sql` | Verify the valid `0032_property_subscriptions.sql` definition is live. |
| Subscription | `fn_upsert_subscription` | `0032_property_paywall.sql` → `0032_property_subscriptions.sql` → `0041_hotel_subscription_readonly_overview.sql` | Verify latest live definition and grants. |
| Subscription | `fn_subscription_access` | `0032_property_paywall.sql` → `0032_property_subscriptions.sql` → `0035_subscription_access_bootstrap.sql` → `0042_active_property_subscription_access_fix.sql` → `20261012160000_workspace_entitlement_module_normalization.sql` → `20261117180000_subscription_entitlement_engine.sql` | Latest repository definition is the entitlement engine; verify applied state before relying on it. |
| Subscription | `fn_record_subscription_event` | `0032_property_paywall.sql` → `0032_property_subscriptions.sql` | Must remain platform/provider managed. |
| Authorization | `fn_employee_permission_codes` | `20261117105534` → `20261117130000` → `20261117131500` → `20261117144500` → `20261120130000` → `20261120140000` → `20261123093000` → `20261123145044` → `20261123150907` → `20261123154837` → `20261123162619` → `20261123181701` → `20261125111000` | Latest repository chain is `20261125111000_phase3_stores_role_templates.sql`; verify live definition before permission decisions. |

## 6. Staging/production preflight SQL

Run these queries with a read-only role or inside a reviewed maintenance session. Capture output to a restricted release artifact. Do not commit catalog dumps or business rows.

### 6.1 Environment and ledger presence

```sql
select current_database() as database_name,
       current_user as database_user,
       version() as server_version;

select to_regclass('supabase_migrations.schema_migrations') as ledger_table;
```

If `ledger_table` is null, stop. There is no Supabase migration ledger to reconcile.

### 6.2 Ledger inventory and critical-version probe

```sql
select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 100;

with expected(version, repository_file, note) as (
  values
    ('0031', '0031_booking_engine_channel_connectivity.sql', 'conflict marker + channel receiver risk'),
    ('0032', '0032_property_paywall.sql', 'statically unapplyable'),
    ('0032', '0032_property_subscriptions.sql', 'duplicate prefix; likely subscription authority'),
    ('0035', '0035_exclude_voided_pos_reporting.sql', 'duplicate prefix; void-safe POS reporting'),
    ('0060', '0060_pos_phase4b_reporting.sql', 'latest static daily POS summary'),
    ('0026', '0026_night_audit.sql', 'original night audit'),
    ('20261114100000', '20261114100000_pos_shift_opening_notes.sql', '3-arg shift open'),
    ('20261117133000', '20261117133000_gate_workspace_rpc_actions_with_employee_permissions.sql', '2-arg shift open + night audit gate'),
    ('20261117134500', '20261117134500_enforce_shift_and_pos_action_permissions.sql', 'close threshold + audit'),
    ('20261117140000', '20261117140000_gate_folio_reversal_and_shift_report_permissions.sql', 'authoritative shift report'),
    ('20261115044500', '20261115044500_restore_channel_sync_rpc_functions.sql', 'channel RPC restoration'),
    ('20261125111000', '20261125111000_phase3_stores_role_templates.sql', 'latest static permission chain')
)
select e.version,
       e.repository_file,
       e.note,
       m.version as ledger_version,
       m.name as ledger_name,
       (m.version is not null) as ledger_recorded
from expected e
left join supabase_migrations.schema_migrations m
       on m.version = e.version
order by e.version, e.repository_file;

select version, name
from supabase_migrations.schema_migrations
where name ilike '%night%audit%'
   or name ilike '%report%'
   or name ilike '%channel%'
   or name ilike '%paywall%'
   or name ilike '%subscription%'
   or name ilike '%shift%'
order by version;
```

A missing exact version is not proof that the file was not applied; use the name probe, SQL content comparison, and the historical generated-version table in `docs/DATABASE_MIGRATION_RECONCILIATION.md`.

### 6.3 Function catalog and grants

```sql
select n.nspname as schema_name,
       p.proname as function_name,
       pg_catalog.oidvectortypes(p.proargtypes) as arguments,
       pg_get_function_result(p.oid) as returns,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       pg_get_userbyid(p.proowner) as owner,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fn_daily_pos_summary','fn_recent_dashboard_activity',
    'fn_management_report','fn_management_sales_detail',
    'fn_get_business_date','fn_night_audit_precheck','fn_run_night_audit','fn_night_audit_history',
    'fn_open_cashier_shift','fn_close_cashier_shift','fn_cashier_shift_summary','fn_shift_report',
    'fn_channel_connection_upsert','fn_queue_channel_sync','fn_receive_channel_reservation',
    'fn_get_subscription','fn_upsert_subscription','fn_subscription_access','fn_record_subscription_event',
    'fn_employee_permission_codes','fn_create_laundry_order','fn_create_laundry_order_with_folio'
  )
order by p.proname, arguments;

select p.proname as function_name,
       pg_catalog.oidvectortypes(p.proargtypes) as arguments,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'fn_daily_pos_summary','fn_management_report','fn_run_night_audit',
    'fn_open_cashier_shift','fn_close_cashier_shift','fn_shift_report',
    'fn_channel_connection_upsert','fn_queue_channel_sync','fn_receive_channel_reservation',
    'fn_subscription_access','fn_employee_permission_codes'
  )
order by p.proname, arguments;
```

Expected safe observations:

- `fn_receive_channel_reservation(uuid,uuid,text,text,jsonb)` exists exactly once, is not executable by `anon`, and contains service-role or member plus connection-ownership checks.
- `fn_open_cashier_shift` has one intended callable shape for the client. If both `(uuid,numeric)` and `(uuid,numeric,text)` exist, record both before changing anything.
- `fn_create_laundry_order_with_folio` returning zero rows confirms the missing RPC finding. `fn_create_laundry_order(uuid,uuid,uuid,text,jsonb,numeric,text)` from `0030_recipes_laundry_transfers.sql` is the currently defined migration-backed function.

### 6.4 RLS and relevant columns

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'booking_engine_settings','channel_connections','channel_sync_queue',
    'channel_reservation_events','property_subscriptions','subscription_events',
    'pos_receipts','pos_receipt_payments','cashier_shifts','cashier_refunds',
    'night_audits','property_business_dates','folio_charges','payments','products'
  )
order by tablename, policyname;

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'night_audits' and column_name in ('status','total_revenue','room_revenue','vat','notes','request_key'))
    or (table_name = 'property_settings' and column_name = 'pos_cash_variance_threshold')
    or (table_name = 'cashier_shifts' and column_name in ('variance_approved_by','variance_approved_at','opening_notes'))
    or (table_name = 'property_subscriptions' and column_name in ('property_id','status','enabled_modules'))
    or (table_name = 'pos_receipt_payments' and column_name in ('payment_method','amount','folio_charge_id'))
  )
order by table_name, column_name;
```

### 6.5 Read-only financial reconciliation probe

Replace the placeholders. Run as a role permitted to read the financial tables. This query reports side-by-side definitions; it does not decide D32 semantics.

```sql
with params as (
  select '<PROPERTY_UUID>'::uuid as property_id,
         date '<FROM_DATE>' as from_date,
         date '<TO_DATE>' as to_date
),
receipt_rows as (
  select r.id as receipt_id,
         r.status,
         r.total,
         r.discount_amount,
         r.vat,
         (r.created_at at time zone 'Africa/Nairobi')::date as business_date
  from params p
  join public.pos_receipts r
    on r.property_id = p.property_id
   and (r.created_at at time zone 'Africa/Nairobi')::date between p.from_date and p.to_date
),
receipt_totals as (
  select count(*) filter (where status = 'posted') as posted_receipts,
         coalesce(sum(total) filter (where status = 'posted'), 0) as pos_gross,
         coalesce(sum(discount_amount) filter (where status = 'posted'), 0) as discounts,
         coalesce(sum(vat) filter (where status = 'posted'), 0) as vat,
         count(*) filter (where status = 'voided') as voided_receipts,
         coalesce(sum(total) filter (where status = 'voided'), 0) as voided_gross
  from receipt_rows
),
tender_totals as (
  select coalesce(sum(rp.amount), 0) as allocated_tender,
         coalesce(sum(rp.amount) filter (where rp.payment_method = 'cash'), 0) as cash_tender,
         coalesce(sum(rp.amount) filter (where rp.payment_method = 'room'), 0) as room_tender
  from public.pos_receipt_payments rp
  join receipt_rows rr on rr.receipt_id = rp.receipt_id and rr.status = 'posted'
),
folio_charge_totals as (
  select coalesce(sum(fc.amount) filter (where fc.source = 'room'), 0) as posted_room_charges,
         coalesce(sum(fc.amount) filter (where fc.source = 'pos'), 0) as pos_charges_to_room
  from params p
  join public.folio_charges fc
    on fc.property_id = p.property_id
   and fc.created_at::date between p.from_date and p.to_date
),
payment_totals as (
  select coalesce(sum(pay.amount), 0) as posted_payments
  from params p
  join public.payments pay
    on pay.property_id = p.property_id
   and pay.created_at::date between p.from_date and p.to_date
),
refund_totals as (
  select coalesce(sum(cr.amount), 0) as refunds,
         coalesce(sum(cr.amount) filter (where cr.method = 'cash'), 0) as cash_refunds
  from params p
  join public.cashier_refunds cr
    on cr.property_id = p.property_id
   and (cr.created_at at time zone 'Africa/Nairobi')::date between p.from_date and p.to_date
),
night_audit_totals as (
  select count(*) as audit_rows,
         coalesce(sum(total_revenue), 0) as reported_total_revenue,
         coalesce(sum(room_revenue), 0) as reported_room_revenue,
         coalesce(sum(refunds), 0) as reported_refunds,
         coalesce(sum(voids), 0) as reported_voids
  from params p
  join public.night_audits na
    on na.property_id = p.property_id
   and na.business_date between p.from_date and p.to_date
)
select rt.*,
       tt.allocated_tender,
       tt.cash_tender,
       tt.room_tender,
       fct.posted_room_charges,
       fct.pos_charges_to_room,
       pt.posted_payments,
       reft.refunds,
       reft.cash_refunds,
       nat.audit_rows,
       nat.reported_total_revenue,
       nat.reported_room_revenue,
       nat.reported_refunds,
       nat.reported_voids,
       fct.posted_room_charges - nat.reported_room_revenue as room_revenue_variance,
       tt.allocated_tender - rt.pos_gross as tender_allocation_variance
from receipt_totals rt
cross join tender_totals tt
cross join folio_charge_totals fct
cross join payment_totals pt
cross join refund_totals reft
cross join night_audit_totals nat;
```

Interpretation gate:

- Non-zero variance is evidence to investigate, not an authorization to change a definition.
- `allocated_tender` must not be compared to `pos_gross` without accounting for receipts with no split rows and legacy receipts that still use `payment_method` only.
- `pos_charges_to_room` may overlap with `room_tender`. Do not add both into one total until D32 is approved.
- Compare night-audit business dates and timestamps separately; current code mixes receipt `created_at`, adjustment `created_at`, and shift `closed_at`.

## 7. Deployment gate for future migrations

A Phase 4B–4E migration may be prepared only after all of the following are recorded:

1. Current ledger from `supabase_migrations.schema_migrations`, including generated versions from historical API applications.
2. Current function definitions, overloads, grants, and `SECURITY DEFINER` settings for section 5 chains.
3. Current policies and RLS status for section 6.4 tables.
4. A staging or production-equivalent catalog that matches the production inventory for the objects being changed.
5. A written classification for every affected repository migration: applied exactly, applied under another version, superseded, genuinely pending, obsolete, or incompatible.
6. A backup/schema-only snapshot and explicit rollback/forward-repair plan.
7. Owner approval of the relevant D31–D38 decision and the individual implementation slice.

No `supabase db push`, `supabase migration repair`, SQL Editor application, production deployment, tag, release, or merge is authorized by this baseline note.

## 8. Status

- Repository inventory: complete for Phase 4A static evidence.
- Live applied-state reconciliation: not performed.
- Staging verification: not performed.
- Forward corrections: none authored.
- Application code: unchanged.
- Next action: owner approval of D31–D38 and selection of one implementation slice, starting with 4B if approved.
