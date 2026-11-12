-- Department routing for production printers.
--
-- POS orders were split into exactly two destinations: food and drinks. This
-- adds an explicit department to each property printer so any production
-- centre (Grill, Pastry, Dessert, Housekeeping, ...) can print its own ticket.
--
-- The column is additive and nullable. Routing falls back to the existing
-- food_orders/drinks_orders assignments while an installation has no
-- departments set, so applying this migration does not change behaviour by
-- itself. Backfilling from the printer type gives today's kitchen/bar printers
-- a sensible department immediately.

alter table public.property_printers
  add column if not exists department text;

comment on column public.property_printers.department is
  'Production centre this printer serves (matched against pos_menu_categories.production_center or a printer group). NULL falls back to the food_orders/drinks_orders assignment.';

update public.property_printers
set department = case type
  when 'kitchen' then 'Kitchen'
  when 'bar' then 'Bar'
  else null
end
where department is null
  and type in ('kitchen', 'bar');

create index if not exists property_printers_department_idx
  on public.property_printers(property_id, lower(department));

notify pgrst, 'reload schema';
