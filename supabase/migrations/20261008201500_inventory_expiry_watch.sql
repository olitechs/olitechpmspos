-- Restore the inventory expiry watch relation used by Inventory Operations.
create or replace view public.inventory_expiry_watch
with (security_invoker = true)
as
select
  p.id as product_id,
  p.property_id,
  p.sku,
  p.name,
  p.category,
  p.unit,
  p.current_stock,
  p.expiry_date,
  case
    when p.expiry_date < current_date then 'expired'
    when p.expiry_date <= current_date + 7 then 'expiring_soon'
    else 'ok'
  end as expiry_status,
  greatest(p.expiry_date - current_date, 0) as days_until_expiry
from public.products p
where p.expiry_date is not null;

grant select on public.inventory_expiry_watch to authenticated;
