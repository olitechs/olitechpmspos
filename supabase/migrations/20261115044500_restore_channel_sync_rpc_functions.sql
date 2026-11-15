-- Restore the channel sync RPCs with property-bound authorization.
-- Service-role callers are reserved for trusted server-side webhook processing.

begin;

create or replace function public.fn_queue_channel_sync(
  p_property_id uuid,
  p_connection_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_idempotency_key text
)
returns public.channel_sync_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.channel_sync_queue;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;

  if p_connection_id is not null and not exists (
    select 1 from public.channel_connections c
    where c.id = p_connection_id and c.property_id = p_property_id
  ) then
    raise exception 'Channel connection does not belong to this property';
  end if;

  insert into public.channel_sync_queue(
    property_id, connection_id, event_type, payload, idempotency_key
  )
  values (
    p_property_id, p_connection_id, p_event_type,
    coalesce(p_payload, '{}'::jsonb), p_idempotency_key
  )
  on conflict (idempotency_key) do update
    set payload = excluded.payload,
        event_type = excluded.event_type,
        connection_id = excluded.connection_id
    where public.channel_sync_queue.status in ('queued','failed')
  returning * into v;

  return v;
end;
$$;

create or replace function public.fn_receive_channel_reservation(
  p_property_id uuid,
  p_connection_id uuid,
  p_external_reservation_id text,
  p_event_type text,
  p_payload jsonb
)
returns public.channel_reservation_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.channel_reservation_events;
  v_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if v_role <> 'service_role'
     and not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;

  if p_connection_id is not null and not exists (
    select 1 from public.channel_connections c
    where c.id = p_connection_id and c.property_id = p_property_id
  ) then
    raise exception 'Channel connection does not belong to this property';
  end if;

  insert into public.channel_reservation_events(
    property_id, connection_id, external_reservation_id, event_type, payload
  )
  values (
    p_property_id, p_connection_id, p_external_reservation_id,
    p_event_type, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (connection_id, external_reservation_id, event_type)
  do update set
    payload = excluded.payload,
    status = 'received',
    error_message = null,
    received_at = now()
  returning * into v;

  return v;
end;
$$;

revoke all on function public.fn_queue_channel_sync(uuid,uuid,text,jsonb,text) from public, anon;
revoke all on function public.fn_receive_channel_reservation(uuid,uuid,text,text,jsonb) from public, anon;
grant execute on function public.fn_queue_channel_sync(uuid,uuid,text,jsonb,text) to authenticated, service_role;
grant execute on function public.fn_receive_channel_reservation(uuid,uuid,text,text,jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
