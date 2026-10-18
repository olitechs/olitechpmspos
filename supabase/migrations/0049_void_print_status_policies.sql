-- Permit controlled void status/audit printer updates performed by the print workflow.
drop policy if exists pos_void_items_print_update on public.pos_void_items;
create policy pos_void_items_print_update on public.pos_void_items for update
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));

drop policy if exists pos_order_audit_update on public.pos_order_audit;
create policy pos_order_audit_update on public.pos_order_audit for update
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));

notify pgrst, 'reload schema';
