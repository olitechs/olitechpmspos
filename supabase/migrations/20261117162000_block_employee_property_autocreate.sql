-- Prevent invited/active employees from creating a separate property
-- through the authenticated registration safety-net RPC.
create or replace function public.ensure_my_pending_property(p_business_name text default null)
returns public.properties
language plpgsql
security definer
set search_path = public
set row_security = off
as $function$
declare
  v_property public.properties;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if public.is_platform_owner() then
    raise exception 'Platform owners do not have a self-service property.' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  -- Preserve the normal owner account path if this user already owns a property.
  select p.* into v_property
  from public.properties p
  join public.property_users pu on pu.property_id = p.id
  where pu.user_id = auth.uid() and pu.role = 'owner'
  order by p.created_at desc
  limit 1;
  if found then return v_property; end if;

  -- A pending invite or active/accepted staff identity means this account is
  -- being onboarded as an employee, not as a new property owner.
  if exists (
    select 1 from public.employee_invitations i
    where lower(i.email) = lower(v_profile.email)
      and (i.status = 'accepted' or (i.status = 'pending' and i.expires_at > now()))
  ) or exists (
    select 1 from public.staff s
    where (s.user_id = auth.uid() or lower(s.email) = lower(v_profile.email))
      and s.is_active = true
  ) then
    raise exception 'Employee accounts cannot create a new property. Accept the employee invitation or contact your property administrator.'
      using errcode = '42501';
  end if;

  return public.create_pending_property_for_user(
    auth.uid(), v_profile.email, v_profile.full_name, p_business_name
  );
end;
$function$;

revoke all on function public.ensure_my_pending_property(text) from public, anon;
grant execute on function public.ensure_my_pending_property(text) to authenticated;
