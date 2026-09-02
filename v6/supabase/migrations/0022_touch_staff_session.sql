create or replace function public.touch_active_staff_session()
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.staff_sessions set verified_at = now() where user_id = auth.uid();
  return true;
end;
$$;
grant execute on function public.touch_active_staff_session() to authenticated;
