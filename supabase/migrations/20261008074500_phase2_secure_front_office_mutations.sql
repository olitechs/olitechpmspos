-- Phase 2: secure core Front Office mutations.
revoke execute on function public.fn_check_in_reservation(uuid) from public;
revoke execute on function public.fn_check_out_room(uuid) from public;
revoke execute on function public.fn_walk_in_check_in(uuid, uuid, text, text, date, date, integer, numeric) from public;
grant execute on function public.fn_check_in_reservation(uuid) to authenticated;
grant execute on function public.fn_check_out_room(uuid) to authenticated;
grant execute on function public.fn_walk_in_check_in(uuid, uuid, text, text, date, date, integer, numeric) to authenticated;