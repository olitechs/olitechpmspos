-- OliTechs PMS+POS — Platform Owner Property Management Layer
-- 0034: secure property editing, ownership, members, subscription controls,
-- module entitlements, and centralized audit logging.

create or replace function public.platform_update_property(
  p_property_id uuid,
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
  p_contact_person text default null
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can edit a property.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_name,'')), '') is null then
    raise exception 'Property name is required.';
  end if;

  update public.properties
  set
    name = trim(p_name),
    business_name = nullif(trim(coalesce(p_business_name,'')), ''),
    property_type = nullif(trim(coalesce(p_property_type,'')), ''),
    address = nullif(trim(coalesce(p_address,'')), ''),
    country = nullif(trim(coalesce(p_country,'')), ''),
    city = nullif(trim(coalesce(p_city,'')), ''),
    phone = nullif(trim(coalesce(p_phone,'')), ''),
    email = nullif(trim(coalesce(p_email,'')), ''),
    website = nullif(trim(coalesce(p_website,'')), ''),
    currency = coalesce(nullif(trim(p_currency), ''), 'USD'),
    timezone = coalesce(nullif(trim(p_timezone), ''), 'UTC'),
    business_registration = nullif(trim(coalesce(p_business_registration,'')), ''),
    contact_person = nullif(trim(coalesce(p_contact_person,'')), ''),
    updated_at = now()
  where id = p_property_id
  returning * into v_property;

  if not found then
    raise exception 'Property not found.';
  end if;

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (
    auth.uid(),
    'property_details_updated',
    p_property_id,
    jsonb_build_object(
      'name', v_property.name,
      'business_name', v_property.business_name,
      'property_type', v_property.property_type,
      'city', v_property.city,
      'country', v_property.country,
      'currency', v_property.currency,
      'timezone', v_property.timezone
    )
  );

  return v_property;
end;
$$;

create or replace function public.platform_set_property_status(
  p_property_id uuid,
  p_status public.property_status
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties;
  v_old_status public.property_status;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can change property status.' using errcode = '42501';
  end if;

  select status into v_old_status
  from public.properties
  where id = p_property_id
  for update;

  if v_old_status is null then
    raise exception 'Property not found.';
  end if;

  update public.properties
  set status = p_status, updated_at = now()
  where id = p_property_id
  returning * into v_property;

  update public.property_subscriptions
  set
    status = case
      when p_status = 'active' and v_property.package <> 'none' then 'active'
      when p_status = 'pending' then 'trial'
      when p_status in ('suspended','inactive','rejected') then 'suspended'
      else status
    end,
    updated_at = now(),
    updated_by = auth.uid()
  where property_id = p_property_id;

  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values (
    auth.uid(),
    'property_status_changed',
    p_property_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_status)
  );

  return v_property;
end;
$$;

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
    raise exception 'Only a platform owner can change property package.' using errcode = '42501';
  end if;

  select package into v_old_package
  from public.properties
  where id = p_property_id
  for update;

  if v_old_package is null then
    raise exception 'Property not found.';
  end if;

  update public.properties
  set package = p_package, updated_at = now()
  where id = p_property_id
  returning * into v_property;

  v_plan := case p_package
    when 'professional' then 'professional'
    when 'premium' then 'premium'
    when 'standard' then 'standard'
    else 'starter'
  end;

  insert into public.property_subscriptions(
    property_id, plan_code, status, enabled_modules, updated_by
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

  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values (
    auth.uid(),
    'property_package_changed',
    p_property_id,
    jsonb_build_object('package', v_old_package),
    jsonb_build_object('package', p_package)
  );

  return v_property;
end;
$$;

create or replace function public.platform_assign_property_owner(
  p_property_id uuid,
  p_owner_user_id uuid
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property public.properties;
  v_old_owner uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can assign a property owner.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_owner_user_id) then
    raise exception 'The selected owner user does not exist.';
  end if;

  select user_id into v_old_owner
  from public.property_users
  where property_id = p_property_id and role = 'owner'
  limit 1;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property not found.';
  end if;

  if exists (
    select 1
    from public.property_users
    where user_id = p_owner_user_id
      and role = 'owner'
      and property_id <> p_property_id
  ) then
    raise exception 'This user already owns another property.';
  end if;

  delete from public.property_users
  where property_id = p_property_id and role = 'owner';

  insert into public.property_users(property_id, user_id, role)
  values (p_property_id, p_owner_user_id, 'owner')
  on conflict(property_id, user_id)
  do update set role = 'owner';

  select * into v_property from public.properties where id = p_property_id;

  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values (
    auth.uid(),
    'property_owner_changed',
    p_property_id,
    jsonb_build_object('owner_user_id', v_old_owner),
    jsonb_build_object('owner_user_id', p_owner_user_id)
  );

  return v_property;
end;
$$;

create or replace function public.platform_list_property_members(p_property_id uuid)
returns table(
  membership_id uuid,
  user_id uuid,
  email text,
  full_name text,
  role public.property_member_role,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select pu.id, p.id, p.email, p.full_name, pu.role, pu.created_at
  from public.property_users pu
  join public.profiles p on p.id = pu.user_id
  where public.is_platform_owner()
    and pu.property_id = p_property_id
  order by
    case pu.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    coalesce(p.full_name, p.email);
$$;

create or replace function public.platform_set_property_member(
  p_property_id uuid,
  p_user_id uuid,
  p_role public.property_member_role
)
returns public.property_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.property_users;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can manage property members.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property not found.';
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'The selected user does not exist.';
  end if;

  if p_role = 'owner' and exists (
    select 1
    from public.property_users
    where user_id = p_user_id
      and role = 'owner'
      and property_id <> p_property_id
  ) then
    raise exception 'This user already owns another property.';
  end if;

  if p_role = 'owner' then
    delete from public.property_users
    where property_id = p_property_id and role = 'owner' and user_id <> p_user_id;
  end if;

  insert into public.property_users(property_id, user_id, role)
  values (p_property_id, p_user_id, p_role)
  on conflict(property_id, user_id)
  do update set role = excluded.role
  returning * into v_member;

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (
    auth.uid(),
    'property_member_role_changed',
    p_property_id,
    jsonb_build_object('user_id', p_user_id, 'role', p_role)
  );

  return v_member;
end;
$$;

create or replace function public.platform_remove_property_member(
  p_property_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.property_member_role;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can remove property members.' using errcode = '42501';
  end if;

  select role into v_role
  from public.property_users
  where property_id = p_property_id and user_id = p_user_id;

  if v_role is null then
    return false;
  end if;

  delete from public.property_users
  where property_id = p_property_id and user_id = p_user_id;

  insert into public.audit_logs(actor_id, action, property_id, old_value)
  values (
    auth.uid(),
    'property_member_removed',
    p_property_id,
    jsonb_build_object('user_id', p_user_id, 'role', v_role)
  );

  return true;
end;
$$;

create or replace function public.platform_update_subscription(
  p_property_id uuid,
  p_plan_code text,
  p_status text,
  p_trial_ends_at timestamptz default null,
  p_current_period_ends_at timestamptz default null,
  p_grace_ends_at timestamptz default null,
  p_enabled_modules text[] default '{}'
)
returns public.property_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.property_subscriptions;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can manage subscriptions.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Property not found.';
  end if;

  if p_status not in ('trial','active','past_due','suspended','cancelled') then
    raise exception 'Invalid subscription status.';
  end if;

  insert into public.property_subscriptions(
    property_id, plan_code, status, trial_ends_at,
    current_period_ends_at, grace_ends_at, enabled_modules, updated_by
  )
  values(
    p_property_id,
    coalesce(nullif(trim(p_plan_code), ''), 'starter'),
    p_status,
    p_trial_ends_at,
    p_current_period_ends_at,
    p_grace_ends_at,
    coalesce(p_enabled_modules, '{}'),
    auth.uid()
  )
  on conflict(property_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    trial_ends_at = excluded.trial_ends_at,
    current_period_ends_at = excluded.current_period_ends_at,
    grace_ends_at = excluded.grace_ends_at,
    enabled_modules = excluded.enabled_modules,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_subscription;

  insert into public.audit_logs(actor_id, action, property_id, new_value)
  values (
    auth.uid(),
    'property_subscription_updated',
    p_property_id,
    jsonb_build_object(
      'plan_code', v_subscription.plan_code,
      'status', v_subscription.status,
      'enabled_modules', v_subscription.enabled_modules
    )
  );

  return v_subscription;
end;
$$;

grant execute on function public.platform_update_property(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.platform_set_property_status(uuid,public.property_status) to authenticated;
grant execute on function public.platform_set_property_package(uuid,public.property_package) to authenticated;
grant execute on function public.platform_assign_property_owner(uuid,uuid) to authenticated;
grant execute on function public.platform_list_property_members(uuid) to authenticated;
grant execute on function public.platform_set_property_member(uuid,uuid,public.property_member_role) to authenticated;
grant execute on function public.platform_remove_property_member(uuid,uuid) to authenticated;
grant execute on function public.platform_update_subscription(uuid,text,text,timestamptz,timestamptz,timestamptz,text[]) to authenticated;

revoke execute on function public.platform_update_property(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text) from anon, public;
revoke execute on function public.platform_set_property_status(uuid,public.property_status) from anon, public;
revoke execute on function public.platform_set_property_package(uuid,public.property_package) from anon, public;
revoke execute on function public.platform_assign_property_owner(uuid,uuid) from anon, public;
revoke execute on function public.platform_list_property_members(uuid) from anon, public;
revoke execute on function public.platform_set_property_member(uuid,uuid,public.property_member_role) from anon, public;
revoke execute on function public.platform_remove_property_member(uuid,uuid) from anon, public;
revoke execute on function public.platform_update_subscription(uuid,text,text,timestamptz,timestamptz,timestamptz,text[]) from anon, public;


create or replace function public.approve_property(
  p_property_id uuid,
  p_package public.property_package
)
returns public.properties
language plpgsql
security definer
set search_path = public
as $
declare
  v_property public.properties;
  v_old_status public.property_status;
  v_old_package public.property_package;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can approve properties.' using errcode = '42501';
  end if;

  if p_package is null or p_package = 'none' then
    raise exception 'An active property must have a package.' using errcode = '22023';
  end if;

  select * into v_property from public.properties where id = p_property_id for update;
  if not found then raise exception 'Property not found.'; end if;

  v_old_status := v_property.status;
  v_old_package := v_property.package;

  update public.properties
  set status='active', package=p_package, updated_at=now()
  where id=p_property_id
  returning * into v_property;

  insert into public.property_subscriptions(
    property_id, plan_code, status, enabled_modules, updated_by
  )
  values(
    p_property_id,
    case p_package when 'professional' then 'professional' when 'premium' then 'premium' else 'standard' end,
    'active',
    '{}',
    auth.uid()
  )
  on conflict(property_id) do update set
    plan_code=excluded.plan_code,
    status='active',
    updated_at=now(),
    updated_by=auth.uid();

  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values(
    auth.uid(),'property_approved',p_property_id,
    jsonb_build_object('status',v_old_status,'package',v_old_package),
    jsonb_build_object('status','active','package',p_package)
  );

  return v_property;
end;
$;

grant execute on function public.approve_property(uuid,public.property_package) to authenticated;
revoke execute on function public.approve_property(uuid,public.property_package) from anon, public;

notify pgrst, 'reload schema';
