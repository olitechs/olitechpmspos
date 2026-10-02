-- OliTechs PMS+POS — Platform property status + subscription visibility repair
-- 0040: repair deployments where 0034 was committed but the status RPC was
-- not present in PostgREST's live schema cache. Also expose subscription
-- summary fields in the platform property list so an assigned property has
-- an immediately visible subscription state.

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
    raise exception 'Only a platform owner can change property status.'
      using errcode = '42501';
  end if;

  select status into v_old_status
  from public.properties
  where id = p_property_id
  for update;

  if not found then
    raise exception 'Property not found.' using errcode = 'P0002';
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
  values(
    auth.uid(),
    'property_status_changed',
    p_property_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_status)
  );

  return v_property;
end;
$$;

grant execute on function public.platform_set_property_status(uuid, public.property_status) to authenticated;
revoke execute on function public.platform_set_property_status(uuid, public.property_status) from anon, public;

drop function if exists public.admin_list_properties();

create or replace function public.admin_list_properties()
returns table (
  id uuid,
  name text,
  business_name text,
  status public.property_status,
  package public.property_package,
  created_at timestamptz,
  owner_full_name text,
  owner_email text,
  subscription_plan_code text,
  subscription_status text,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.name,
    p.business_name,
    p.status,
    p.package,
    p.created_at,
    pr.full_name,
    pr.email,
    ps.plan_code,
    ps.status,
    ps.trial_ends_at,
    ps.current_period_ends_at,
    ps.grace_ends_at
  from public.properties p
  left join public.property_users pu
    on pu.property_id = p.id and pu.role = 'owner'
  left join public.profiles pr on pr.id = pu.user_id
  left join public.property_subscriptions ps on ps.property_id = p.id
  where public.is_platform_owner()
  order by p.created_at desc;
$$;

grant execute on function public.admin_list_properties() to authenticated;
revoke execute on function public.admin_list_properties() from anon, public;

notify pgrst, 'reload schema';
