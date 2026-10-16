-- Phase 1 multi-property isolation hardening.
--
-- SECURITY FIXES:
-- 1. The original property_users_insert policy allowed any authenticated
--    user to add themselves as an 'owner' of an arbitrary property_id.
-- 2. Existing property admins could assign the owner role through membership
--    INSERT/UPDATE, bypassing the platform-controlled owner assignment flow.
-- 3. Existing property admins could delete an owner's membership directly.
--
-- Registration creates the initial owner membership through the trusted
-- SECURITY DEFINER routines in 0011_fix_property_registration_rls.sql.
-- Platform administration uses trusted server-side routines. A browser
-- session must not self-claim ownership, promote members to owner, or remove
-- the owner membership directly.
--
-- Property owners/admins may manage non-owner memberships only within
-- properties where they already have an authorized role.

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

drop policy if exists property_users_update on public.property_users;

create policy property_users_update
  on public.property_users
  for update
  using (
    public.is_platform_owner()
    or (
      public.property_role(property_id) in ('owner', 'admin')
      and role <> 'owner'
    )
  )
  with check (
    public.is_platform_owner()
    or (
      public.property_role(property_id) in ('owner', 'admin')
      and role <> 'owner'
    )
  );

drop policy if exists property_users_delete on public.property_users;

create policy property_users_delete
  on public.property_users
  for delete
  using (
    public.is_platform_owner()
    or (
      public.property_role(property_id) in ('owner', 'admin')
      and role <> 'owner'
    )
  );

comment on policy property_users_insert on public.property_users is
  'Platform owners may assign property memberships. Existing property owners/admins may add non-owner members only to their own property. Initial owner memberships are created through trusted server-side registration routines.';

comment on policy property_users_update on public.property_users is
  'Platform owners may update any property membership. Existing property owners/admins may update non-owner memberships within their own property, but cannot edit, demote, or promote an owner membership.';

comment on policy property_users_delete on public.property_users is
  'Platform owners may remove any property membership. Existing property owners/admins may remove non-owner memberships within their own property, but cannot delete an owner membership.';

commit;

-- Regression scenarios to execute against a disposable Supabase project:
-- A. Unaffiliated authenticated user cannot insert themselves as owner of
--    another property's UUID.
-- B. Unaffiliated authenticated user cannot insert any membership into
--    another property's UUID.
-- C. Property A owner/admin cannot add a user to Property B.
-- D. Property A admin cannot create or promote a member to owner in A.
-- E. Property A admin cannot delete an owner membership in A.
-- F. Property A owner/admin can add, update, and remove permitted non-owner
--    members in A.
-- G. Platform owner can assign/change/remove owner membership through the
--    existing trusted admin flow.
-- H. Signup still creates exactly one pending/none property and owner
--    membership through the auth trigger / ensure_my_pending_property.
-- I. Existing memberships and property access remain intact after migration.
-- J. A property admin cannot update/demote an existing owner membership.
-- K. Membership updates cannot be used to change the member's effective
--    property access; verify old-row and new-row property authorization.
--
-- Do not apply to production until these checks pass and all property-scoped
-- table policies/RPCs have been reviewed for tenant isolation.
