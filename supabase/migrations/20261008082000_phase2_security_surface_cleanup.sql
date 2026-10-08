revoke execute on function public.fn_phase2_property_guard() from public,anon,authenticated;
revoke execute on function public.can_manage_phase2_catalogue(uuid) from public,anon;
grant execute on function public.can_manage_phase2_catalogue(uuid) to authenticated,service_role;
create or replace function public.platform_package_modules(p_package public.property_package)
returns text[] language sql immutable set search_path=public as $$
  select case p_package
    when 'standard' then array['frontoffice','pos']::text[]
    when 'premium' then array['frontoffice','pos','backoffice','store']::text[]
    when 'professional' then array['frontoffice','pos','backoffice','store']::text[]
    else array[]::text[]
  end
$$;