-- Platform-owner usage visibility, aggregated per tenant.
-- Read-only metrics only; no operational or financial rows are modified.

create or replace function public.admin_property_usage()
returns table (
  property_id uuid,
  property_name text,
  property_status text,
  package_code text,
  member_count bigint,
  recently_verified_sessions bigint,
  receipts_last_24h bigint,
  reservations_last_24h bigint,
  failed_print_jobs_last_24h bigint,
  last_operational_activity_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can view property usage.' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.name,
    p.status::text,
    p.package::text,
    (select count(*) from public.property_users pu where pu.property_id = p.id),
    (select count(distinct ss.user_id)
       from public.staff_sessions ss
      where ss.property_id = p.id
        and ss.verified_at >= now() - interval '15 minutes'),
    (select count(*) from public.pos_receipts r
      where r.property_id = p.id
        and r.created_at >= now() - interval '24 hours'),
    (select count(*) from public.reservations b
      where b.property_id = p.id
        and b.created_at >= now() - interval '24 hours'),
    (select count(*) from public.fnb_print_jobs j
      where j.property_id = p.id
        and j.status in ('failed', 'error')
        and j.created_at >= now() - interval '24 hours'),
    greatest(
      (select max(r.created_at) from public.pos_receipts r where r.property_id = p.id),
      (select max(b.created_at) from public.reservations b where b.property_id = p.id),
      (select max(sl.created_at) from public.staff_logs sl where sl.property_id = p.id)
    )
  from public.properties p
  order by p.name;
end;
$$;

revoke all on function public.admin_property_usage() from public, anon;
grant execute on function public.admin_property_usage() to authenticated;

-- Platform-wide user directory with property membership summaries.
create or replace function public.admin_user_directory()
returns table (
  user_id uuid,
  email text,
  full_name text,
  platform_role text,
  created_at timestamptz,
  property_memberships jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can view the user directory.' using errcode = '42501';
  end if;

  return query
  select
    pr.id,
    pr.email,
    pr.full_name,
    pr.platform_role::text,
    pr.created_at,
    coalesce(
      jsonb_agg(jsonb_build_object(
        'property_id', p.id,
        'property_name', p.name,
        'property_status', p.status::text,
        'role', pu.role::text
      ) order by p.name) filter (where pu.id is not null),
      '[]'::jsonb
    )
  from public.profiles pr
  left join public.property_users pu on pu.user_id = pr.id
  left join public.properties p on p.id = pu.property_id
  group by pr.id, pr.email, pr.full_name, pr.platform_role, pr.created_at
  order by pr.created_at desc;
end;
$$;

revoke all on function public.admin_user_directory() from public, anon;
grant execute on function public.admin_user_directory() to authenticated;
