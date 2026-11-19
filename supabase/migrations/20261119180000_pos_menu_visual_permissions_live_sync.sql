-- POS menu visual-only editing for Cashiers and Storekeepers.
-- Product names, pricing, stock and catalogue structure remain under existing
-- manager/store inventory workflows. This RPC can only change presentation data.

create or replace function public.can_edit_pos_menu_visuals(p_property_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_role text := lower(coalesce(public.current_staff_role(p_property_id), ''));
  v_property_role text := lower(coalesce(public.property_role(p_property_id)::text, ''));
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    return false;
  end if;
  if not public.fn_subscription_module_allowed(p_property_id, 'pos') then
    return false;
  end if;

  -- Built-in cashier: POS access only; never inherit catalogue/stock editing.
  if v_role = 'cashier' or v_property_role = 'cashier' then
    return public.fn_employee_has_permission(p_property_id, 'pos.access')
      or v_property_role = 'cashier';
  end if;

  -- Storekeeper is internally represented by store_manager. Require the Store
  -- workspace permission as well as the POS edition entitlement.
  if v_role in ('store_manager', 'storekeeper') then
    return public.fn_employee_has_permission(p_property_id, 'stores.inventory.view');
  end if;

  -- Existing full menu managers retain their current visual-editing ability.
  return public.can_manage_pos_menu(p_property_id);
end;
$function$;

create or replace function public.fn_update_pos_menu_item_visuals(
  p_property_id uuid,
  p_product_id uuid,
  p_tile_color text default null,
  p_tile_text_color text default null,
  p_tile_image_url text default null
) returns public.products
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_product public.products;
begin
  if not public.can_edit_pos_menu_visuals(p_property_id) then
    raise exception 'You do not have permission to edit POS menu appearance.';
  end if;
  if p_product_id is null then
    raise exception 'Product id is required.';
  end if;
  if p_tile_color is not null and p_tile_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Tile colour must be a six-digit hex colour.';
  end if;
  if p_tile_text_color is not null and p_tile_text_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Text colour must be a six-digit hex colour.';
  end if;
  if p_tile_image_url is not null and length(p_tile_image_url) > 2048 then
    raise exception 'Product photo URL is too long.';
  end if;

  update public.products
  set tile_color = p_tile_color,
      tile_text_color = p_tile_text_color,
      tile_image_url = p_tile_image_url,
      updated_at = now()
  where id = p_product_id
    and property_id = p_property_id
    and pos_enabled = true
  returning * into v_product;

  if v_product.id is null then
    raise exception 'POS product not found for this property.';
  end if;
  return v_product;
end;
$function$;

revoke all on function public.can_edit_pos_menu_visuals(uuid) from public, anon;
grant execute on function public.can_edit_pos_menu_visuals(uuid) to authenticated;
revoke all on function public.fn_update_pos_menu_item_visuals(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.fn_update_pos_menu_item_visuals(uuid,uuid,text,text,text) to authenticated;

-- Allow Storekeepers and Cashiers with visual-edit permission to upload product
-- photos into the existing property-scoped bucket. The path begins with the
-- property UUID: <property_id>/products/<unique-file>.
drop policy if exists pos_menu_visuals_upload on storage.objects;
create policy pos_menu_visuals_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'property-logos'
  and array_length(storage.foldername(name), 1) >= 2
  and public.can_edit_pos_menu_visuals((storage.foldername(name))[1]::uuid)
);

-- Cross-terminal POS screens refresh as soon as a menu visual changes.
do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
    ) then
      alter publication supabase_realtime add table public.products;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_menu_categories'
    ) then
      alter publication supabase_realtime add table public.pos_menu_categories;
    end if;
  end if;
end;
$publication$;

notify pgrst, 'reload schema';
