-- Regression contract for POS floor layout authenticated employee RLS.
do $$
declare
  v_read text;
  v_manage_using text;
  v_manage_check text;
begin
  select pg_get_expr(polqual, polrelid)
    into v_read
  from pg_policy
  where polrelid = 'public.pos_floor_layouts'::regclass
    and polname = 'pos_floor_layouts_member_read';

  select pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    into v_manage_using, v_manage_check
  from pg_policy
  where polrelid = 'public.pos_floor_layouts'::regclass
    and polname = 'pos_floor_layouts_authorized_manage';

  if v_read is null or v_manage_using is null or v_manage_check is null then
    raise exception 'POS floor layout RLS policies are missing';
  end if;

  if v_read not ilike '%staff%' or v_read not ilike '%auth.uid%' then
    raise exception 'Floor layout SELECT does not support authenticated staff user_id fallback';
  end if;

  if v_manage_using not ilike '%staff%' or v_manage_using not ilike '%auth.uid%'
     or v_manage_check not ilike '%staff%' or v_manage_check not ilike '%auth.uid%' then
    raise exception 'Floor layout INSERT/UPDATE policy lacks authenticated staff fallback in USING/WITH CHECK';
  end if;

  if v_manage_using not ilike '%current_staff_role%' or v_manage_check not ilike '%current_staff_role%' then
    raise exception 'Existing PIN-session authorization path was not preserved';
  end if;

  if v_manage_using not ilike '%is_member_of_property%' or v_manage_check not ilike '%is_member_of_property%' then
    raise exception 'Existing property membership boundary was not preserved';
  end if;

  if v_manage_using not ilike '%store_manager%' or v_manage_check not ilike '%store_manager%' then
    raise exception 'Existing manager role allowlist was not preserved';
  end if;
end
$$;
