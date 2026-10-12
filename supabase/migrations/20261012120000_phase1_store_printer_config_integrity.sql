-- Phase 1: make store printer-group saves atomic and tenant-scoped.
-- Additive only; does not alter production data until the migration is applied.
create or replace function public.can_manage_store_printer_config(
  p_workspace_id uuid,
  p_store_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_platform_owner()
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.role in ('owner', 'admin')
    )
    or exists (
      select 1 from public.store_members sm
      where sm.store_id = p_store_id
        and sm.user_id = auth.uid()
        and lower(sm.role) in ('owner', 'admin', 'manager')
    );
$$;

create or replace function public.fn_save_store_printer_group(
  p_workspace_id uuid,
  p_store_id uuid,
  p_property_id uuid,
  p_group_id uuid default null,
  p_name text default null,
  p_category_ids uuid[] default '{}',
  p_printer_ids uuid[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_store public.stores%rowtype;
  v_categories uuid[] := coalesce(p_category_ids, '{}');
  v_printers uuid[] := coalesce(p_printer_ids, '{}');
begin
  if auth.uid() is null and not public.is_platform_owner() then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_store
  from public.stores s
  where s.id = p_store_id
    and s.workspace_id = p_workspace_id
    and s.property_id is not distinct from p_property_id;

  if not found then
    raise exception 'Store, workspace and property do not match.' using errcode = '22023';
  end if;

  if not public.can_manage_store_printer_config(p_workspace_id, p_store_id) then
    raise exception 'Not allowed to manage printer configuration for this store.' using errcode = '42501';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'Printer group name must contain 1 to 80 characters.' using errcode = '22023';
  end if;

  if cardinality(v_categories) <> (select count(distinct x) from unnest(v_categories) as t(x)) then
    raise exception 'Duplicate category IDs are not allowed.' using errcode = '22023';
  end if;
  if cardinality(v_printers) <> (select count(distinct x) from unnest(v_printers) as t(x)) then
    raise exception 'Duplicate printer IDs are not allowed.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_categories) as requested(id)
    where not exists (
      select 1 from public.pos_menu_categories c
      where c.id = requested.id
        and c.property_id is not distinct from p_property_id
    )
  ) then
    raise exception 'One or more categories do not belong to this property.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_printers) as requested(id)
    where not exists (
      select 1 from public.printers p
      where p.id = requested.id
        and p.store_id = p_store_id
        and p.workspace_id = p_workspace_id
    )
  ) then
    raise exception 'One or more printers do not belong to this store.' using errcode = '22023';
  end if;

  if p_group_id is null then
    insert into public.printer_groups(workspace_id, store_id, property_id, name)
    values (p_workspace_id, p_store_id, p_property_id, v_name)
    returning id into v_group_id;
  else
    update public.printer_groups
    set name = v_name
    where id = p_group_id
      and workspace_id = p_workspace_id
      and store_id = p_store_id
      and property_id is not distinct from p_property_id
    returning id into v_group_id;

    if v_group_id is null then
      raise exception 'Printer group was not found in the selected store.' using errcode = '22023';
    end if;
  end if;

  -- All link replacement is in this transaction: any constraint/error rolls back
  -- the group mutation and both link sets together.
  delete from public.printer_group_categories
  where printer_group_id = v_group_id;

  delete from public.printer_group_printers
  where printer_group_id = v_group_id;

  insert into public.printer_group_categories(printer_group_id, category_id, property_id)
  select v_group_id, requested.id, p_property_id
  from unnest(v_categories) as requested(id);

  insert into public.printer_group_printers(printer_group_id, printer_id)
  select v_group_id, requested.id
  from unnest(v_printers) as requested(id);

  return v_group_id;
end;
$$;

revoke all on function public.can_manage_store_printer_config(uuid, uuid) from public, anon;
grant execute on function public.can_manage_store_printer_config(uuid, uuid) to authenticated;

revoke all on function public.fn_save_store_printer_group(uuid, uuid, uuid, uuid, text, uuid[], uuid[]) from public, anon;
grant execute on function public.fn_save_store_printer_group(uuid, uuid, uuid, uuid, text, uuid[], uuid[]) to authenticated;

notify pgrst, 'reload schema';
