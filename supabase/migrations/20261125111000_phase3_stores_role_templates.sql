-- Storekeeper Phase 3 — role split and template reconciliation.
-- Forward-only only. Existing staff rows are not reassigned by this migration.

-- ---------------------------------------------------------------------------
-- 1. Single source for the approved legacy role permission bundles.
-- ---------------------------------------------------------------------------
create or replace function public.fn_phase3_stores_role_codes(p_role text)
returns text[]
language sql
immutable
set search_path = public
as $function$
  select case lower(coalesce(p_role, ''))
    when 'storekeeper' then array[
      'stores.access','stores.inventory.view','stores.stock.receive',
      'stores.stock.issue','stores.stock.transfer','stores.stock.adjust',
      'stores.suppliers.manage','stores.production.post','stores.stock.wastage.submit',
      'stores.requisition.view','stores.requisition.issue','stores.requisition.receive'
    ]::text[]
    when 'store_keeper' then array[
      'stores.access','stores.inventory.view','stores.stock.receive',
      'stores.stock.issue','stores.stock.transfer','stores.stock.adjust',
      'stores.suppliers.manage','stores.production.post','stores.stock.wastage.submit',
      'stores.requisition.view','stores.requisition.issue','stores.requisition.receive'
    ]::text[]
    when 'store_manager' then array[
      'stores.access','stores.inventory.view','stores.stock.receive',
      'stores.stock.issue','stores.stock.transfer','stores.stock.adjust',
      'stores.suppliers.manage','stores.production.post',
      'stores.requisition.create','stores.requisition.view',
      'stores.requisition.approve','stores.requisition.issue',
      'stores.requisition.receive','stores.issue.void','stores.costs.view',
      'stores.costcentre.manage','stores.inventory.valuation.view',
      'stores.stock.wastage.submit','stores.stock.wastage.approve'
    ]::text[]
    else '{}'::text[]
  end;
$function$;

revoke all on function public.fn_phase3_stores_role_codes(text) from public, anon;
grant execute on function public.fn_phase3_stores_role_codes(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reconcile built-in templates for every existing property.
-- ---------------------------------------------------------------------------
do $phase3$
declare
  v_property record;
  v_template record;
  v_before text[];
  v_exists boolean;
begin
  for v_property in select id from public.properties loop
    for v_template in
      select *
      from (values
        ('Storekeeper', 'store', public.fn_phase3_stores_role_codes('storekeeper'),
          'Issues and receives stock. Cannot approve requisitions, see costs or manage cost centres.'),
        ('Store Manager', 'store', public.fn_phase3_stores_role_codes('store_manager'),
          'Full Stores supervision, including approvals, costs and cost centres.'),
        ('Department Requester', 'store', array[
          'stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive'
        ]::text[], 'Requests stock for a department and confirms receipt.'),
        ('Accountant', 'backoffice', array[
          'back_office.access','back_office.reports.view','back_office.billing.manage',
          'stores.access','stores.inventory.view','stores.costs.view','stores.inventory.valuation.view'
        ]::text[], 'Financial reports, accounting and cost visibility.'),
        ('Auditor', 'backoffice', array[
          'back_office.access','back_office.reports.view',
          'stores.access','stores.inventory.view','stores.costs.view','stores.inventory.valuation.view'
        ]::text[], 'Read-only operational and cost reporting; no billing or stock writes.')
      ) as t(name, workspace, codes, description)
    loop
      select er.permission_codes into v_before
      from public.employee_roles er
      where er.property_id = v_property.id
        and er.name = v_template.name
        and er.is_system = true;
      v_exists := found;

      if not v_exists then
        insert into public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
        values (v_property.id, v_template.name, v_template.workspace, v_template.codes, v_template.description, true);

        insert into public.audit_logs(actor_id, action, property_id, new_value)
        values (null, 'phase3_role_template_seeded', v_property.id,
          jsonb_build_object('name', v_template.name, 'permission_codes', to_jsonb(v_template.codes)));
      elsif not (
        coalesce(v_before, '{}'::text[]) @> v_template.codes
        and v_template.codes @> coalesce(v_before, '{}'::text[])
      ) then
        update public.employee_roles
        set workspace = v_template.workspace,
            permission_codes = v_template.codes,
            description = v_template.description,
            is_system = true,
            updated_at = now()
        where property_id = v_property.id
          and name = v_template.name
          and is_system = true;

        insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
        values (null, 'phase3_role_template_reconciled', v_property.id,
          jsonb_build_object('name', v_template.name, 'permission_codes', to_jsonb(v_before)),
          jsonb_build_object('name', v_template.name, 'permission_codes', to_jsonb(v_template.codes)));
      end if;
    end loop;
  end loop;
end;
$phase3$;

-- ---------------------------------------------------------------------------
-- 3. Future property provisioning uses the same reconciled templates.
-- ---------------------------------------------------------------------------
create or replace function public.fn_seed_employee_roles(p_property_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  insert into public.employee_roles(property_id, name, workspace, permission_codes, description, is_system)
  values
    (p_property_id, 'Cashier', 'pos',
      array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']::text[],
      'POS cashier workspace', true),
    (p_property_id, 'Waiter', 'pos',
      array['pos.access','pos.open_shift','pos.process_sale']::text[],
      'Restaurant waiter workspace', true),
    (p_property_id, 'Storekeeper', 'store', public.fn_phase3_stores_role_codes('storekeeper'),
      'Issues and receives stock. Cannot approve requisitions, see costs or manage cost centres.', true),
    (p_property_id, 'Store Manager', 'store', public.fn_phase3_stores_role_codes('store_manager'),
      'Full Stores supervision, including approvals, costs and cost centres.', true),
    (p_property_id, 'Department Requester', 'store',
      array['stores.access','stores.requisition.create','stores.requisition.view','stores.requisition.receive']::text[],
      'Requests stock for a department and confirms receipt.', true),
    (p_property_id, 'Receptionist', 'frontoffice',
      array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment']::text[],
      'Front Office workspace', true),
    (p_property_id, 'Accountant', 'backoffice',
      array['back_office.access','back_office.reports.view','back_office.billing.manage','stores.access','stores.inventory.view','stores.costs.view','stores.inventory.valuation.view']::text[],
      'Financial reports, accounting and cost visibility.', true),
    (p_property_id, 'Auditor', 'backoffice',
      array['back_office.access','back_office.reports.view','stores.access','stores.inventory.view','stores.costs.view','stores.inventory.valuation.view']::text[],
      'Read-only operational and cost reporting; no billing or stock writes.', true),
    (p_property_id, 'Property Manager', 'backoffice',
      array['back_office.access','back_office.reports.view','back_office.employees.manage','back_office.settings.manage','pos.access','front_office.access','stores.access']::text[],
      'Assigned management modules', true)
  on conflict (property_id, name) do nothing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Legacy role resolver now uses the same approved bundles.
-- ---------------------------------------------------------------------------
create or replace function public.fn_employee_permission_codes(
  p_property_id uuid,
  p_staff_id uuid default null
)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_staff public.staff;
  v_codes text[] := '{}'::text[];
  v_role_codes text[] := '{}'::text[];
  v_grant_codes text[] := '{}'::text[];
  v_assigned text[] := '{}'::text[];
  v_current_staff_id uuid;
  v_has_property_access boolean := false;
begin
  if auth.uid() is null then
    return '{}'::text[];
  end if;

  v_current_staff_id := public.current_staff_id(p_property_id);
  v_has_property_access :=
    public.is_platform_owner()
    or public.is_member_of_property(p_property_id)
    or (
      p_staff_id is null
      and exists (
        select 1
        from public.staff s
        where s.property_id = p_property_id
          and s.is_active = true
          and (
            s.id = v_current_staff_id
            or (
              v_current_staff_id is null
              and s.user_id = auth.uid()
            )
          )
      )
    );

  if not v_has_property_access then
    return '{}'::text[];
  end if;

  if public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin') then
    return array(select code from public.employee_permission_codes order by sort_order);
  end if;

  select s.* into v_staff
  from public.staff s
  where s.property_id = p_property_id
    and s.is_active = true
    and (
      s.id = coalesce(p_staff_id, v_current_staff_id)
      or (
        p_staff_id is null
        and v_current_staff_id is null
        and s.user_id = auth.uid()
      )
    )
  limit 1;

  if v_staff.id is null then
    return '{}'::text[];
  end if;

  v_assigned := coalesce(v_staff.assigned_modules, '{}'::text[]);

  if v_staff.role_id is not null
     and lower(coalesce(v_staff.role, '')) not in ('super_admin', 'hotel_admin') then
    select coalesce(r.permission_codes, '{}'::text[]) into v_role_codes
    from public.employee_roles r
    where r.id = v_staff.role_id
      and r.property_id = p_property_id;
    if not found then v_role_codes := '{}'::text[]; end if;
  else
    v_role_codes := case lower(coalesce(v_staff.role, ''))
      when 'super_admin' then array(select code from public.employee_permission_codes)
      when 'hotel_admin' then array(select code from public.employee_permission_codes)
      when 'front_office_manager' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.checkout','front_office.folio.view','front_office.folio.post_charge','front_office.folio.payment']
      when 'receptionist' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','front_office.folio.payment','pos.access']
      when 'front_desk' then array['front_office.access','front_office.reservations.view','front_office.reservations.create','front_office.checkin','front_office.folio.view','pos.access']
      when 'pos_staff' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'waiter' then array['pos.access','pos.open_shift','pos.process_sale']
      when 'cashier' then array['pos.access','pos.open_shift','pos.close_shift','pos.process_sale','pos.apply_discount']
      when 'store_manager' then public.fn_phase3_stores_role_codes('store_manager')
      when 'storekeeper' then public.fn_phase3_stores_role_codes('storekeeper')
      when 'store_keeper' then public.fn_phase3_stores_role_codes('store_keeper')
      when 'fb_manager' then array['pos.access','pos.open_shift','pos.process_sale','pos.apply_discount','stores.access','stores.inventory.view']
      when 'housekeeping_supervisor' then array['front_office.access']
      else '{}'::text[]
    end;
  end if;

  select coalesce(array_agg(distinct c.code), '{}'::text[]) into v_codes
  from public.employee_permission_codes c
  where c.code = any(coalesce(v_role_codes, '{}'::text[]))
    and c.workspace = any(v_assigned);

  select coalesce(array_agg(distinct g.permission_code), '{}'::text[]) into v_grant_codes
  from public.module_access_grants g
  join public.employee_permission_codes c on c.code = g.permission_code
  where g.property_id = p_property_id
    and g.staff_id = v_staff.id
    and g.revoked_at is null
    and g.expires_at > now()
    and c.workspace = any(v_assigned);

  return (
    select coalesce(array_agg(distinct x.code), '{}'::text[])
    from unnest(coalesce(v_codes, '{}'::text[]) || coalesce(v_grant_codes, '{}'::text[])) as x(code)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Audited built-in template edits. Deletion of built-ins stays blocked.
-- ---------------------------------------------------------------------------
drop function if exists public.fn_update_employee_role(uuid, text, text, text[], text);

create or replace function public.fn_update_employee_role(
  p_role_id uuid,
  p_name text,
  p_workspace text,
  p_permission_codes text[],
  p_description text default null,
  p_confirm_system_edit boolean default false
)
returns public.employee_roles
language plpgsql
security definer
set search_path = public
as $function$
declare
  v public.employee_roles;
  v_old public.employee_roles;
  v_affected_staff integer := 0;
begin
  select * into v from public.employee_roles where id = p_role_id;
  if v.id is null then raise exception 'Role not found.'; end if;
  if not (public.is_platform_owner() or public.is_hotel_admin(v.property_id)) then
    raise exception 'Only property administrators can manage roles.' using errcode = '42501';
  end if;
  if v.is_system and coalesce(p_confirm_system_edit, false) is not true then
    raise exception 'Built-in role templates require explicit confirmation before editing.' using errcode = '42501';
  end if;
  if not public.fn_validate_permission_codes(p_permission_codes) then
    raise exception 'Unknown permission code in request.' using errcode = '22023';
  end if;

  select count(*) into v_affected_staff
  from public.staff s
  where s.property_id = v.property_id
    and s.is_active = true
    and (
      s.role_id = p_role_id
      or lower(coalesce(s.role, '')) = lower(v.name)
    );

  v_old := v;

  update public.employee_roles
    set name = btrim(p_name),
        workspace = p_workspace,
        permission_codes = coalesce(p_permission_codes, '{}'),
        description = p_description,
        updated_at = now()
  where id = p_role_id
  returning * into v;

  insert into public.audit_logs(actor_id, action, property_id, old_value, new_value)
  values (
    auth.uid(),
    case when v.is_system then 'employee_system_role_updated' else 'employee_role_updated' end,
    v.property_id,
    jsonb_build_object(
      'role_id', v_old.id,
      'name', v_old.name,
      'is_system', v_old.is_system,
      'permission_codes', to_jsonb(coalesce(v_old.permission_codes, '{}'::text[])),
      'affected_staff', v_affected_staff
    ),
    jsonb_build_object(
      'role_id', v.id,
      'name', v.name,
      'is_system', v.is_system,
      'permission_codes', to_jsonb(v.permission_codes),
      'affected_staff', v_affected_staff
    )
  );
  return v;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Property scope for role listing.
-- ---------------------------------------------------------------------------
create or replace function public.fn_list_employee_roles(p_property_id uuid)
returns setof public.employee_roles
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null
     or not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    return;
  end if;

  return query
    select er.*
    from public.employee_roles er
    where er.property_id = p_property_id
    order by er.is_system desc, er.name;
end;
$function$;

revoke all on function public.fn_employee_permission_codes(uuid,uuid) from public, anon;
revoke all on function public.fn_update_employee_role(uuid,text,text,text[],text,boolean) from public, anon;
revoke all on function public.fn_list_employee_roles(uuid) from public, anon;

grant execute on function public.fn_employee_permission_codes(uuid,uuid) to authenticated;
grant execute on function public.fn_update_employee_role(uuid,text,text,text[],text,boolean) to authenticated;
grant execute on function public.fn_list_employee_roles(uuid) to authenticated;

notify pgrst, 'reload schema';
