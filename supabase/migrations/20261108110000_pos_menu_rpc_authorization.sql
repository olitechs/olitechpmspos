-- Harden the POS menu read RPC to match the application's POS module access policy.
-- The previous SECURITY DEFINER function accepted any property member or any active
-- staff session, which was broader than the explicit POS-role/module check used by
-- fn_verify_pos_access_pin. Keep the existing result shape and product/property scope.

begin;

create or replace function public.fn_list_pos_menu(p_property_id uuid)
returns table(
  id uuid,
  sku text,
  name text,
  category text,
  unit text,
  current_stock numeric,
  min_stock numeric,
  selling_price numeric,
  production_center text,
  pos_sort integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_property_id is null then
    raise exception 'Property id is required.'
      using errcode = '22023';
  end if;

  -- Trusted backend calls may read the requested property's menu.
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Authentication required.'
        using errcode = '42501';
    end if;

    if not (
      public.is_platform_owner()
      or public.is_member_of_property(p_property_id)
    ) then
      raise exception 'Not authorized to access this property menu.'
        using errcode = '42501';
    end if;

    -- Match the POS module allow-list used by fn_verify_pos_access_pin.
    -- Do not treat any active staff session as POS authorization.
    if not (
      public.is_platform_owner()
      or coalesce(public.property_role(p_property_id) in ('owner', 'admin', 'manager', 'cashier', 'waiter'), false)
      or coalesce(public.current_staff_role(p_property_id) in (
        'hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff',
        'fb_manager', 'receptionist', 'front_desk'
      ), false)
      or exists (
        select 1
        from public.staff s
        where s.property_id = p_property_id
          and s.is_active = true
          and (
            s.user_id = auth.uid()
            or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          )
          and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
      )
    ) then
      raise exception 'POS module access required.'
        using errcode = '42501';
    end if;
  end if;

  return query
  select
    p.id,
    p.sku,
    p.name,
    coalesce(nullif(p.pos_category, ''), p.category),
    p.unit,
    p.current_stock,
    p.min_stock,
    p.selling_price,
    p.production_center,
    p.pos_sort
  from public.products p
  where p.property_id = p_property_id
    and p.pos_enabled is true
    and p.pos_active is true
  order by coalesce(nullif(p.pos_category, ''), p.category), p.pos_sort, p.name;
end;
$function$;

revoke all on function public.fn_list_pos_menu(uuid) from public, anon;
grant execute on function public.fn_list_pos_menu(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
