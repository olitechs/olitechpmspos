-- Live dashboard activity feed. Exposes only operational activity metadata,
-- never reservation rates, payment details, or other Back Office-sensitive fields.

create or replace function public.fn_recent_dashboard_activity(
  p_property_id uuid,
  p_limit integer default 8
) returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select
        r.created_at,
        'payment'::text as type,
        'POS payment recorded'::text as action,
        concat(
          coalesce(nullif(r.order_number,''),'POS sale'),
          ' · ', coalesce(nullif(r.table_number,''),'Walk-in'),
          ' · KES ', to_char(r.total, 'FM999G999G990D00')
        ) as detail
      from public.pos_receipts r
      where r.property_id = p_property_id
        and r.status = 'posted'

      union all

      select
        res.created_at,
        'reserve'::text as type,
        case
          when res.status = 'checked-in' then 'Guest checked in'
          when res.status = 'cancelled' then 'Reservation cancelled'
          else 'Reservation created'
        end as action,
        concat(
          coalesce(nullif(res.guest_name,''),'Guest'),
          ' · ', coalesce(res.arrival::text,''),
          ' → ', coalesce(res.departure::text,'')
        ) as detail
      from public.reservations res
      where res.property_id = p_property_id
    ) x
    limit greatest(1, least(coalesce(p_limit,8),25))
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.fn_recent_dashboard_activity(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
