-- Phase 1: prevent membership UPDATE from silently moving a user between tenants.
--
-- Membership reassignment must use the explicit, separately authorized
-- delete/create flow. This prevents an owner/admin with access to two properties
-- from changing property_users.property_id through an UPDATE that satisfies both
-- the old-row and new-row RLS predicates.
--
-- Platform owners retain the trusted administrative path. This migration does
-- not change production until explicitly applied through the normal release gate.

begin;

create or replace function public.guard_property_user_tenant_move()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
  if new.property_id is distinct from old.property_id
     and not public.is_platform_owner() then
    raise exception
      'Membership property cannot be changed directly; use the authorized membership reassignment flow.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_property_user_tenant_move on public.property_users;
create trigger guard_property_user_tenant_move
before update of property_id on public.property_users
for each row
execute function public.guard_property_user_tenant_move();

comment on function public.guard_property_user_tenant_move() is
  'Blocks non-platform membership updates from moving a membership row across property/tenant boundaries.';

commit;

-- Regression tests for a disposable Supabase project:
-- A. Property A admin who is not a member of B cannot move a membership to B.
-- B. Admins of both A and B still cannot move membership rows with UPDATE.
-- C. An authorized property admin can update permitted role fields within A.
-- D. Platform-owner membership administration remains functional.
-- E. Failed cross-tenant UPDATE leaves the original membership unchanged.
