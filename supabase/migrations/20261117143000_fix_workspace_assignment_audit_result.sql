create or replace function public.fn_set_employee_modules(p_staff_id uuid, p_modules text[])
returns public.staff language plpgsql security definer set search_path=public
as $function$
declare v_staff public.staff; v_modules text[];
begin
  select * into v_staff from public.staff where id=p_staff_id for update;
  if v_staff.id is null then raise exception 'Employee not found.'; end if;
  if not (public.is_platform_owner() or public.property_role(v_staff.property_id) in ('owner','admin','manager')) then
    raise exception 'Only a property administrator can assign employee workspaces.';
  end if;
  if v_staff.user_id=auth.uid() then raise exception 'Employees cannot change their own workspace access.'; end if;
  select coalesce(array_agg(distinct lower(trim(x))), '{}'::text[]) into v_modules
  from unnest(coalesce(p_modules,'{}'::text[])) x
  where lower(trim(x)) in ('backoffice','frontoffice','pos','store');
  if coalesce(array_length(v_modules,1),0) <> coalesce(array_length(p_modules,1),0) then
    raise exception 'One or more workspace assignments are invalid.';
  end if;
  update public.staff set assigned_modules=v_modules, updated_at=now()
  where id=p_staff_id returning * into v_staff;
  delete from public.module_access_grants g using public.employee_permission_codes c
  where g.staff_id=p_staff_id and c.code=g.permission_code and not (c.workspace=any(v_modules));
  insert into public.employee_access_audit(property_id,staff_id,actor_user_id,action,module,result,details)
  values(v_staff.property_id,v_staff.id,auth.uid(),'workspace_assignment_updated',null,'granted',jsonb_build_object('assigned_modules',v_modules));
  return v_staff;
end;
$function$;
revoke all on function public.fn_set_employee_modules(uuid,text[]) from public, anon;
grant execute on function public.fn_set_employee_modules(uuid,text[]) to authenticated;
notify pgrst,'reload schema';
