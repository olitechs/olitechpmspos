-- Phase 1 multi-property isolation hardening.
--
-- SECURITY FIX:
-- The original property_users_insert policy allowed any authenticated user
-- to add themselves as an 'owner' of an arbitrary property_id:
--   OR (user_id = auth.uid() AND role = 'owner')
-- That path bypassed the trusted property-application creator and could grant
-- membership in another tenant if the caller knew its UUID.
--
-- Registration now creates the owner membership only through the trusted
-- SECURITY DEFINER routines in 0011_fix_property_registration_rls.sql
-- (create_pending_property_for_user / ensure_my_pending_property). Platform
-- administration and property managers use trusted RPCs. A browser session
-- must not self-assign property ownership directly.
--
-- Keep legitimate property membership management: platform owners and
-- existing owners/admins can add members only within properties they manage.

begin;

drop policy if exists property_users_insert on public.property_users;

create policy property_users_insert
  on public.property_users
  for insert
  with check (
    public.is_platform_owner()
    or public.property_role(property_id) in ('owner', 'admin')
  );

comment on policy property_users_insert on public.property_users is
  'Only platform owners or existing owners/admins may add property members. New owner memberships are created through trusted server-side registration routines; clients cannot self-claim ownership of arbitrary properties.';

commit;

-- Required disposable-database regression checks before production rollout:
-- 1. A signed-in user with no membership cannot INSERT a property_users row
--    assigning themselves role='owner' for another property's UUID.
-- 2. A member of Property A cannot add themselves or another user to Property B.
-- 3. A Property A owner/admin can still add an allowed member to Property A.
-- 4. Platform Admin can still create/assign property memberships through the
--    existing platform RPCs.
-- 5. Registration through ensure_my_pending_property still creates exactly
--    one pending/none property and owner membership for the new account.
