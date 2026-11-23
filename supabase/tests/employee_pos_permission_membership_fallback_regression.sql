-- Regression contract: active employee identity is a valid property-scoped
-- authorization path when the account has no property_users row.
do $$
declare
  v_def text := pg_get_functiondef('public.fn_employee_permission_codes(uuid,uuid)'::regprocedure);
begin
  if v_def not ilike '%s.user_id = auth.uid()%' then
    raise exception 'Permission resolver lacks authenticated employee user_id fallback';
  end if;
  if v_def not ilike '%s.property_id = p_property_id%' or v_def not ilike '%s.is_active = true%' then
    raise exception 'Employee fallback is not scoped to an active employee in the requested property';
  end if;
  if v_def not ilike '%public.current_staff_id(p_property_id)%' then
    raise exception 'Existing verified PIN-session resolution was not preserved';
  end if;
  if v_def not ilike '%p_staff_id is null%' then
    raise exception 'Non-member fallback must not allow callers to request another staff ID';
  end if;
  if v_def not ilike '%r.permission_codes%' or v_def not ilike '%c.workspace = any(v_assigned)%' then
    raise exception 'Role permission and assigned workspace restrictions were not preserved';
  end if;
  if v_def not ilike '%pos.close_shift%' then
    raise exception 'Cashier close-shift permission mapping is missing';
  end if;
end
$$;
