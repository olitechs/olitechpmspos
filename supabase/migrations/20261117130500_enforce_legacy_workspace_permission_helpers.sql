-- Align legacy workspace and module helpers with employee permission codes.
insert into public.employee_permission_codes(code,workspace,label,sensitive,sort_order) values
 ('back_office.items.manage','backoffice','Manage catalogue items, categories, modifiers and discounts',true,45),
 ('pos.menu.manage','pos','Manage POS menu and pricing',true,18)
on conflict(code) do nothing;

create or replace function public.fn_staff_module_access(p_property_id uuid, p_module text)
returns boolean language plpgsql stable security definer set search_path = public
as $function$
declare v_module text := lower(trim(coalesce(p_module,''))); v_workspace text;
begin
  if not public.is_platform_owner() and not public.is_member_of_property(p_property_id) then return false; end if;
  if not exists (select 1 from public.properties p where p.id=p_property_id and p.status='active' and p.package<>'none') then return false; end if;
  if public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin') then return true; end if;
  v_workspace := case v_module when 'stores' then 'store' when 'store' then 'store' when 'back_office' then 'backoffice' else v_module end;
  return v_workspace = any(public.fn_employee_workspaces(p_property_id));
end;
$function$;

create or replace function public.can_store_read(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
 select public.fn_subscription_module_allowed(p_property_id,'store')
    and public.fn_employee_has_permission(p_property_id,'stores.inventory.view');
$function$;

create or replace function public.can_store_write(p_property_id uuid, p_category text default null)
returns boolean language plpgsql stable security definer set search_path = public
as $function$
declare v_code text;
begin
 if not public.fn_subscription_module_allowed(p_property_id,'store') then return false; end if;
 v_code := case lower(coalesce(p_category,''))
  when 'receive' then 'stores.stock.receive' when 'grn' then 'stores.stock.receive'
  when 'issue' then 'stores.stock.issue' when 'transfer' then 'stores.stock.transfer'
  when 'adjust' then 'stores.stock.adjust' when 'adjustment' then 'stores.stock.adjust'
  when 'purchasing' then 'stores.suppliers.manage' when 'supplier' then 'stores.suppliers.manage'
  else 'stores.stock.issue' end;
 return public.fn_employee_has_permission(p_property_id,v_code);
end;
$function$;

create or replace function public.can_manage_phase2_catalogue(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public
as $function$ select public.fn_employee_has_permission(p_property_id,'back_office.items.manage'); $function$;

create or replace function public.can_manage_pos_menu(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public
as $function$
 select public.fn_subscription_module_allowed(p_property_id,'pos')
   and public.fn_employee_has_permission(p_property_id,'pos.menu.manage');
$function$;

notify pgrst, 'reload schema';
