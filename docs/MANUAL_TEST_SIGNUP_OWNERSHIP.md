# Manual test script — signup & ownership hardening

Upgrade pack Task 2 acceptance: the four scenarios below must be exercised
against the live Supabase project (`mszogmazldxjsiytrlxr`). They cannot be
automated end-to-end without test credentials and a disposable project, so
this script documents the exact manual run. The static half is pinned by
`supabase/tests/signup_ownership_contract.test.mjs`.

The server rules under test (already applied to production,
migration `20261109065637_harden_property_signup_and_ownership.sql`):

- `property_users_insert` policy: platform owner, the property's existing
  `owner`/`admin`, or a constrained self-claim (`can_self_claim_owner`).
- `can_self_claim_owner`: only a property the caller created that has no
  owner yet.
- `trg_guard_property_status_package`: non-platform-owners cannot change a
  property's `status` or `package`.

## Scenario (a) — new owner signup gets a pending property

1. Sign out. Go to `/signup`, register with a **fresh email** and a business
   name.
2. Expected: either the pending-approval screen immediately (auto-confirm
   project) or the "confirm your email" notice, then pending-approval after
   confirmation.
3. Check (SQL editor or Platform Admin → Properties): a `properties` row with
   `status='pending'`, `package='none'`, `created_by=<new user>`, and a
   `property_users` row with `role='owner'` for the new user.

## Scenario (b) — cannot self-claim ownership of someone else's property

1. As the fresh user (or any non-owner member), run in the Supabase SQL
   editor **as that user's JWT** (Supabase dashboard → SQL editor with
   "run as authenticated role" is NOT sufficient — use the app's browser
   console: `supabase.from('property_users').insert({ property_id:
   '<other-property-uuid>', user_id: '<own-uuid>', role: 'owner' })`).
2. Expected: RLS error (new row violates `property_users_insert`), because
   `can_self_claim_owner` fails (`created_by` is someone else and an owner
   exists).

## Scenario (c) — cannot change property `status` or `package`

1. As a property owner, in the browser console run
   `supabase.from('properties').update({ status: 'active', package:
   'professional' }).eq('id', '<own-property-uuid>')`.
2. Expected: RLS/trigger error `Only a platform owner can change status or
   package.` The property stays `pending`/`none` until approved through
   Platform Admin.

## Scenario (d) — platform owner approval still works

1. Sign in on `/admin/login` as the platform owner.
2. Open the pending property → set package and approve (`approve_property`).
3. Expected: property `status='active'`, package assigned, subscription row
   provisioned, and the owner (on their account) now reaches the workspace
   picker with the packaged modules.

## Evidence recording

Paste the four results (or screenshots) into the task report. Any deviation
from these expectations must be reported before code changes are made.
