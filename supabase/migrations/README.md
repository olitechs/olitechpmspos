# Running these migrations

1. Create a Supabase project (or use an existing one) at supabase.com.
2. Open **SQL Editor** in the Supabase dashboard.
3. Paste and run `0001_platform_admin.sql` (safe to re-run — every
   statement is idempotent).
4. In your Vite `.env` (see `.env.example`), set:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   ```
   Both values are in **Project Settings → API**. The anon key is safe to
   ship in frontend code — it has no power beyond what RLS allows.

## Creating the platform owner (sheddymae02@gmail.com)

The owner account must NOT be created by signing up through the normal
`/register` flow (that flow creates a pending property application, not
a platform owner). Instead:

1. In the Supabase dashboard, go to **Authentication → Users → Add user**.
2. Create a user with email `sheddymae02@gmail.com` and the password of
   your choice (set it directly in the dashboard — it never touches this
   codebase or Git).
3. This fires the `on_auth_user_created` trigger, which creates a matching
   row in `public.profiles` with `platform_role = 'user'` by default.
4. Back in **SQL Editor**, run this ONE statement to promote that specific
   row to owner (this cannot be done from the app or from any API call —
   only from here, which is the point):
   ```sql
   update public.profiles
   set platform_role = 'platform_owner'
   where email = 'sheddymae02@gmail.com';
   ```
5. Sign in at `/admin/login` with that email/password.

No plaintext password is ever stored in this repo, in seed files, or in
frontend code — it lives only in Supabase's own auth store (hashed) and
in your memory.

## Admin approval and package assignment

Run migrations `0005_admin_property_approval.sql`, `0006_admin_reporting.sql`, `0007_admin_dashboard.sql`, and `0008_registration_pending_application.sql` after `0004_claim_owner_property.sql`.

The admin **Properties** screen now uses a package-selection dialog instead of a browser prompt. A platform owner can select Standard, Premium, or Professional and approve the property in one action. Approval is performed by the `approve_property` database function, which atomically sets the property to `active`, assigns the selected package, and records an audit entry.

The reporting helpers in `0006_admin_reporting.sql` allow the platform owner console to safely display property owners, property members, audit actors, and the total profile count without weakening the existing profile RLS policy.


### Where to approve a pending property

After `0007_admin_dashboard.sql` is applied, sign in at `/admin/login` with the platform-owner account. The Admin Dashboard shows a **Pending Applications** section. Each pending property has **Review & Approve**.

1. Open **Review & Approve**.
2. Confirm the property/owner details.
3. Click **Approve & Assign Package**.
4. Choose **Standard**, **Premium**, or **Professional**.
5. Confirm the package.

The property changes from `pending` / `none` to `active` / the selected package and an audit entry is created. The owner then needs to refresh/reload their user dashboard; their PMS/POS access becomes available once the active status and package are visible to their session.

If the Pending Applications section is empty even though the owner sees **Pending Approval**, first verify that the admin account is actually marked `platform_owner` and that the admin app and owner app use the same Supabase project (`VITE_SUPABASE_URL`). The new dashboard RPC will also show an error instead of silently displaying zero when the required migration has not been applied.


## Registration → approval flow

Migration `0008_registration_pending_application.sql` moves pending-application creation to the server-side `auth.users` trigger. This means the property application is created during registration even when Supabase email confirmation is enabled. The owner is added as the property owner, the property starts as `pending` with package `none`, and the admin can see it immediately.

The normal flow is:

1. Owner registers with full name, property/business name, email, and password.
2. The server creates the profile, pending property application, and owner membership in the same signup transaction.
3. If email confirmation is enabled, the owner confirms the email and signs in; they see the existing pending application.
4. Platform owner opens **Admin → Dashboard → Pending Applications** or **Admin → Properties**.
5. Admin opens **Review & Approve**, selects Standard, Premium, or Professional, and confirms.
6. `approve_property` atomically changes the property to `active`, assigns the package, and records the audit entry.
7. The owner refreshes/signs in again and is admitted to the PMS/POS because the property is now active with a package.

Migration 0008 also backfills older accounts that have `pending_owner_signup` metadata but no owner property, so the previously reported case where the owner saw Pending Approval while the admin had zero properties is repaired when the migration runs.


### 0009 — registration application repair
Run after 0008. It repairs existing regular users who have an account but no owner property and adds the admin synchronization RPC used by the admin queue.


## Final registration/approval repair

Apply `0010_complete_registration_approval.sql` after the earlier migrations. It is intentionally idempotent and re-creates the required application, admin listing, dashboard, and approval functions, repairs existing normal users who have no owner property, reinstalls the auth signup trigger, and asks PostgREST to reload its schema cache.

After applying it, verify with:

```sql
select p.id, p.email, p.full_name, p.platform_role from public.profiles p order by p.created_at;
select id, name, business_name, status, package, email, created_by from public.properties order by created_at desc;
```

A newly registered owner must appear in `properties` as `pending` / `none` and have an `owner` row in `property_users`. A platform owner can then review it under Admin → Dashboard → Pending Applications and approve it with a package.


## 0011 — final property registration RLS fix
Run `0011_fix_property_registration_rls.sql` after `0010_complete_registration_approval.sql`. It moves pending-property creation into SECURITY DEFINER server-side routines so new registrations cannot fail with `new row violates row-level security policy for table properties`. It also repairs the auth trigger and admin synchronization routine.

### 0012 — Hotel operations foundation
Adds room types (e.g. Standard Garden View, Double Terrace, 2 Bedroom Apartment), rate-plan storage, richer room/reservation fields, housekeeping tasks, reservation date-overlap protection, and starter room types for active properties with no types.

## 0014 — Production Room Planner
Adds the production reservation model used by the Room Planner: payment status, channel, meal plan, kids ages, total/paid amounts, joint/group reservations, transactional create/edit/delete/move operations, and strict date-overlap validation. Run after 0013 and refresh the app. The planner uses `fn_create_reservation_bundle`, `fn_update_planner_reservation`, `fn_move_planner_reservation`, `fn_move_reservation_group`, `fn_add_room_to_reservation_group`, `fn_split_reservation_group`, and `fn_delete_planner_reservation`.


### 0033 — Persistent POS table sessions
Adds server-side active POS table sessions and in-progress order lines. Apply this migration before using the production POS on multiple terminals or relying on refresh recovery.

### 0034 — Live dashboard activity
Adds a property-scoped dashboard activity RPC using posted POS receipts and reservation events. It intentionally exposes only operational metadata.

### 0035 — Void-safe POS reporting
Updates the daily POS summary so voided receipts are excluded from revenue, transaction counts, payment breakdowns, top items, and hourly reporting.
### 0036 — Persistent kitchen display
Adds server-side fired kitchen/bar orders and KDS status transitions (`new` → `preparing` → `ready` → `served`). POS fires the order before attempting printer work, and the Kitchen Display can recover active orders after refresh or from another terminal. Apply this migration before using the production KDS.

### 0037 — Persistent printer configuration
Persists property-level printer definitions, routing purposes, centers, and connection settings. Live connection state is intentionally reset to `Not Configured` on reload because USB/Bluetooth/network connectivity is device-specific.


### 0040 — Phase 1 security hardening
Apply `0040_phase1_security_hardening.sql` after the existing migration set.

This migration is additive and does not rename prior migration files. It:
- prevents non-platform hotel admins from moving a membership to another property;
- validates that reservation rooms/guests belong to the reservation property;
- validates that folio charges/payments belong to the reservation property;
- rejects invalid reservation date ranges;
- adds a server-side reservation-overlap guard for direct authenticated writes.

The existing transactional reservation RPCs remain the preferred mutation path. The trigger is a second server-side integrity boundary.

After applying 0040, verify tenant isolation with two authenticated property users: each user must be unable to read or write another property's rooms, guests, reservations, folios, payments or membership rows.


## 0041 — Phase 2 Core PMS integrity
Adds database-authoritative reservation race protection, a server-side available-room endpoint, reservation-deposit reconciliation into the folio payment ledger, and RPC-only folio charge/payment writes.

## 0042 — Phase 2 Front Desk transactions
Hardens atomic reservation check-in/check-out and links folio payments to the active cashier shift when one exists. Payment totals also update the reservation payment status.


### 0043 — Phase 2C reservation workflow hardening
Strengthens `fn_update_planner_reservation` validation, keeps reservation room/date changes server-authoritative, validates channel/meal-plan/guest counts, and prevents `amount_paid` from diverging from the payment ledger once ledger payments exist. Run after 0042 and refresh the PostgREST schema.
