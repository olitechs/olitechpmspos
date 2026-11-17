-- Property-admin read-only delivery diagnostics for employee invitation emails.
create or replace function public.fn_list_employee_email_delivery(p_property_id uuid)
returns table(
  invitation_id uuid,
  event_type text,
  recipient_email text,
  status text,
  attempts integer,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not (public.is_platform_owner() or public.is_hotel_admin(p_property_id)) then
    raise exception 'Only property administrators can view email delivery status.' using errcode = '42501';
  end if;
  return query
    select o.invitation_id, o.event_type, o.recipient_email, o.status,
           o.attempts, o.last_error, o.sent_at, o.created_at
    from public.employee_email_outbox o
    where o.property_id = p_property_id
    order by o.created_at desc
    limit 250;
end;
$function$;
revoke all on function public.fn_list_employee_email_delivery(uuid) from public, anon;
grant execute on function public.fn_list_employee_email_delivery(uuid) to authenticated;
notify pgrst, 'reload schema';
