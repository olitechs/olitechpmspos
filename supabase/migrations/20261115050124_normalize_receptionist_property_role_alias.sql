-- Normalize the staff-facing "receptionist" alias to the legacy
-- property-level "reception" role for authorization checks.
create or replace function public.property_role(p_property_id uuid)
returns public.property_member_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pu.role = 'receptionist'::public.property_member_role
      then 'reception'::public.property_member_role
    else pu.role
  end
  from public.property_users pu
  where pu.property_id = p_property_id
    and pu.user_id = auth.uid()
  limit 1;
$$;

notify pgrst, 'reload schema';
