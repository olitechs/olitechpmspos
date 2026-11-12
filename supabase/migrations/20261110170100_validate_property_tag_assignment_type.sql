-- Ensure a tag can only be assigned to the matching entity type.
drop policy if exists property_tag_assignments_insert on public.property_tag_assignments;
create policy property_tag_assignments_insert on public.property_tag_assignments
for insert to authenticated
with check (
  (public.is_platform_owner()
    or public.property_role(property_id) in ('owner','admin','manager')
    or public.current_staff_role(property_id) in ('hotel_admin','super_admin','front_office_manager'))
  and exists (
    select 1 from public.property_tags tag
    where tag.id = property_tag_assignments.tag_id
      and tag.property_id = property_tag_assignments.property_id
      and tag.applies_to = property_tag_assignments.entity_type
  )
  and (
    (entity_type = 'guest' and exists (select 1 from public.guests entity where entity.id = property_tag_assignments.entity_id and entity.property_id = property_tag_assignments.property_id))
    or (entity_type = 'room' and exists (select 1 from public.rooms entity where entity.id = property_tag_assignments.entity_id and entity.property_id = property_tag_assignments.property_id))
    or (entity_type = 'reservation' and exists (select 1 from public.reservations entity where entity.id = property_tag_assignments.entity_id and entity.property_id = property_tag_assignments.property_id))
  )
);
