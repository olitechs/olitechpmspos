-- OliTechs PMS+POS — Property package RPC schema-cache repair
-- 0039: ensure the platform package RPC exists with the exact signature
-- expected by the admin frontend and reload PostgREST's schema cache.

create or replace function public.platform_set_property_package(
  p_property_id uuid,
  p_package public.property_package
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties;
  v_old_package public.property_package;
  v_plan text;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can change property package.'
      using errcode = '42501';
  end if;

  select package
    into v_old_package
  from public.properties
  where id = p_property_id
  for update;

  if v_old_package is null then
    raise exception 'Property not found.';
  end if;

  update public.properties
  set
    package = p_package,
    updated_at = now()
  where id = p_property_id
  returning * into v_property;

  v_plan := case p_package
    when 'professional' then 'professional'
    when 'premium' then 'premium'
    when 'standard' then 'standard'
    else 'starter'
  end;

  insert into public.property_subscriptions(
    property_id,
    plan_code,
    status,
    enabled_modules,
    updated_by
  )
  values(
    p_property_id,
    v_plan,
    case
      when v_property.status = 'active' and p_package <> 'none' then 'active'
      when v_property.status = 'pending' then 'trial'
      else 'suspended'
    end,
    '{}',
    auth.uid()
  )
  on conflict(property_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    updated_at = now(),
    updated_by = auth.uid();

  insert into public.audit_logs(
    actor_id,
    action,
    property_id,
    old_value,
    new_value
  )
  values(
    auth.uid(),
    'property_package_changed',
    p_property_id,
    jsonb_build_object('package', v_old_package),
    jsonb_build_object('package', p_package)
  );

  return v_property;
end;
$$;

grant execute on function public.platform_set_property_package(
  uuid,
  public.property_package
) to authenticated;

revoke execute on function public.platform_set_property_package(
  uuid,
  public.property_package
) from anon, public;

notify pgrst, 'reload schema';
