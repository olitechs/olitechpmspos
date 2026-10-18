-- Phase 9: property-scoped feature overrides.
-- Overrides may only restrict the package matrix; they can never grant a feature
-- that the property's assigned package does not include.
create table if not exists public.property_feature_entitlements (
  property_id uuid not null references public.properties(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (property_id, feature_key),
  constraint property_feature_entitlements_key_format check (feature_key ~ '^[a-z][a-z0-9_]{1,63}$')
);

alter table public.property_feature_entitlements enable row level security;
revoke all on public.property_feature_entitlements from anon, authenticated;
grant select on public.property_feature_entitlements to authenticated;

drop policy if exists property_feature_entitlements_select_member on public.property_feature_entitlements;
create policy property_feature_entitlements_select_member
on public.property_feature_entitlements for select to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id));

create or replace function public.phase9_package_feature(p_package text, p_feature_key text)
returns boolean
language sql immutable security invoker set search_path = public
as $$
  select case p_feature_key
    when 'dashboard' then p_package in ('standard','premium','professional')
    when 'property_setup_basic' then p_package in ('standard','premium','professional')
    when 'rooms_basic' then p_package in ('standard','premium','professional')
    when 'room_types_basic' then p_package in ('standard','premium','professional')
    when 'guests' then p_package in ('standard','premium','professional')
    when 'reservations_basic' then p_package in ('standard','premium','professional')
    when 'check_in_out' then p_package in ('standard','premium','professional')
    when 'folio_basic' then p_package in ('standard','premium','professional')
    when 'payments_basic' then p_package in ('standard','premium','professional')
    when 'housekeeping_basic' then p_package in ('standard','premium','professional')
    when 'reports_basic' then p_package in ('standard','premium','professional')
    when 'pos_products_basic' then p_package in ('standard','premium','professional')
    when 'pos_categories' then p_package in ('standard','premium','professional')
    when 'pos_orders_basic' then p_package in ('standard','premium','professional')
    when 'pos_receipt_printing' then p_package in ('standard','premium','professional')
    when 'pos_payments_basic' then p_package in ('standard','premium','professional')
    when 'advanced_reports' then p_package in ('premium','professional')
    when 'revenue_analytics' then p_package in ('premium','professional')
    when 'inventory' then p_package in ('premium','professional')
    when 'multi_outlet_pos' then p_package in ('premium','professional')
    when 'advanced_housekeeping' then p_package in ('premium','professional')
    when 'maintenance' then p_package in ('premium','professional')
    when 'financial_reports' then p_package in ('premium','professional')
    when 'staff_management' then p_package in ('premium','professional')
    when 'advanced_user_permissions' then p_package = 'professional'
    when 'room_charges' then p_package in ('premium','professional')
    when 'kitchen_printers' then p_package in ('premium','professional')
    when 'cashier_shifts' then p_package in ('premium','professional')
    when 'audit_log_view' then p_package = 'professional'
    else false
  end;
$$;

create or replace function public.fn_get_property_feature_entitlements(p_property_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_package text;
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_base boolean;
  v_override boolean;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized to view this property''s entitlements' using errcode = '42501';
  end if;
  select package::text into v_package from public.properties where id = p_property_id;
  if v_package is null then raise exception 'Property not found'; end if;
  for v_key in select unnest(array[
    'dashboard','property_setup_basic','rooms_basic','room_types_basic','guests',
    'reservations_basic','check_in_out','folio_basic','payments_basic','housekeeping_basic','reports_basic',
    'pos_products_basic','pos_categories','pos_orders_basic','pos_receipt_printing','pos_payments_basic',
    'advanced_reports','revenue_analytics','inventory','multi_outlet_pos','advanced_housekeeping',
    'maintenance','financial_reports','staff_management','advanced_user_permissions','room_charges',
    'kitchen_printers','cashier_shifts','audit_log_view'
  ]) loop
    v_base := public.phase9_package_feature(v_package, v_key);
    select enabled into v_override from public.property_feature_entitlements
      where property_id = p_property_id and feature_key = v_key;
    v_result := v_result || jsonb_build_object(v_key, v_base and coalesce(v_override, true));
  end loop;
  return jsonb_build_object('property_id',p_property_id,'package',v_package,'features',v_result);
end;
$$;

create or replace function public.fn_set_property_feature_entitlement(
  p_property_id uuid, p_feature_key text, p_enabled boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_package text;
  v_base boolean;
  v_old boolean;
begin
  if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin')) then
    raise exception 'Only a platform owner or this property''s owner/admin can change feature entitlements' using errcode = '42501';
  end if;
  if p_feature_key is null or p_enabled is null then
    raise exception 'Feature key and enabled state are required' using errcode = '22023';
  end if;
  select package::text into v_package from public.properties where id = p_property_id for update;
  if v_package is null then raise exception 'Property not found'; end if;
  v_base := public.phase9_package_feature(v_package, p_feature_key);
  if not v_base and p_enabled then
    raise exception 'This feature is not included in the property''s assigned package' using errcode = '42501';
  end if;
  select enabled into v_old from public.property_feature_entitlements
    where property_id = p_property_id and feature_key = p_feature_key;
  insert into public.property_feature_entitlements(property_id,feature_key,enabled,updated_by,updated_at)
  values (p_property_id,p_feature_key,p_enabled,auth.uid(),now())
  on conflict (property_id,feature_key) do update
    set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
  insert into public.audit_logs(actor_id,action,property_id,old_value,new_value)
  values(auth.uid(),'property_feature_entitlement_updated',p_property_id,
    jsonb_build_object('feature',p_feature_key,'enabled',coalesce(v_old,v_base)),
    jsonb_build_object('feature',p_feature_key,'enabled',p_enabled));
  return public.fn_get_property_feature_entitlements(p_property_id);
end;
$$;

revoke all on function public.fn_get_property_feature_entitlements(uuid) from public, anon;
revoke all on function public.fn_set_property_feature_entitlement(uuid,text,boolean) from public, anon;
grant execute on function public.fn_get_property_feature_entitlements(uuid) to authenticated;
grant execute on function public.fn_set_property_feature_entitlement(uuid,text,boolean) to authenticated;
grant execute on function public.phase9_package_feature(text,text) to authenticated;

comment on table public.property_feature_entitlements is
  'Property-level feature restrictions. Effective entitlement is assigned-package matrix AND this optional override.';
notify pgrst, 'reload schema';
