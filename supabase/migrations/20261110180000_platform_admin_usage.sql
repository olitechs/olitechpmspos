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

-- Safe platform-owner membership role management. Preserve at least one
-- owner membership per property and write immutable audit events.
create or replace function public.platform_set_property_member(
  p_property_id uuid,
  p_user_id uuid,
  p_role property_member_role
)
returns public.property_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.property_users;
  v_old_role property_member_role;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can manage property access.' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'A property role is required.' using errcode = '22023';
  end if;

  perform 1 from public.properties where id = p_property_id for update;
  if not found then
    raise exception 'Property not found.' using errcode = 'P0002';
  end if;

  select * into v_membership
  from public.property_users
  where property_id = p_property_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Property membership not found.' using errcode = 'P0002';
  end if;

  v_old_role := v_membership.role;
  if v_old_role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.property_users where property_id = p_property_id and role = 'owner') <= 1 then
    raise exception 'A property must retain at least one owner.' using errcode = '23514';
  end if;

  update public.property_users
  set role = p_role
  where id = v_membership.id
  returning * into v_membership;

  insert into public.audit_logs (actor_id, action, property_id, old_value, new_value)
  values (auth.uid(), 'platform_property_member_role_changed', p_property_id,
    jsonb_build_object('user_id', p_user_id, 'role', v_old_role),
    jsonb_build_object('user_id', p_user_id, 'role', p_role));

  return v_membership;
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
  v_membership public.property_users;
begin
  if not public.is_platform_owner() then
    raise exception 'Only a platform owner can manage property access.' using errcode = '42501';
  end if;

  perform 1 from public.properties where id = p_property_id for update;
  if not found then
    raise exception 'Property not found.' using errcode = 'P0002';
  end if;

  select * into v_membership
  from public.property_users
  where property_id = p_property_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Property membership not found.' using errcode = 'P0002';
  end if;

  if v_membership.role = 'owner'
     and (select count(*) from public.property_users where property_id = p_property_id and role = 'owner') <= 1 then
    raise exception 'The last property owner cannot be removed. Assign another owner first.' using errcode = '23514';
  end if;

  delete from public.property_users where id = v_membership.id;

  insert into public.audit_logs (actor_id, action, property_id, old_value, new_value)
  values (auth.uid(), 'platform_property_member_removed', p_property_id,
    jsonb_build_object('user_id', p_user_id, 'role', v_membership.role),
    jsonb_build_object('removed', true));

  return true;
end;
$$;

revoke all on function public.platform_set_property_member(uuid, uuid, property_member_role) from public, anon;
revoke all on function public.platform_remove_property_member(uuid, uuid) from public, anon;
grant execute on function public.platform_set_property_member(uuid, uuid, property_member_role) to authenticated;
grant execute on function public.platform_remove_property_member(uuid, uuid) to authenticated;


-- Property-scoped historical recovery search. These functions are intentionally
-- read-only: they never recreate a receipt, payment, charge, refund or booking.
-- SECURITY DEFINER is required because the normal back-office RLS checks also
-- enforce each property's subscribed modules. Every call is explicitly guarded
-- by the current authenticated platform-owner profile and a concrete property.
create or replace function public.admin_search_historical_receipts(
  p_property_id uuid,
  p_query text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50
) returns setof jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare v_query text := nullif(trim(p_query), '');
begin
  if auth.uid() is null or not public.is_platform_owner() then
    raise exception 'Only an authenticated platform owner can search historical receipts.' using errcode = '42501';
  end if;
  if p_property_id is null then raise exception 'Select a property before searching.' using errcode = '22023'; end if;
  if v_query is null and p_from is null and p_to is null then
    raise exception 'Enter a receipt number, guest, room or date range.' using errcode = '22023';
  end if;

  return query
  select to_jsonb(r) || jsonb_build_object(
    'property_currency', p.currency,
    'refunds', coalesce((
      select jsonb_agg(to_jsonb(cr) order by cr.created_at desc)
      from public.cashier_refunds cr
      where cr.property_id = r.property_id
        and (cr.receipt_id = r.id or cr.target_id = r.id)
    ), '[]'::jsonb)
  )
  from public.pos_receipts r
  join public.properties p on p.id = r.property_id
  where r.property_id = p_property_id
    and (p_from is null or r.created_at >= p_from)
    and (p_to is null or r.created_at < p_to)
    and (
      v_query is null
      or r.order_number ilike '%' || v_query || '%'
      or r.guest_name ilike '%' || v_query || '%'
      or r.room_number ilike '%' || v_query || '%'
      or r.table_number ilike '%' || v_query || '%'
      or r.id::text = v_query
    )
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

create or replace function public.admin_search_guest_folios(
  p_property_id uuid,
  p_query text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 50
) returns setof jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare v_query text := nullif(trim(p_query), '');
begin
  if auth.uid() is null or not public.is_platform_owner() then
    raise exception 'Only an authenticated platform owner can search guest folios.' using errcode = '42501';
  end if;
  if p_property_id is null then raise exception 'Select a property before searching.' using errcode = '22023'; end if;
  if v_query is null and p_from is null and p_to is null then
    raise exception 'Enter a guest name, phone, confirmation code, room or date range.' using errcode = '22023';
  end if;

  return query
  select to_jsonb(r) || jsonb_build_object(
    'room_number', rm.number,
    'property_currency', p.currency,
    'totals', coalesce((select to_jsonb(ft) from public.folio_totals ft where ft.reservation_id = r.id), '{}'::jsonb),
    'charges', coalesce((
      select jsonb_agg(to_jsonb(fc) order by fc.created_at, fc.id)
      from public.folio_charges fc
      where fc.property_id = r.property_id and fc.reservation_id = r.id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(pm) order by pm.created_at, pm.id)
      from public.payments pm
      where pm.property_id = r.property_id and pm.reservation_id = r.id
    ), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(to_jsonb(cr) order by cr.created_at desc)
      from public.cashier_refunds cr
      where cr.property_id = r.property_id and cr.reservation_id = r.id
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.created_at desc)
      from public.pos_receipts pr
      where pr.property_id = r.property_id and pr.reservation_id = r.id
    ), '[]'::jsonb)
  )
  from public.reservations r
  join public.properties p on p.id = r.property_id
  left join public.rooms rm on rm.id = r.room_id
  where r.property_id = p_property_id
    and (p_from is null or r.arrival >= p_from)
    and (p_to is null or r.arrival <= p_to)
    and (
      v_query is null
      or r.guest_name ilike '%' || v_query || '%'
      or r.phone ilike '%' || v_query || '%'
      or r.confirmation_code ilike '%' || v_query || '%'
      or rm.number ilike '%' || v_query || '%'
      or r.id::text = v_query
    )
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

revoke all on function public.admin_search_historical_receipts(uuid,text,timestamptz,timestamptz,integer) from public, anon;
revoke all on function public.admin_search_guest_folios(uuid,text,date,date,integer) from public, anon;
grant execute on function public.admin_search_historical_receipts(uuid,text,timestamptz,timestamptz,integer) to authenticated;
grant execute on function public.admin_search_guest_folios(uuid,text,date,date,integer) to authenticated;
