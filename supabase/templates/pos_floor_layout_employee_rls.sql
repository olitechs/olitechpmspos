-- Repair POS floor layout RLS for authenticated staff accounts without an active PIN session.
-- Preserve property membership, active staff validation, platform-owner access,
-- and the existing manager-only floor configuration role boundary.

drop policy if exists pos_floor_layouts_member_read on public.pos_floor_layouts;
create policy pos_floor_layouts_member_read
  on public.pos_floor_layouts
  for select
  to authenticated
  using (
    public.is_platform_owner()
    or public.is_member_of_property(property_id)
    or public.current_staff_role(property_id) is not null
    or exists (
      select 1
      from public.staff s
      where s.property_id = pos_floor_layouts.property_id
        and s.user_id = auth.uid()
        and s.is_active = true
    )
  );

drop policy if exists pos_floor_layouts_authorized_manage on public.pos_floor_layouts;
create policy pos_floor_layouts_authorized_manage
  on public.pos_floor_layouts
  for all
  to authenticated
  using (
    public.is_platform_owner()
    or (
      (
        public.is_member_of_property(property_id)
        or public.current_staff_role(property_id) is not null
        or exists (
          select 1
          from public.staff s
          where s.property_id = pos_floor_layouts.property_id
            and s.user_id = auth.uid()
            and s.is_active = true
        )
      )
      and (
        public.property_role(property_id) in ('owner', 'admin', 'manager')
        or public.current_staff_role(property_id) in (
          'owner', 'admin', 'manager', 'store_manager',
          'front_office_manager', 'super_admin'
        )
        or exists (
          select 1
          from public.staff s
          where s.property_id = pos_floor_layouts.property_id
            and s.user_id = auth.uid()
            and s.is_active = true
            and s.role in (
              'owner', 'admin', 'manager', 'store_manager',
              'front_office_manager', 'super_admin'
            )
        )
      )
    )
  )
  with check (
    public.is_platform_owner()
    or (
      (
        public.is_member_of_property(property_id)
        or public.current_staff_role(property_id) is not null
        or exists (
          select 1
          from public.staff s
          where s.property_id = pos_floor_layouts.property_id
            and s.user_id = auth.uid()
            and s.is_active = true
        )
      )
      and (
        public.property_role(property_id) in ('owner', 'admin', 'manager')
        or public.current_staff_role(property_id) in (
          'owner', 'admin', 'manager', 'store_manager',
          'front_office_manager', 'super_admin'
        )
        or exists (
          select 1
          from public.staff s
          where s.property_id = pos_floor_layouts.property_id
            and s.user_id = auth.uid()
            and s.is_active = true
            and s.role in (
              'owner', 'admin', 'manager', 'store_manager',
              'front_office_manager', 'super_admin'
            )
        )
      )
    )
  );
