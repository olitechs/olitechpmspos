-- Phase 1 multi-property isolation hardening.
--
-- SECURITY FIX:
-- The original property_users_insert policy allowed any authenticated user
-- to add themselves as an 'owner' of an arbitrary property_id:
--   OR (user_id = auth.uid() AND role = 'owner')
-- That path bypassed the trusted property-application creator and could grant
-- membership in another tenant if the caller knew its UUID.
--
-- Registration creates the initial owner membership through the trusted
-- SECURITY DEFINER routines in 0011_fix_property_registration_rls.sql.
-- Platform administration uses trusted server-side routines. A browser
-- session must not self-assign property ownership directly.
--
-- Existing property owners/admins may add ordinary property members only
-- within properties where they already have an authorized role. They cannot
-- create another owner membership; owner assignment remains a platform-level
-- operation through the existing trusted admin flow.

begin;

drop policy if exists property_users_insert on public.property_users;

create policy property_users_insert
  on public.property_users
  for insert
  with check (
    public.is_platform_owner()
    or (
      public.property_role(property_id) in ('owner', 'admin')
      and role <> 'owner'
    )
  );

comment on policy property_users_insert on public.property_users is
  'Platform owners may assign property memberships. Existing property owners/admins may add non-owner members only to their own property. Initial owner memberships are created through trusted server-side registration routines; clients cannot self-claim or assign property ownership directly.';

commit;

-- Regression scenarios to execute against a disposable Supabase project:
-- A. Unaffiliated authenticated user cannot insert themselves as owner of
--    another property's UUID.
-- B. Unaffiliated authenticated user cannot insert any membership into
--    another property's UUID.
-- C. Property A owner/admin cannot add a user to Property B.
-- D. Property A admin cannot create an owner membership for Property A.
-- E. Property A owner/admin can add permitted non-owner members to A.
-- F. Platform owner can assign an owner/member through the trusted admin flow.
-- G. Signup still creates exactly one pending/none property and owner
--    membership through the auth trigger / ensure_my_pending_property.
-- H. Existing memberships and property access remain intact after migration.
--
-- Do not apply to production until these checks pass and all property-scoped
-- table policies/RPCs have been reviewed for tenant isolation.
