CREATE OR REPLACE FUNCTION public.charge_restaurant_to_room(p_property_id uuid, p_reservation_id uuid, p_description text, p_amount numeric)
 RETURNS folio_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_charge public.folio_charges;
        v_role text;
        v_res_property uuid;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
  if not public.fn_employee_has_permission(p_property_id,'front_office.folio.post_charge') then
    raise exception 'Missing employee permission: front_office.folio.post_charge';
  end if;
  select property_id into v_res_property from public.reservations where id = p_reservation_id;
  if v_res_property is null or v_res_property <> p_property_id then raise exception 'Reservation not found.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  v_role := public.current_staff_role(p_property_id);
  if v_role is not null then
    if v_role not in ('hotel_admin','super_admin','cashier') then
      raise exception 'Only an authorised cashier can charge a restaurant bill to a room.';
    end if;
  elsif not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only an authorised cashier or manager can charge a restaurant bill to a room.';
  end if;
  if p_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  insert into public.folio_charges(property_id,reservation_id,source,description,amount)
    values(p_property_id,p_reservation_id,'pos',p_description,p_amount) returning * into v_charge;
  return v_charge;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_apply_folio_discount(p_property_id uuid, p_reservation_id uuid, p_amount numeric, p_reason text, p_idempotency_key text)
 RETURNS folio_charges
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.reservations; c public.folio_charges; manager boolean; key text; charges numeric; paid numeric;
begin
  if not public.fn_employee_has_permission(p_property_id,'front_office.folio.post_charge') then
    raise exception 'Missing employee permission: front_office.folio.post_charge';
  end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 manager:=coalesce(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager'),false);
 if not manager then raise exception 'Manager approval is required to apply a folio discount.'; end if;
 key:=nullif(trim(p_idempotency_key),''); if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-discount:'||key,0));
 select * into c from public.folio_charges where property_id=p_property_id and idempotency_key=key;
 if c.id is not null then
   if c.reservation_id<>p_reservation_id or c.amount<>-round(p_amount,2) or c.description<>'Authorised discount: '||trim(p_reason) then raise exception 'Idempotency key was already used for a different discount.'; end if;
   return c;
 end if;
 if p_amount<=0 or nullif(trim(p_reason),'') is null then raise exception 'Discount amount and reason are required.'; end if;
 select * into r from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if r.id is null or r.status in ('cancelled','checked-out') then raise exception 'An active reservation is required.'; end if;
 select coalesce(sum(amount),0) into charges from public.folio_charges where reservation_id=r.id;
 select coalesce(sum(amount),0) into paid from public.payments where reservation_id=r.id and status='posted';
 if p_amount>greatest(0,charges-paid)+0.005 then raise exception 'Discount exceeds the unpaid folio balance.'; end if;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount,category,quantity,unit_price,reference,source_module,created_by,idempotency_key)
 values(p_property_id,r.id,'adjustment','Authorised discount: '||trim(p_reason),-round(p_amount,2),'discount',1,-round(p_amount,2),
 'DISC-'||upper(substr(gen_random_uuid()::text,1,8)),'folio',auth.uid(),key) returning * into c;
 insert into public.audit_logs(actor_id,property_id,action,new_value,entity_type,entity_id,related_reservation_id)
 values(auth.uid(),p_property_id,'folio_discount_applied',jsonb_build_object('charge_id',c.id,'amount',p_amount,'reason',trim(p_reason)),'folio_charge',c.id,r.id);
 return c;
end; $function$
;

CREATE OR REPLACE FUNCTION public.fn_create_kitchen_order(p_property_id uuid, p_table_key text, p_table_number text, p_order_number text, p_waiter text, p_order_lines jsonb, p_print_jobs jsonb)
 RETURNS pos_kitchen_orders
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row public.pos_kitchen_orders;
  v_role text;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  v_role := coalesce(public.current_staff_role(p_property_id), public.property_role(p_property_id), '');
  if lower(v_role) not in ('owner','admin','manager','cashier','waiter','pos_staff','fb_manager','hotel_admin','super_admin','general_manager','front_office_manager','property_manager') then
    raise exception 'POS staff role is not authorized to fire kitchen orders.';
  end if;
  insert into public.pos_kitchen_orders(property_id,table_key,table_number,order_number,waiter,order_lines,status,print_jobs,fired_at,updated_at)
  values(p_property_id,nullif(trim(p_table_key),''),coalesce(nullif(trim(p_table_number),''),''),coalesce(nullif(trim(p_order_number),''),''),nullif(trim(p_waiter),''),coalesce(p_order_lines,'[]'::jsonb),'new',coalesce(p_print_jobs,'{}'::jsonb),now(),now())
  on conflict(property_id,order_number) do update set table_key=excluded.table_key,table_number=excluded.table_number,waiter=excluded.waiter,order_lines=excluded.order_lines,print_jobs=excluded.print_jobs,updated_at=now()
  returning * into v_row;
  insert into public.pos_kitchen_order_events(property_id,kitchen_order_id,event_type,to_status,actor_user_id)
  values(p_property_id,v_row.id,'fired',v_row.status,auth.uid());
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_delete_pos_printer(p_property_id uuid, p_client_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.fn_employee_has_permission(p_property_id,'back_office.settings.manage') then
    raise exception 'Missing employee permission: back_office.settings.manage';
  end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')
  ) then
    raise exception 'Not allowed.';
  end if;

  delete from public.pos_printers
   where property_id = p_property_id
     and client_key = p_client_key;

  return found;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_list_pos_menu(p_property_id uuid)
 RETURNS TABLE(id uuid, sku text, name text, category text, unit text, current_stock numeric, min_stock numeric, selling_price numeric, production_center text, pos_sort integer, tile_color text, tile_text_color text, tile_image_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.access') then
    raise exception 'Missing employee permission: pos.access';
  end if;
  if p_property_id is null then
    raise exception 'Property id is required.' using errcode = '22023';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Authentication required.' using errcode = '42501';
    end if;
    if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
      raise exception 'Not authorized to access this property menu.' using errcode = '42501';
    end if;
    if not (
      public.is_platform_owner()
      or coalesce(public.property_role(p_property_id) in ('owner', 'admin', 'manager', 'cashier', 'waiter'), false)
      or coalesce(public.current_staff_role(p_property_id) in (
        'hotel_admin', 'super_admin', 'cashier', 'waiter', 'pos_staff',
        'fb_manager', 'receptionist', 'front_desk'
      ), false)
      or exists (
        select 1 from public.staff s
        where s.property_id = p_property_id and s.is_active = true
          and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
          and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
      )
    ) then
      raise exception 'POS module access required.' using errcode = '42501';
    end if;
  end if;

  return query
  select p.id, p.sku, p.name, coalesce(nullif(p.pos_category, ''), p.category),
    p.unit, p.current_stock, p.min_stock, p.selling_price, p.production_center,
    p.pos_sort, p.tile_color, p.tile_text_color, p.tile_image_url
  from public.products p
  where p.property_id = p_property_id and p.pos_enabled is true and p.pos_active is true
  order by coalesce(nullif(p.pos_category, ''), p.category), p.pos_sort, p.name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_move_or_merge_pos_table_unfenced(p_property_id uuid, p_source_table_key text, p_target_table_key text, p_target_table_number text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_source public.pos_table_sessions;
  v_target public.pos_table_sessions;
  v_source_lines jsonb;
  v_target_lines jsonb;
  v_merged_lines jsonb;
  v_merged_kot_lines jsonb;
  v_status text;
  v_guests integer;
  v_waiter text;
  v_order_number text;
  v_kot_sent_at timestamptz;
  v_session jsonb;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if p_source_table_key is null or p_target_table_key is null
     or trim(p_source_table_key) = trim(p_target_table_key) then
    raise exception 'Choose a different target table.';
  end if;

  if p_mode not in ('move','merge') then
    raise exception 'Invalid table transfer mode.';
  end if;

  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager','cashier','waiter')
    or public.current_staff_role(p_property_id) in (
      'hotel_admin','super_admin','cashier','waiter','pos_staff','fb_manager',
      'front_office_manager','property_manager','general_manager','manager'
    )
  ) then
    raise exception 'Not allowed to move or join POS tables.';
  end if;

  -- Lock both active sessions in deterministic order to avoid concurrent
  -- move/merge operations racing each other.
  if p_source_table_key < p_target_table_key then
    select * into v_source
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_source_table_key and status <> 'closed'
      for update;
    select * into v_target
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_target_table_key and status <> 'closed'
      for update;
  else
    select * into v_target
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_target_table_key and status <> 'closed'
      for update;
    select * into v_source
      from public.pos_table_sessions
      where property_id = p_property_id and table_key = p_source_table_key and status <> 'closed'
      for update;
  end if;

  if v_source.id is null then
    raise exception 'Source table is no longer open.';
  end if;

  v_source_lines := coalesce(v_source.order_lines, '[]'::jsonb);

  if p_mode = 'move' then
    if v_target.id is not null then
      raise exception 'Target table is already occupied. Use Join Tables to combine the bills.';
    end if;

    -- Move the full session state, including immutable VAT and KOT snapshots.
    insert into public.pos_table_sessions(
      property_id, table_key, table_number, zone_id, status, guests, waiter,
      order_number, order_lines, opened_by, opened_at, updated_at, closed_at,
      kot_sent_at, vat_snapshot, kot_sent_order_lines
    ) values (
      p_property_id,
      p_target_table_key,
      coalesce(nullif(trim(p_target_table_number),''), p_target_table_key),
      v_source.zone_id,
      v_source.status,
      v_source.guests,
      v_source.waiter,
      v_source.order_number,
      v_source.order_lines,
      v_source.opened_by,
      v_source.opened_at,
      now(),
      null,
      v_source.kot_sent_at,
      v_source.vat_snapshot,
      coalesce(v_source.kot_sent_order_lines, '[]'::jsonb)
    );

    update public.pos_table_sessions
       set status = 'closed',
           closed_at = now(),
           updated_at = now()
     where id = v_source.id;

    insert into public.pos_order_audit(
      property_id, table_key, table_number, order_number, item_name, action, details, actor_id
    ) values (
      p_property_id, p_target_table_key,
      coalesce(nullif(trim(p_target_table_number),''), p_target_table_key),
      v_source.order_number, null, 'TABLE_MOVED',
      jsonb_build_object(
        'from_table_key', p_source_table_key,
        'from_table_number', v_source.table_number,
        'to_table_key', p_target_table_key,
        'to_table_number', coalesce(nullif(trim(p_target_table_number),''), p_target_table_key),
        'order_number', v_source.order_number
      ), auth.uid()
    );

    select to_jsonb(s) into v_session
      from public.pos_table_sessions s
      where s.property_id = p_property_id
        and s.table_key = p_target_table_key
        and s.status <> 'closed';

    return jsonb_build_object(
      'mode','move',
      'source_table_key',p_source_table_key,
      'target_table_key',p_target_table_key,
      'source_closed',true,
      'session',v_session
    );
  end if;

  if v_target.id is null then
    raise exception 'Target table must already have an ongoing bill for Join Tables.';
  end if;

  -- A joined bill can only have one immutable tax treatment. Refuse a join
  -- when both checks were opened under different VAT settings rather than
  -- silently recalculating either table's tax.
  if v_source.vat_snapshot is not null
     and v_target.vat_snapshot is not null
     and v_source.vat_snapshot is distinct from v_target.vat_snapshot then
    raise exception 'These tables have different saved VAT settings. Settle the bills separately before joining.';
  end if;

  v_target_lines := coalesce(v_target.order_lines, '[]'::jsonb);

  -- Aggregate each matching line in an inner query, then aggregate those
  -- groups in the outer query. The previous function grouped the outer SELECT
  -- itself, returning one row per distinct item and failing for normal orders.
  select coalesce(jsonb_agg(merged.line order by merged.first_ord), '[]'::jsonb)
    into v_merged_lines
  from (
    select
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              grouped.first_line - 'quantity',
              '{qty}',
              to_jsonb(grouped.total_qty),
              true
            ),
            '{id}',
            to_jsonb(coalesce(nullif(grouped.first_line->>'id',''),'joined') || '::join::' || md5((grouped.first_line - 'qty' - 'quantity')::text)),
            true
          ),
          '{productId}',
          to_jsonb(coalesce(nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'id',''))),
          true
        ),
        '{baseProductId}',
        to_jsonb(coalesce(nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'id',''))),
        true
      ) as line,
      grouped.first_ord
    from (
      select
        (array_agg(q.line order by q.ord))[1] as first_line,
        sum(coalesce((q.line->>'qty')::numeric, (q.line->>'quantity')::numeric, 0)) as total_qty,
        min(q.ord) as first_ord
      from (
        select value as line, ordinality::numeric as ord
          from jsonb_array_elements(v_target_lines) with ordinality
        union all
        select value as line, (100000 + ordinality)::numeric as ord
          from jsonb_array_elements(v_source_lines) with ordinality
      ) q
      group by md5((q.line - 'qty' - 'quantity')::text)
    ) grouped
  ) merged;

  -- Keep the already-sent KOT snapshot separate from the live order lines.
  -- This prevents unsent items from being treated as already fired.
  select coalesce(jsonb_agg(merged.line order by merged.first_ord), '[]'::jsonb)
    into v_merged_kot_lines
  from (
    select
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              grouped.first_line - 'quantity',
              '{qty}',
              to_jsonb(grouped.total_qty),
              true
            ),
            '{id}',
            to_jsonb(coalesce(nullif(grouped.first_line->>'id',''),'joined') || '::join::' || md5((grouped.first_line - 'qty' - 'quantity')::text)),
            true
          ),
          '{productId}',
          to_jsonb(coalesce(nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'id',''))),
          true
        ),
        '{baseProductId}',
        to_jsonb(coalesce(nullif(grouped.first_line->>'baseProductId',''), nullif(grouped.first_line->>'productId',''), nullif(grouped.first_line->>'id',''))),
        true
      ) as line,
      grouped.first_ord
    from (
      select
        (array_agg(q.line order by q.ord))[1] as first_line,
        sum(coalesce((q.line->>'qty')::numeric, (q.line->>'quantity')::numeric, 0)) as total_qty,
        min(q.ord) as first_ord
      from (
        select value as line, ordinality::numeric as ord
          from jsonb_array_elements(coalesce(v_target.kot_sent_order_lines, '[]'::jsonb)) with ordinality
        union all
        select value as line, (100000 + ordinality)::numeric as ord
          from jsonb_array_elements(coalesce(v_source.kot_sent_order_lines, '[]'::jsonb)) with ordinality
      ) q
      group by md5((q.line - 'qty' - 'quantity')::text)
    ) grouped
  ) merged;

  v_status := case
    when v_source.status = 'unsettled' or v_target.status = 'unsettled' then 'unsettled'
    else 'occupied'
  end;
  v_guests := greatest(coalesce(v_target.guests,1),1) + greatest(coalesce(v_source.guests,1),1);
  v_waiter := coalesce(nullif(trim(v_target.waiter),''), nullif(trim(v_source.waiter),''));
  v_order_number := coalesce(v_target.order_number, v_source.order_number);
  v_kot_sent_at := case
    when v_source.kot_sent_at is null then v_target.kot_sent_at
    when v_target.kot_sent_at is null then v_source.kot_sent_at
    when v_source.kot_sent_at > v_target.kot_sent_at then v_source.kot_sent_at
    else v_target.kot_sent_at
  end;

  update public.pos_table_sessions
     set status = v_status,
         guests = v_guests,
         waiter = v_waiter,
         order_number = v_order_number,
         order_lines = v_merged_lines,
         kot_sent_at = v_kot_sent_at,
         kot_sent_order_lines = v_merged_kot_lines,
         vat_snapshot = coalesce(v_target.vat_snapshot, v_source.vat_snapshot),
         updated_at = now()
   where id = v_target.id;

  update public.pos_table_sessions
     set status = 'closed',
         closed_at = now(),
         updated_at = now()
   where id = v_source.id;

  insert into public.pos_order_audit(
    property_id, table_key, table_number, order_number, item_name, action, details, actor_id
  ) values (
    p_property_id, v_target.table_key, v_target.table_number, v_order_number,
    null, 'TABLE_MERGED',
    jsonb_build_object(
      'from_table_key', p_source_table_key,
      'from_table_number', v_source.table_number,
      'to_table_key', p_target_table_key,
      'to_table_number', v_target.table_number,
      'source_order_number', v_source.order_number,
      'target_order_number', v_target.order_number,
      'source_guests', v_source.guests,
      'target_guests', v_target.guests
    ), auth.uid()
  );

  select to_jsonb(s) into v_session
    from public.pos_table_sessions s
    where s.id = v_target.id;

  return jsonb_build_object(
    'mode','merge',
    'source_table_key',p_source_table_key,
    'target_table_key',p_target_table_key,
    'source_closed',true,
    'session',v_session
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_night_audit_precheck(p_property_id uuid, p_business_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_open_shifts integer;
  v_pending integer;
  v_tx integer;
  v_revenue numeric;
begin
  if not public.fn_employee_has_permission(p_property_id,'back_office.reports.view') then
    raise exception 'Missing employee permission: back_office.reports.view';
  end if;
  if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')) then
    raise exception 'Manager access required.';
  end if;

  select count(*) into v_open_shifts from public.cashier_shifts where property_id=p_property_id and status='open';
  select count(*) into v_pending from public.cashier_adjustments where property_id=p_property_id and status='pending';

  select count(*), coalesce(sum(total),0)
    into v_tx,v_revenue
    from public.pos_receipts
    where property_id=p_property_id
      and status='posted'
      and (created_at at time zone 'Africa/Nairobi')::date=p_business_date;

  return jsonb_build_object(
    'business_date',p_business_date,
    'open_cashier_shifts',v_open_shifts,
    'pending_adjustments',v_pending,
    'transactions',v_tx,
    'revenue',v_revenue,
    'ready',v_open_shifts=0 and v_pending=0
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_open_cashier_shift(p_property_id uuid, p_opening_float numeric DEFAULT 0)
 RETURNS cashier_shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_shift public.cashier_shifts; v_open public.cashier_shifts; v_staff_id uuid; v_role text; v_by text;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.open_shift') then
    raise exception 'Missing employee permission: pos.open_shift';
  end if;
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_opening_float is null or p_opening_float < 0 then raise exception 'Opening float cannot be negative.'; end if;

  v_role := public.current_staff_role(p_property_id);
  if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','fb_manager') then
    raise exception 'Only authorised cashier staff can open a shift.';
  end if;
  if v_role is null and not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier')) then
    raise exception 'Only authorised cashier staff can open a shift.';
  end if;

  select * into v_open from public.cashier_shifts where property_id = p_property_id and status = 'open' limit 1;
  if v_open.id is not null then
    select coalesce(full_name, email) into v_by from public.profiles where id = v_open.opened_by;
    raise exception 'Shift #% is already open (opened by % on %). Close it before opening a new one.',
      v_open.shift_no, coalesce(v_by,'another user'), to_char(v_open.opened_at at time zone 'Africa/Nairobi','DD Mon YYYY HH24:MI');
  end if;

  v_staff_id := public.current_staff_id(p_property_id);
  begin
    insert into public.cashier_shifts(property_id, staff_id, opened_by, opening_float)
    values (p_property_id, v_staff_id, auth.uid(), p_opening_float) returning * into v_shift;
  exception when unique_violation then
    raise exception 'A shift is already open for this property. Close it before opening a new one.';
  end;

  insert into public.audit_logs(actor_id, property_id, action, new_value)
  values (auth.uid(), p_property_id, 'cashier_shift_opened',
          jsonb_build_object('shift_id', v_shift.id, 'shift_no', v_shift.shift_no, 'opening_float', p_opening_float));
  return v_shift;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_pos_access_pin_status(p_property_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_credential public.pos_access_credentials;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.access') then
    raise exception 'Missing employee permission: pos.access';
  end if;
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin')
    or exists (
      select 1 from public.staff s
      where s.property_id = p_property_id and s.is_active = true
        and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
        and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
        and lower(coalesce(s.role, '')) in ('hotel_admin', 'super_admin')
    )
  ) then raise exception 'Only the property owner or administrator can manage the POS PIN.'; end if;

  select * into v_credential
  from public.pos_access_credentials
  where property_id = p_property_id;

  return jsonb_build_object(
    'configured', v_credential.property_id is not null,
    'is_default', coalesce(v_credential.is_default, true),
    'updated_at', v_credential.updated_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_post_folio_charge(p_property_id uuid, p_reservation_id uuid, p_category text, p_description text, p_quantity numeric, p_unit_price numeric, p_reference text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS folio_charges
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.reservations; c public.folio_charges; q numeric; price numeric; amount numeric; key text;
begin
  if not public.fn_employee_has_permission(p_property_id,'front_office.folio.post_charge') then
    raise exception 'Missing employee permission: front_office.folio.post_charge';
  end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 if public.current_staff_role(p_property_id) is not null and public.current_staff_role(p_property_id) not in ('hotel_admin','super_admin','cashier','fb_manager','front_office_manager','general_manager','property_manager','reception','receptionist','front_desk') then raise exception 'Folio charge permission required.'; end if;
 if public.current_staff_role(p_property_id) is null and not(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier','reception','receptionist','front_desk')) then raise exception 'Folio charge permission required.'; end if;
 key:=nullif(trim(p_idempotency_key),'');
 if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-charge:'||key,0));
 select * into c from public.folio_charges where property_id=p_property_id and idempotency_key=key;
 if c.id is not null then
   if c.reservation_id<>p_reservation_id or c.category<>p_category or c.description<>trim(p_description) or c.quantity<>coalesce(p_quantity,1) or c.unit_price<>coalesce(p_unit_price,0) then raise exception 'Idempotency key was already used for a different folio charge.'; end if;
   return c;
 end if;
 q:=coalesce(p_quantity,1); price:=coalesce(p_unit_price,0); amount:=round(q*price,2);
 if p_category not in ('accommodation','restaurant','bar','laundry','airport_transfer','excursion','room_service','other_services','tax_adjustment') then raise exception 'Invalid folio transaction category.'; end if;
 if q<=0 or price<=0 or amount<=0 then raise exception 'Quantity and unit price must be greater than zero.'; end if;
 if nullif(trim(p_description),'') is null then raise exception 'Description is required.'; end if;
 select * into r from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if r.id is null or r.status in ('cancelled','checked-out') then raise exception 'An active reservation is required.'; end if;
 insert into public.folio_charges(property_id,reservation_id,source,description,amount,category,quantity,unit_price,reference,source_module,created_by,idempotency_key)
 values(p_property_id,p_reservation_id,case when p_category='accommodation' then 'room' else 'other' end,trim(p_description),amount,p_category,q,price,
 coalesce(nullif(trim(p_reference),''),'FOL-'||upper(substr(gen_random_uuid()::text,1,8))),'frontoffice',auth.uid(),key)
 returning * into c;
 return c;
end; $function$
;

CREATE OR REPLACE FUNCTION public.fn_post_folio_payment(p_property_id uuid, p_reservation_id uuid, p_amount numeric, p_method text, p_reference text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_folio_charge_id uuid DEFAULT NULL::uuid)
 RETURNS payments
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r public.reservations; p public.payments; c public.folio_charges; key text; charges numeric; paid numeric; booking numeric; balance numeric; shift uuid; allocated numeric;
begin
  if not public.fn_employee_has_permission(p_property_id,'front_office.folio.payment') then
    raise exception 'Missing employee permission: front_office.folio.payment';
  end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 if public.current_staff_role(p_property_id) is not null and public.current_staff_role(p_property_id) not in ('hotel_admin','super_admin','cashier','fb_manager','front_office_manager','general_manager','property_manager','reception','receptionist','front_desk') then raise exception 'Payment permission required.'; end if;
 if public.current_staff_role(p_property_id) is null and not(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager','cashier','reception','receptionist','front_desk')) then raise exception 'Payment permission required.'; end if;
 key:=nullif(trim(p_idempotency_key),''); if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-payment:'||key,0));
 select * into p from public.payments where property_id=p_property_id and idempotency_key=key;
 if p.id is not null then
   if p.reservation_id<>p_reservation_id or p.amount<>round(p_amount,2) or p.method<>p_method or p.folio_charge_id is distinct from p_folio_charge_id then raise exception 'Idempotency key was already used for a different payment.'; end if;
   return p;
 end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero.'; end if;
 if p_method not in ('cash','mpesa','card','bank_transfer','other') then raise exception 'Unsupported payment method.'; end if;
 select * into r from public.reservations where id=p_reservation_id and property_id=p_property_id for update;
 if r.id is null or r.status='cancelled' then raise exception 'Reservation not found or cancelled.'; end if;
 select coalesce(sum(amount),0) into charges from public.folio_charges where reservation_id=r.id;
 select coalesce(sum(amount),0) into paid from public.payments where reservation_id=r.id and status='posted';
 booking:=greatest(charges,coalesce(nullif(r.total_amount,0),coalesce(r.rate,0)*greatest(1,r.departure-r.arrival)));
 balance:=greatest(0,booking-paid);
 if p_amount>balance+0.005 then raise exception 'Payment exceeds outstanding folio balance of %.',round(balance,2); end if;
 if p_folio_charge_id is not null then
   select * into c from public.folio_charges where id=p_folio_charge_id and reservation_id=r.id and property_id=p_property_id for update;
   if c.id is null or c.amount<=0 then raise exception 'Selected charge is not eligible for payment allocation.'; end if;
   select coalesce(sum(amount),0) into allocated from public.payments where folio_charge_id=c.id and status='posted';
   if p_amount>greatest(0,c.amount-allocated)+0.005 then raise exception 'Payment exceeds the unallocated balance of the selected charge.'; end if;
 end if;
 select cs.id into shift from public.cashier_shifts cs where cs.property_id=p_property_id and cs.opened_by=auth.uid() and cs.status='open' order by cs.opened_at desc limit 1;
 insert into public.payments(property_id,reservation_id,amount,method,status,shift_id,reference,idempotency_key,created_by,folio_charge_id)
 values(p_property_id,r.id,round(p_amount,2),p_method,'posted',shift,coalesce(nullif(trim(p_reference),''),'PAY-'||upper(substr(gen_random_uuid()::text,1,8))),key,auth.uid(),p_folio_charge_id)
 returning * into p;
 update public.reservations set amount_paid=least(booking,paid+p.amount),
 payment_status=case when booking>0 and paid+p.amount>=booking-0.005 then 'fully_paid' when paid+p.amount>0 then 'partially_paid' else 'not_paid' end
 where id=r.id;
 return p;
end; $function$
;

CREATE OR REPLACE FUNCTION public.fn_post_folio_refund(p_property_id uuid, p_payment_id uuid, p_amount numeric, p_refund_method text, p_reason text, p_idempotency_key text)
 RETURNS payments
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare original public.payments; refund_payment public.payments; adjustment public.cashier_adjustments;
 manager boolean; key text; already numeric; remaining numeric; reservation_property uuid;
begin
  if not public.fn_employee_has_permission(p_property_id,'front_office.folio.payment') then
    raise exception 'Missing employee permission: front_office.folio.payment';
  end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 manager:=coalesce(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager'),false);
 if not manager then raise exception 'Manager approval is required to refund a guest payment.'; end if;
 key:=nullif(trim(p_idempotency_key),''); if key is null then raise exception 'An idempotency key is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||':folio-refund:'||key,0));
 select * into refund_payment from public.payments where property_id=p_property_id and idempotency_key='refund:'||key;
 if refund_payment.id is not null then
   if refund_payment.refund_of_id<>p_payment_id or refund_payment.amount<>-round(p_amount,2) or refund_payment.method<>p_refund_method then raise exception 'Idempotency key was already used for a different refund.'; end if;
   return refund_payment;
 end if;
 if p_amount<=0 or nullif(trim(p_reason),'') is null then raise exception 'Refund amount and reason are required.'; end if;
 if p_refund_method not in ('cash','mpesa','card','bank_transfer','other') then raise exception 'Unsupported refund method.'; end if;
 select * into original from public.payments where id=p_payment_id and property_id=p_property_id and status='posted' and amount>0 for update;
 if original.id is null then raise exception 'A posted positive payment is required.'; end if;
 select coalesce(sum(cr.amount),0) into already from public.cashier_refunds cr where cr.target_type='payment' and cr.target_id=original.id;
 remaining:=original.amount-already;
 if p_amount>remaining+0.005 then raise exception 'Refund exceeds the remaining refundable payment amount of %.',round(remaining,2); end if;
 select property_id into reservation_property from public.reservations where id=original.reservation_id;
 if reservation_property is distinct from p_property_id then raise exception 'Payment reservation does not belong to this property.'; end if;
 insert into public.cashier_adjustments(property_id,shift_id,adjustment_type,target_type,target_id,amount,reason,created_by,approved_by,status,refund_method)
 values(p_property_id,original.shift_id,'refund','payment',original.id,round(p_amount,2),trim(p_reason),auth.uid(),auth.uid(),'approved',p_refund_method)
 returning * into adjustment;
 insert into public.payments(property_id,reservation_id,amount,method,status,shift_id,reference,idempotency_key,created_by,refund_of_id,folio_charge_id)
 values(p_property_id,original.reservation_id,-round(p_amount,2),p_refund_method,'posted',original.shift_id,
 'REF-'||upper(substr(gen_random_uuid()::text,1,8)),'refund:'||key,auth.uid(),original.id,original.folio_charge_id)
 returning * into refund_payment;
 insert into public.cashier_refunds(property_id,adjustment_id,target_type,target_id,original_payment_id,refund_payment_id,amount,method,reservation_id,approved_by,settlement_method)
 values(p_property_id,adjustment.id,'payment',original.id,original.id,refund_payment.id,round(p_amount,2),p_refund_method,original.reservation_id,auth.uid(),p_refund_method);
 insert into public.audit_logs(actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id)
 values(auth.uid(),p_property_id,'folio_payment_refunded',to_jsonb(original),jsonb_build_object('refund_payment_id',refund_payment.id,'amount',p_amount,'method',p_refund_method,'reason',trim(p_reason)),'payment',original.id,original.reservation_id);
 return refund_payment;
end; $function$
;

CREATE OR REPLACE FUNCTION public.fn_record_pos_sale(p_property_id uuid, p_table_number text, p_order_number text, p_items jsonb, p_subtotal numeric, p_discount_amount numeric, p_vat numeric, p_total numeric, p_payment_method text, p_reservation_id uuid DEFAULT NULL::uuid, p_shift_id uuid DEFAULT NULL::uuid, p_waiter text DEFAULT NULL::text, p_discount_id uuid DEFAULT NULL::uuid, p_discount_name text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_payment_allocations jsonb DEFAULT NULL::jsonb)
 RETURNS pos_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_receipt public.pos_receipts; v_shift uuid; v_key text; v_folio_charge_id uuid;
 v_role text; v_res_property uuid; v_room_id uuid; v_room_number text; v_guest_name text;
 item jsonb; a jsonb; v_product public.products; v_qty numeric; v_name text;
 v_method text; v_amount numeric; v_res uuid; v_sum numeric:=0; v_alloc_folio uuid;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 if p_payment_method not in ('cash','card','mpesa','bank','room','split') then raise exception 'Unknown payment method.'; end if;
 if p_total<=0 then raise exception 'Total must be greater than zero.'; end if;
 v_key:=nullif(trim(p_idempotency_key),'');
 if v_key is not null then select * into v_receipt from public.pos_receipts where property_id=p_property_id and idempotency_key=v_key limit 1; if v_receipt.id is not null then return v_receipt; end if; end if;
 v_shift:=p_shift_id;
 if v_shift is null then select id into v_shift from public.cashier_shifts where property_id=p_property_id and status='open' order by opened_at desc limit 1; end if;
 if v_shift is null or not exists(select 1 from public.cashier_shifts where id=v_shift and property_id=p_property_id and status='open') then raise exception 'No open shift. Open a shift from the Shifts menu before recording sales.'; end if;
 if p_discount_id is not null and not exists(select 1 from public.pos_discounts where id=p_discount_id and property_id=p_property_id and active) then raise exception 'Discount is not active or does not belong to this property.'; end if;
 if p_payment_method='room' then
   if p_reservation_id is null then raise exception 'Select which guest/room to charge.'; end if;
   v_role:=public.current_staff_role(p_property_id);
   if v_role is not null and v_role not in ('hotel_admin','super_admin','cashier','manager','admin','owner','property_manager','general_manager','front_office_manager','fb_manager') then raise exception 'Only an authorised cashier or manager can charge a restaurant bill to a room.'; end if;
   select r.property_id,r.room_id,rm.number::text,r.guest_name into v_res_property,v_room_id,v_room_number,v_guest_name from public.reservations r left join public.rooms rm on rm.id=r.room_id where r.id=p_reservation_id and r.status='checked-in';
   if v_res_property is null or v_res_property<>p_property_id then raise exception 'Checked-in reservation not found.'; end if;
   insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,p_reservation_id,'pos',coalesce(nullif(p_order_number,''),'POS sale')||' — Table '||coalesce(p_table_number,''),p_total) returning id into v_folio_charge_id;
 end if;
 perform public.fn_consume_recipe_stock(p_property_id,p_items,coalesce(nullif(p_order_number,''),'POS sale'));
 for item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
   v_qty:=coalesce((item->>'qty')::numeric,(item->>'quantity')::numeric,0); v_name:=trim(coalesce(item->>'name',item->>'item_name',''));
   if v_qty>0 and nullif(item->>'product_id','') is not null then
     begin
       select * into v_product from public.products where id=(item->>'product_id')::uuid and property_id=p_property_id for update;
       if v_product.id is not null and not exists(select 1 from public.recipes r where r.property_id=p_property_id and r.active and lower(trim(r.menu_item_name))=lower(v_name)) then
         if v_product.current_stock<v_qty then raise exception 'Insufficient stock for % (available %, required %).',v_product.name,v_product.current_stock,v_qty; end if;
         perform public.fn_apply_stock_movement(v_product.id,-v_qty,'POS Sale '||coalesce(p_order_number,''),'pos_sale',null);
       end if;
     exception when invalid_text_representation then null; end;
   end if;
 end loop;
 insert into public.pos_receipts(property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,waiter,items,subtotal,discount_amount,discount_id,discount_name,vat,total,payment_method,folio_charge_id,created_by,shift_id,pos_shift_id,idempotency_key)
 values(p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,p_waiter,coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),p_discount_id,p_discount_name,coalesce(p_vat,0),p_total,p_payment_method,v_folio_charge_id,auth.uid(),v_shift,null,v_key)
 returning * into v_receipt;
 if p_payment_method='split' then
   if jsonb_typeof(coalesce(p_payment_allocations,'null'::jsonb))<>'array' then raise exception 'Split payment allocations are required.'; end if;
   delete from public.pos_receipt_payments where receipt_id=v_receipt.id;
   for a in select value from jsonb_array_elements(p_payment_allocations) loop
     v_method:=lower(trim(coalesce(a->>'method',''))); v_amount:=round(coalesce((a->>'amount')::numeric,0),2); v_res:=nullif(a->>'reservation_id','')::uuid;
     if v_method not in ('cash','card','mpesa','bank','room') then raise exception 'Invalid split payment method: %',v_method; end if;
     if v_amount<=0 then raise exception 'Split payment amounts must be greater than zero.'; end if;
     if v_method='room' then
       if v_res is null or not exists(select 1 from public.reservations where id=v_res and property_id=p_property_id and status='checked-in') then raise exception 'Checked-in reservation required for room-charge allocation.'; end if;
       insert into public.folio_charges(property_id,reservation_id,source,description,amount) values(p_property_id,v_res,'pos','POS split payment '||coalesce(p_order_number,v_receipt.id::text),v_amount) returning id into v_alloc_folio;
     else v_alloc_folio:=null; end if;
     v_sum:=v_sum+v_amount;
     insert into public.pos_receipt_payments(receipt_id,property_id,payment_method,amount,reservation_id,folio_charge_id,created_by) values(v_receipt.id,p_property_id,v_method,v_amount,v_res,v_alloc_folio,auth.uid());
   end loop;
   if round(v_sum,2)<>round(p_total,2) then raise exception 'Split payments total % does not equal receipt total %.',v_sum,p_total; end if;
 end if;
 return v_receipt;
exception when unique_violation then
 select * into v_receipt from public.pos_receipts where property_id=p_property_id and idempotency_key=v_key limit 1;
 if v_receipt.id is not null then return v_receipt; end if;
 raise;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_refire_kitchen_order(p_property_id uuid, p_order_id uuid, p_reason text)
 RETURNS pos_kitchen_orders
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row public.pos_kitchen_orders;
  v_role text;
  v_jobs jsonb;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  v_role := coalesce(public.current_staff_role(p_property_id), public.property_role(p_property_id), '');
  if lower(v_role) not in ('owner','admin','manager','cashier','fb_manager','hotel_admin','super_admin','general_manager','front_office_manager','property_manager') then
    raise exception 'Manager authorization is required to re-fire a kitchen ticket.';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'A re-fire reason is required.';
  end if;

  select * into v_row from public.pos_kitchen_orders
  where id=p_order_id and property_id=p_property_id
  for update;
  if not found then raise exception 'Kitchen order not found.'; end if;
  if v_row.status in ('served','cancelled') then raise exception 'Served or cancelled tickets cannot be re-fired.'; end if;

  v_jobs := coalesce(v_row.print_jobs,'{}'::jsonb);
  v_jobs := jsonb_set(v_jobs,'{refire_count}',to_jsonb(coalesce((v_jobs->>'refire_count')::int,0)+1),true);
  v_jobs := jsonb_set(v_jobs,'{last_refire_at}',to_jsonb(now()),true);

  update public.pos_kitchen_orders
  set print_jobs=v_jobs, updated_at=now()
  where id=v_row.id and property_id=p_property_id
  returning * into v_row;

  insert into public.pos_kitchen_order_events(property_id,kitchen_order_id,event_type,from_status,to_status,reason,actor_user_id,metadata)
  values(p_property_id,v_row.id,'refired',v_row.status,v_row.status,p_reason,auth.uid(),
         jsonb_build_object('refire_count',(v_jobs->>'refire_count')::int));
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_reset_pos_access_pin(p_property_id uuid, p_new_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.menu.manage') then
    raise exception 'Missing employee permission: pos.menu.manage';
  end if;
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner', 'admin')
    or public.current_staff_role(p_property_id) in ('hotel_admin', 'super_admin')
    or exists (
      select 1 from public.staff s
      where s.property_id = p_property_id and s.is_active = true
        and (s.user_id = auth.uid() or lower(coalesce(s.email, '')) = lower(coalesce(auth.jwt() ->> 'email', '')))
        and 'pos' = any(coalesce(s.assigned_modules, array[]::text[]))
        and lower(coalesce(s.role, '')) in ('hotel_admin', 'super_admin')
    )
  ) then raise exception 'Only the property owner or administrator can reset the POS PIN.'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'POS PIN must contain exactly four digits.';
  end if;
  if p_new_pin = '1234' then
    raise exception 'Choose a PIN different from the initial default 1234.';
  end if;
  if p_new_pin ~ '^([0-9])\1{3}$'
     or p_new_pin in ('0123','2345','3456','4567','5678','6789','3210','4321','5432','6543','7654','8765','9876') then
    raise exception 'Choose a PIN that is not a repeated or sequential number.';
  end if;

  insert into public.pos_access_credentials(property_id, pin_hash, is_default, updated_by, updated_at)
  values (p_property_id, extensions.crypt(p_new_pin, extensions.gen_salt('bf', 12)), false, auth.uid(), now())
  on conflict (property_id) do update
  set pin_hash = excluded.pin_hash,
      is_default = false,
      updated_by = auth.uid(),
      updated_at = now();

  delete from public.pos_access_pin_attempts where property_id = p_property_id;
  return jsonb_build_object('ok', true, 'is_default', false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_run_night_audit(p_property_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS night_audits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_audit public.night_audits;
  v_date date;
  v_next date;
  v_open_shifts integer;
  v_pending integer;
  v_cash numeric := 0;
  v_card numeric := 0;
  v_mpesa numeric := 0;
  v_room numeric := 0;
  v_total numeric := 0;
  v_refunds numeric := 0;
  v_voids numeric := 0;
  v_discounts numeric := 0;
  v_count integer := 0;
  v_variance numeric := 0;
begin
  if not public.fn_employee_has_permission(p_property_id,'back_office.reports.view') then
    raise exception 'Missing employee permission: back_office.reports.view';
  end if;
  if not (public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')) then
    raise exception 'Manager access required.';
  end if;

  select business_date into v_date from public.property_business_dates where property_id=p_property_id for update;
  if v_date is null then
    v_date := (now() at time zone 'Africa/Nairobi')::date;
    insert into public.property_business_dates(property_id,business_date)
    values(p_property_id,v_date)
    on conflict(property_id) do nothing;
  end if;

  if exists(select 1 from public.night_audits where property_id=p_property_id and business_date=v_date and status='closed') then
    raise exception 'Night audit already completed for this business date.';
  end if;

  select count(*) into v_open_shifts from public.cashier_shifts where property_id=p_property_id and status='open';
  if v_open_shifts > 0 then raise exception 'Close all cashier shifts before running night audit.'; end if;

  select count(*) into v_pending from public.cashier_adjustments where property_id=p_property_id and status='pending';
  if v_pending > 0 then raise exception 'Resolve all pending cashier adjustments before night audit.'; end if;

  select
    coalesce(sum(case when payment_method='cash' then total else 0 end),0),
    coalesce(sum(case when payment_method='card' then total else 0 end),0),
    coalesce(sum(case when payment_method='mpesa' then total else 0 end),0),
    coalesce(sum(case when payment_method='room' then total else 0 end),0),
    coalesce(sum(total),0),
    count(*)
  into v_cash,v_card,v_mpesa,v_room,v_total,v_count
  from public.pos_receipts
  where property_id=p_property_id and status='posted'
    and (created_at at time zone 'Africa/Nairobi')::date=v_date;

  select coalesce(sum(case when adjustment_type='refund' then amount else 0 end),0),
         coalesce(sum(case when adjustment_type='void' then amount else 0 end),0),
         coalesce(sum(case when adjustment_type='discount' then amount else 0 end),0)
  into v_refunds,v_voids,v_discounts
  from public.cashier_adjustments
  where property_id=p_property_id and status='approved'
    and (created_at at time zone 'Africa/Nairobi')::date=v_date;

  select coalesce(sum(variance),0) into v_variance
  from public.cashier_shifts
  where property_id=p_property_id and status='closed'
    and (closed_at at time zone 'Africa/Nairobi')::date=v_date;

  v_next := v_date + 1;

  insert into public.night_audits(
    property_id,business_date,next_business_date,status,started_by,total_revenue,cash_revenue,
    card_revenue,mpesa_revenue,room_revenue,refunds,voids,discounts,transaction_count,
    cashier_variance,notes
  ) values(
    p_property_id,v_date,v_next,'closed',auth.uid(),v_total,v_cash,v_card,v_mpesa,v_room,
    v_refunds,v_voids,v_discounts,v_count,v_variance,p_notes
  ) returning * into v_audit;

  update public.property_business_dates
  set business_date=v_next,updated_at=now()
  where property_id=p_property_id;

  return v_audit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_transfer_folio_charges(p_property_id uuid, p_charge_ids uuid[], p_target_reservation_id uuid, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare target public.reservations; charge public.folio_charges; moved integer:=0; source_reservation uuid;
begin
  if not public.fn_employee_has_permission(p_property_id,'front_office.folio.post_charge') then
    raise exception 'Missing employee permission: front_office.folio.post_charge';
  end if;
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Access denied.'; end if;
 if not coalesce(public.is_platform_owner() or public.property_role(p_property_id) in ('owner','admin','manager') or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager','general_manager','front_office_manager'),false) then raise exception 'Manager permission is required to transfer folio charges.'; end if;
 if coalesce(array_length(p_charge_ids,1),0)=0 or nullif(trim(p_reason),'') is null then raise exception 'Select charges and provide a transfer reason.'; end if;
 select * into target from public.reservations where id=p_target_reservation_id and property_id=p_property_id for update;
 if target.id is null or target.status in ('cancelled','checked-out') then raise exception 'Target folio must belong to this property and be active.'; end if;
 for charge in select * from public.folio_charges where id=any(p_charge_ids) and property_id=p_property_id for update loop
   if charge.reservation_id=p_target_reservation_id then continue; end if;
   if charge.reversal_of_id is not null or exists(select 1 from public.folio_charges x where x.reversal_of_id=charge.id) then raise exception 'Reversed charges cannot be transferred.'; end if;
   source_reservation:=charge.reservation_id;
   update public.folio_charges set reservation_id=p_target_reservation_id,reference=coalesce(reference,'') where id=charge.id;
   insert into public.audit_logs(actor_id,property_id,action,old_value,new_value,entity_type,entity_id,related_reservation_id)
   values(auth.uid(),p_property_id,'folio_charge_transferred',jsonb_build_object('reservation_id',source_reservation),jsonb_build_object('reservation_id',p_target_reservation_id,'reason',trim(p_reason)),'folio_charge',charge.id,source_reservation);
   moved:=moved+1;
 end loop;
 if moved=0 then raise exception 'No eligible charges were transferred.'; end if;
 return moved;
end; $function$
;

CREATE OR REPLACE FUNCTION public.fn_update_kitchen_order(p_property_id uuid, p_order_id uuid, p_status text, p_print_jobs jsonb)
 RETURNS pos_kitchen_orders
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row public.pos_kitchen_orders;
  v_from text;
  v_role text;
begin
  if not public.fn_employee_has_permission(p_property_id,'pos.process_sale') then
    raise exception 'Missing employee permission: pos.process_sale';
  end if;
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;
  v_role := coalesce(public.current_staff_role(p_property_id), public.property_role(p_property_id), '');
  if lower(v_role) not in ('owner','admin','manager','cashier','waiter','pos_staff','fb_manager','hotel_admin','super_admin','general_manager','front_office_manager','property_manager') then
    raise exception 'KDS update is not authorized for this staff role.';
  end if;
  if p_status not in ('new','preparing','ready','served','cancelled') then
    raise exception 'Invalid kitchen order status.';
  end if;

  select status into v_from
  from public.pos_kitchen_orders
  where id = p_order_id and property_id = p_property_id
  for update;
  if not found then raise exception 'Kitchen order not found.'; end if;

  if v_from = 'served' and p_status <> 'served' then
    raise exception 'Served kitchen orders cannot be moved backwards.';
  end if;
  if v_from = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'Cancelled kitchen orders cannot be reopened.';
  end if;
  if p_status <> 'cancelled' and v_from <> p_status then
    if (v_from,p_status) not in (('new','preparing'),('preparing','ready'),('ready','served')) then
      raise exception 'Invalid kitchen production transition.';
    end if;
  end if;

  update public.pos_kitchen_orders
     set status = p_status,
         print_jobs = coalesce(p_print_jobs, print_jobs),
         updated_at = now(),
         served_at = case when p_status = 'served' then coalesce(served_at, now()) else served_at end
   where id = p_order_id and property_id = p_property_id
   returning * into v_row;

  if v_from <> p_status then
    insert into public.pos_kitchen_order_events(property_id,kitchen_order_id,event_type,from_status,to_status,actor_user_id,metadata)
    values(p_property_id,p_order_id,case when p_status='cancelled' then 'cancelled' else 'status_changed' end,v_from,p_status,auth.uid(),'{}'::jsonb);
  end if;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_upsert_pos_printer(p_property_id uuid, p_client_key text, p_name text, p_connection_type text, p_host text, p_port text, p_agent_url text, p_purposes jsonb, p_center text, p_baud_rate integer DEFAULT 9600)
 RETURNS pos_printers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row public.pos_printers;
begin
  if not public.fn_employee_has_permission(p_property_id,'back_office.settings.manage') then
    raise exception 'Missing employee permission: back_office.settings.manage';
  end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.current_staff_role(p_property_id) in ('hotel_admin','super_admin','fb_manager')
  ) then raise exception 'Not allowed.'; end if;

  if p_connection_type not in ('network','usb','bluetooth','serial','system') then
    raise exception 'Invalid printer connection type.';
  end if;

  if coalesce(p_baud_rate,9600) not in (1200,2400,4800,9600,19200,38400,57600,115200) then
    raise exception 'Invalid serial baud rate.';
  end if;

  insert into public.pos_printers(property_id,client_key,name,connection_type,host,port,agent_url,purposes,center,baud_rate,updated_at)
  values(p_property_id,p_client_key,coalesce(nullif(trim(p_name),''),'Printer'),p_connection_type,
    nullif(trim(p_host),''),nullif(trim(p_port),''),nullif(trim(p_agent_url),''),
    coalesce(p_purposes,'["receipt"]'::jsonb),nullif(trim(p_center),''),coalesce(p_baud_rate,9600),now())
  on conflict(property_id,client_key) do update set
    name=excluded.name,connection_type=excluded.connection_type,host=excluded.host,port=excluded.port,
    agent_url=excluded.agent_url,purposes=excluded.purposes,center=excluded.center,
    baud_rate=excluded.baud_rate,updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$
;

notify pgrst, 'reload schema';
