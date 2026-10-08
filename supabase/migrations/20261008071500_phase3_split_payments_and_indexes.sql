-- Phase 3 atomic split payments and POS query indexes
alter table public.pos_receipts add column if not exists idempotency_key text;
alter table public.pos_receipts add column if not exists pos_shift_id uuid references public.pos_shifts(id) on delete set null;
create unique index if not exists pos_receipts_property_idempotency_key_uidx on public.pos_receipts(property_id,idempotency_key) where idempotency_key is not null;
create index if not exists pos_receipts_pos_shift_id_idx on public.pos_receipts(pos_shift_id);
create index if not exists pos_receipts_discount_id_idx on public.pos_receipts(discount_id);
create index if not exists pos_menu_modifier_groups_modifier_group_idx on public.pos_menu_modifier_groups(modifier_group_id);
create index if not exists pos_modifier_options_modifier_group_idx2 on public.pos_modifier_options(modifier_group_id);

create table if not exists public.pos_receipt_payments(
 id uuid primary key default gen_random_uuid(), receipt_id uuid not null references public.pos_receipts(id) on delete cascade,
 property_id uuid not null, payment_method text not null, amount numeric(12,2) not null check(amount>0),
 reservation_id uuid references public.reservations(id) on delete set null, folio_charge_id uuid references public.folio_charges(id) on delete set null,
 created_by uuid, created_at timestamptz not null default now()
);
create index if not exists pos_receipt_payments_receipt_idx on public.pos_receipt_payments(receipt_id);
create index if not exists pos_receipt_payments_property_idx on public.pos_receipt_payments(property_id);
alter table public.pos_receipt_payments enable row level security;
drop policy if exists "pos receipt payments property access" on public.pos_receipt_payments;
create policy "pos receipt payments property access" on public.pos_receipt_payments for select to authenticated using (public.is_platform_owner() or public.is_member_of_property(property_id));
grant select on public.pos_receipt_payments to authenticated;

drop function if exists public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text);
create or replace function public.fn_record_pos_sale(
 p_property_id uuid,p_table_number text,p_order_number text,p_items jsonb,p_subtotal numeric,p_discount_amount numeric,p_vat numeric,p_total numeric,
 p_payment_method text,p_reservation_id uuid default null,p_shift_id uuid default null,p_waiter text default null,p_discount_id uuid default null,p_discount_name text default null,
 p_idempotency_key text default null,p_payment_allocations jsonb default null
) returns public.pos_receipts
language plpgsql security definer set search_path=public
as $
declare
 v_receipt public.pos_receipts; v_shift uuid; v_key text; v_folio_charge_id uuid;
 v_role text; v_res_property uuid; v_room_id uuid; v_room_number text; v_guest_name text;
 item jsonb; a jsonb; v_product public.products; v_qty numeric; v_name text;
 v_method text; v_amount numeric; v_res uuid; v_sum numeric:=0; v_alloc_folio uuid;
begin
 if not(public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
 if p_payment_method not in ('cash','card','mpesa','bank','room','split') then raise exception 'Unknown payment method.'; end if;
 if p_total<=0 then raise exception 'Total must be greater than zero.'; end if;
 v_key:=nullif(trim(p_idempotency_key),'');
 if v_key is not null then select * into v_receipt from public.pos_receipts where property_id=p_property_id and idempotency_key=v_key limit 1; if v_receipt.id is not null then return v_receipt; end if; end if;
 v_shift:=p_shift_id;
 if v_shift is null then select id into v_shift from public.pos_shifts where property_id=p_property_id and status='open' and date=(now() at time zone 'Africa/Nairobi')::date order by opened_at desc limit 1; end if;
 if v_shift is null or not exists(select 1 from public.pos_shifts where id=v_shift and property_id=p_property_id and status='open') then raise exception 'Open a POS shift before recording sales.'; end if;
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
         update public.products set current_stock=current_stock-v_qty,updated_at=now() where id=v_product.id;
         insert into public.stock_movements(property_id,product_id,type,qty,reason,user_id) values(p_property_id,v_product.id,'out',v_qty,'POS Sale '||coalesce(p_order_number,''),auth.uid());
       end if;
     exception when invalid_text_representation then null; end;
   end if;
 end loop;
 insert into public.pos_receipts(property_id,reservation_id,room_id,room_number,guest_name,table_number,order_number,waiter,items,subtotal,discount_amount,discount_id,discount_name,vat,total,payment_method,folio_charge_id,created_by,shift_id,pos_shift_id,idempotency_key)
 values(p_property_id,p_reservation_id,v_room_id,v_room_number,v_guest_name,p_table_number,p_order_number,p_waiter,coalesce(p_items,'[]'::jsonb),coalesce(p_subtotal,0),coalesce(p_discount_amount,0),p_discount_id,p_discount_name,coalesce(p_vat,0),p_total,p_payment_method,v_folio_charge_id,auth.uid(),null,v_shift,v_key)
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
end $;
grant execute on function public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb) to authenticated;
revoke execute on function public.fn_record_pos_sale(uuid,text,text,jsonb,numeric,numeric,numeric,numeric,text,uuid,uuid,text,uuid,text,text,jsonb) from anon,public;