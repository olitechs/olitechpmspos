-- POS product stock tracking.
--
-- The POS showed "OUT OF STOCK" for every product with zero stock, including
-- accommodation and service items that are not stocked at all. This adds an
-- explicit per-product flag and exposes it to the POS menu query. The default
-- is true, so every existing stock-controlled item keeps exactly the behaviour
-- it has today; only rows explicitly marked false (services, room types) lose
-- the stock chip.
--
-- No data is rewritten here. Marking accommodation/service products is a data
-- decision made in the menu manager or by an approved update.

alter table public.products
  add column if not exists track_stock boolean not null default true;

comment on column public.products.track_stock is
  'When false the product is not stock-controlled: the POS hides stock chips and never blocks the sale. Defaults to true so existing behaviour is preserved.';

-- The return type changes, so the function is replaced rather than altered.
drop function if exists public.fn_list_pos_menu(uuid);

create function public.fn_list_pos_menu(p_property_id uuid)
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
  pos_sort integer,
  tile_color text,
  tile_text_color text,
  tile_image_url text,
  track_stock boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_property_id is null then
    raise exception 'Property id is required.' using errcode = '22023';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Authentication required.' using errcode = '42501';
    end if;
    if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
      raise exception 'Not authorized to access this property menu.' using errcode = '42501';
    end if;
    if not (
      public.is_platform_owner()
      or coalesce(public.property_role(p_property_id) in ('owner', 'admin', 'manager', 'cashier', 'waiter'), false)
      or coalesce(public.current_staff_role(p_property_id) in (
        'hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff',
        'fb_manager', 'receptionist', 'front_desk'
      ), false)
      or exists (
        select 1 from public.staff s
        where s.property_id = p_property_id and s.is_active = true
          and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
          and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
      )
    ) then
      raise exception 'POS module access required.' using errcode = '42501';
    end if;
  end if;

  return query
  select p.id, p.sku, p.name, coalesce(nullif(p.pos_category, ''), p.category),
    p.unit, p.current_stock, p.min_stock, p.selling_price, p.production_center,
    p.pos_sort, p.tile_color, p.tile_text_color, p.tile_image_url, p.track_stock
  from public.products p
  where p.property_id = p_property_id and p.pos_enabled is true and p.pos_active is true
  order by coalesce(nullif(p.pos_category, ''), p.category), p.pos_sort, p.name;
end;
$function$;

revoke all on function public.fn_list_pos_menu(uuid) from public, anon;
grant execute on function public.fn_list_pos_menu(uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
