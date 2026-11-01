-- Atomic, property-scoped printer configuration save.
-- Replaces the UI's multi-request save sequence so a failed routing update
-- cannot leave printer settings half-saved.
create or replace function public.fn_save_property_printer_config(
  p_property_id uuid,
  p_config jsonb,
  p_assignment_types text[] default '{}'
) returns public.property_printers
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_config public.property_printers;
  v_saved public.property_printers;
  v_assignment text;
  v_allowed constant text[] := array[
    'food_orders','drinks_orders','void_food_orders','void_drinks_orders',
    'unsettled_bills','final_receipts','reports','shift_reports','refund_slips'
  ];
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_property_id is null or not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')
  ) then
    raise exception 'Not authorized to manage printers for this property.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_config) <> 'object' then
    raise exception 'Printer configuration must be an object.' using errcode = '22023';
  end if;
  if coalesce(p_config->>'name','') !~ '\S' then
    raise exception 'Printer name is required.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_assignment_types,'{}')) a
    where not (a = any(v_allowed))
  ) then
    raise exception 'One or more printer routing types are invalid.' using errcode = '22023';
  end if;

  v_config := jsonb_populate_record(null::public.property_printers, p_config);
  if v_config.connection_type = 'network_ip' and (
    coalesce(v_config.ip_address,'') = '' or v_config.port not in (9100,9101,9102)
  ) then
    raise exception 'A valid printer IP and TCP port (9100–9102) are required.' using errcode = '22023';
  end if;
  if v_config.connection_type = 'windows_printer' and coalesce(v_config.windows_printer_name,'') = '' then
    raise exception 'Select an installed Windows printer.' using errcode = '22023';
  end if;

  if nullif(p_config->>'id','') is null then
    insert into public.property_printers(
      property_id,name,type,connection_type,ip_address,port,windows_printer_name,
      agent_url,baud_rate,device_name,device_address,paper_width,is_online,
      is_default,last_status,last_error,last_tested_at,last_connected_at,open_drawer_after_sale
    ) values (
      p_property_id,btrim(v_config.name),v_config.type,v_config.connection_type,
      v_config.ip_address,coalesce(v_config.port,9100),v_config.windows_printer_name,
      coalesce(v_config.agent_url,'http://127.0.0.1:8631'),coalesce(v_config.baud_rate,9600),
      v_config.device_name,v_config.device_address,coalesce(v_config.paper_width,'80mm'),
      false,coalesce(v_config.is_default,false),'testing',null,null,null,
      coalesce(v_config.open_drawer_after_sale,false)
    ) returning * into v_saved;
  else
    update public.property_printers set
      name=btrim(v_config.name),type=v_config.type,connection_type=v_config.connection_type,
      ip_address=v_config.ip_address,port=coalesce(v_config.port,9100),
      windows_printer_name=v_config.windows_printer_name,
      agent_url=coalesce(v_config.agent_url,'http://127.0.0.1:8631'),
      baud_rate=coalesce(v_config.baud_rate,9600),device_name=v_config.device_name,
      device_address=v_config.device_address,paper_width=coalesce(v_config.paper_width,'80mm'),
      is_online=false,is_default=coalesce(v_config.is_default,false),
      last_status='testing',last_error=null,open_drawer_after_sale=coalesce(v_config.open_drawer_after_sale,false)
    where id=v_config.id and property_id=p_property_id
    returning * into v_saved;
    if v_saved.id is null then
      raise exception 'Printer not found in the selected property.' using errcode = '42501';
    end if;
  end if;

  delete from public.printer_assignments
  where printer_id=v_saved.id and property_id=p_property_id;
  foreach v_assignment in array coalesce(p_assignment_types,'{}') loop
    insert into public.printer_assignments(property_id,printer_id,assignment_type)
    values(p_property_id,v_saved.id,v_assignment);
  end loop;
  return v_saved;
end;
$function$;

revoke all on function public.fn_save_property_printer_config(uuid,jsonb,text[]) from public,anon;
grant execute on function public.fn_save_property_printer_config(uuid,jsonb,text[]) to authenticated;
notify pgrst,'reload schema';
