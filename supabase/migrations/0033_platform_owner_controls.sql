-- OliTechs PMS+POS — Platform Owner Controls
-- Adds a database-enforced platform-owner property creation workflow.
-- The browser never receives service-role access and cannot bypass is_platform_owner().

create or replace function public.platform_create_property(
  p_name text,
  p_business_name text default null,
  p_property_type text default null,
  p_address text default null,
  p_country text default null,
  p_city text default null,
  p_phone text default null,
  p_email text default null,
  p_website text default null,
  p_currency text default 'USD',
  p_timezone text default 'UTC',
  p_business_registration text default null,
  p_contact_person text default null,
  p_status public.property_status default 'active',
  p_package public.property_package default 'standard',
  p_owner_user_id uuid default null
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties;
  v_owner_id uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can create a property.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_name,'')), '') is null then
    raise exception 'Property name is required.';
  end if;

  if p_owner_user_id is not null then
    select id into v_owner_id
    from public.profiles
    where id = p_owner_user_id;

    if v_owner_id is null then
      raise exception 'The selected owner user does not exist.';
    end if;
  end if;

  insert into public.properties (
    name, business_name, property_type, address, country, city,
    phone, email, website, currency, timezone,
    business_registration, contact_person, status, package, created_by
  )
  values (
    trim(p_name),
    nullif(trim(p_business_name), ''),
    nullif(trim(p_property_type), ''),
    nullif(trim(p_address), ''),
    nullif(trim(p_country), ''),
    nullif(trim(p_city), ''),
    nullif(trim(p_phone), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_website), ''),
    coalesce(nullif(trim(p_currency), ''), 'USD'),
    coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    nullif(trim(p_business_registration), ''),
    nullif(trim(p_contact_person), ''),
    coalesce(p_status, 'active'),
    coalesce(p_package, 'standard'),
    auth.uid()
  )
  returning * into v_property;

  if v_owner_id is not null then
    insert into public.property_users (property_id, user_id, role)
    values (v_property.id, v_owner_id, 'owner')
    on conflict (property_id, user_id)
    do update set role = 'owner';
  end if;

  -- Keep the subscription record aligned when the subscription migration exists.
  insert into public.property_subscriptions (
    property_id, plan_code, status, enabled_modules, updated_by
  )
  values (
    v_property.id,
    case v_property.package
      when 'professional' then 'professional'
      when 'premium' then 'premium'
      when 'standard' then 'standard'
      else 'starter'
    end,
    case
      when v_property.status = 'active' then 'active'
      when v_property.status = 'suspended' then 'suspended'
      when v_property.status = 'rejected' then 'cancelled'
      else 'trial'
    end,
    '{}',
    auth.uid()
  )
  on conflict (property_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    updated_at = now(),
    updated_by = auth.uid();

  insert into public.audit_logs (
    actor_id, action, property_id, old_value, new_value
  )
  values (
    auth.uid(),
    'property_created_by_platform_owner',
    v_property.id,
    null,
    jsonb_build_object(
      'status', v_property.status,
      'package', v_property.package,
      'owner_user_id', v_owner_id
    )
  );

  return v_property;
end;
$$;

grant execute on function public.platform_create_property(
  text,text,text,text,text,text,text,text,text,text,text,text,text,
  public.property_status,public.property_package,uuid
) to authenticated;

revoke execute on function public.platform_create_property(
  text,text,text,text,text,text,text,text,text,text,text,text,text,
  public.property_status,public.property_package,uuid
) from anon, public;


create or replace function public.platform_find_user_by_email(p_email text)
returns table(id uuid, email text, full_name text)
language sql
security definer
set search_path = public
stable
as $
  select p.id, p.email, p.full_name
  from public.profiles p
  where public.is_platform_owner()
    and lower(p.email) = lower(trim(p_email))
  limit 1;
$;

grant execute on function public.platform_find_user_by_email(text) to authenticated;
revoke execute on function public.platform_find_user_by_email(text) from anon, public;

notify pgrst, 'reload schema';
