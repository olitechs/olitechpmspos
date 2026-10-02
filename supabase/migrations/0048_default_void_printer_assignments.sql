-- Default void routing follows existing food/drinks printer assignments.
insert into public.printer_assignments(property_id, printer_id, assignment_type)
select a.property_id, a.printer_id, 'void_food_orders'
from public.printer_assignments a
where a.assignment_type='food_orders'
on conflict (printer_id, assignment_type) do nothing;

insert into public.printer_assignments(property_id, printer_id, assignment_type)
select a.property_id, a.printer_id, 'void_drinks_orders'
from public.printer_assignments a
where a.assignment_type='drinks_orders'
on conflict (printer_id, assignment_type) do nothing;

notify pgrst, 'reload schema';
