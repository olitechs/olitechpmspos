-- Cover all foreign keys introduced by the guest service request tables.
create index if not exists guest_service_requests_property_reservation_idx on public.guest_service_requests(property_id,reservation_id);
create index if not exists guest_service_requests_property_room_idx on public.guest_service_requests(property_id,room_id);
create index if not exists guest_service_requests_assigned_to_idx on public.guest_service_requests(assigned_to);
create index if not exists guest_service_requests_created_by_idx on public.guest_service_requests(created_by);
create index if not exists guest_service_request_events_property_id_idx on public.guest_service_request_events(property_id);
create index if not exists guest_service_request_events_actor_id_idx on public.guest_service_request_events(actor_id);
