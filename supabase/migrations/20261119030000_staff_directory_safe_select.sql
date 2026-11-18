-- Expose the safe staff directory through a table-level SELECT grant.
-- The base staff table intentionally keeps column-level SELECT privileges so
-- pin_hash is never readable by authenticated clients.
grant select (role_id, department_id) on public.staff to authenticated;

create or replace view public.staff_directory
with (security_invoker = true)
as
select
  id,
  full_name,
  email,
  phone,
  role,
  assigned_modules,
  is_active,
  property_id,
  created_by,
  avatar,
  last_login,
  user_id,
  created_at,
  updated_at,
  department_id,
  role_id
from public.staff;

revoke all on public.staff_directory from public, anon;
grant select on public.staff_directory to authenticated;
