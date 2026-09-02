-- When a PIN staff session exists, it takes precedence over the underlying
-- account/property role. This prevents an owner account from retaining owner
-- permissions after switching the active POS staff identity to a waiter.
create or replace function public.can_store_read(p_property_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select case when public.current_staff_role(p_property_id) is not null then
    public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','front_office_manager','store_manager','fb_manager','housekeeping_supervisor')
  else
    public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','storekeeper')
  end;
$$;

create or replace function public.can_store_write(p_property_id uuid, p_category text default null)
returns boolean language sql security definer stable set search_path = public as $$
  select case when public.current_staff_role(p_property_id) is not null then
    public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','store_manager','housekeeping_supervisor')
    or (public.current_staff_role(p_property_id) = 'fb_manager' and coalesce(p_category,'F&B') = 'F&B')
  else
    public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','storekeeper')
  end;
$$;

create or replace function public.can_backoffice(p_property_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select case when public.current_staff_role(p_property_id) is not null then
    public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','front_office_manager','receptionist','front_desk','housekeeping_supervisor')
  else
    public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','reception','housekeeping')
  end;
$$;

create or replace function public.fn_adjust_product_stock(p_product_id uuid, p_change numeric, p_reason text)
returns public.products
language plpgsql security definer set search_path = public
as $$
declare v_product public.products; v_type text; v_qty numeric; v_role text;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if v_product.id is null then raise exception 'Product not found.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(v_product.property_id)) then raise exception 'Not allowed.'; end if;
  v_role := public.current_staff_role(v_product.property_id);
  if p_reason ilike 'POS Sale%' then
    if v_role is not null then
      if v_role not in ('hotel_admin','super_admin','pos_staff','waiter','cashier','fb_manager') then raise exception 'Only authorised POS staff can post POS stock deductions.'; end if;
    elsif not (public.is_platform_owner() or public.property_role(v_product.property_id) in ('owner','admin','manager','cashier')) then
      raise exception 'Only authorised POS staff can post POS stock deductions.';
    end if;
  elsif not public.can_store_write(v_product.property_id, v_product.category) then
    raise exception 'Only Store/Manager staff can make manual stock adjustments.';
  end if;
  if p_change = 0 then return v_product; end if;
  update public.products set current_stock = greatest(0,current_stock+p_change), updated_at=now() where id=p_product_id returning * into v_product;
  v_type := case when p_change > 0 then 'in' else 'out' end; v_qty := abs(p_change);
  insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id) values(v_product.property_id,p_product_id,v_type,v_qty,p_reason,auth.uid());
  if v_product.current_stock <= 0 then insert into public.low_stock_alerts(property_id,product_id,alert_type) values(v_product.property_id,p_product_id,'out_of_stock');
  elsif v_product.current_stock <= v_product.min_stock then insert into public.low_stock_alerts(property_id,product_id,alert_type) values(v_product.property_id,p_product_id,'low_stock'); end if;
  return v_product;
end;
$$;
grant execute on function public.fn_adjust_product_stock(uuid,numeric,text) to authenticated;
