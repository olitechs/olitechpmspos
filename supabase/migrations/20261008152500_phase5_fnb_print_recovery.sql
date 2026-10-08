-- Phase 5 — F&B production printing and recovery
-- Durable property-scoped print queue for KOT/BOT, voids, receipts, refunds and shift reports.

create table if not exists public.fnb_print_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  printer_id uuid references public.property_printers(id) on delete set null,
  assignment_type text not null,
  job_type text not null,
  copy_type text,
  title text,
  content_html text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','printing','printed','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  retry_of uuid references public.fnb_print_jobs(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  last_attempt_at timestamptz
);

create index if not exists fnb_print_jobs_property_created_idx on public.fnb_print_jobs(property_id,created_at desc);
create index if not exists fnb_print_jobs_recovery_idx on public.fnb_print_jobs(property_id,status,created_at desc);
create index if not exists fnb_print_jobs_printer_idx on public.fnb_print_jobs(printer_id,created_at desc);

alter table public.fnb_print_jobs enable row level security;
drop policy if exists fnb_print_jobs_select on public.fnb_print_jobs;
create policy fnb_print_jobs_select on public.fnb_print_jobs for select to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists fnb_print_jobs_insert on public.fnb_print_jobs;
create policy fnb_print_jobs_insert on public.fnb_print_jobs for insert to authenticated
with check (public.is_platform_owner() or public.is_member_of_property(property_id));
drop policy if exists fnb_print_jobs_update on public.fnb_print_jobs;
create policy fnb_print_jobs_update on public.fnb_print_jobs for update to authenticated
using (public.is_platform_owner() or public.is_member_of_property(property_id))
with check (public.is_platform_owner() or public.is_member_of_property(property_id));

revoke all on public.fnb_print_jobs from anon;
grant select,insert,update on public.fnb_print_jobs to authenticated;

alter publication supabase_realtime add table public.fnb_print_jobs;
alter publication supabase_realtime add table public.property_printers;
alter publication supabase_realtime add table public.printer_assignments;
alter publication supabase_realtime add table public.print_logs;

alter table public.printer_assignments drop constraint if exists printer_assignments_assignment_type_check;
alter table public.printer_assignments add constraint printer_assignments_assignment_type_check
check (assignment_type in ('food_orders','drinks_orders','void_food_orders','void_drinks_orders','unsettled_bills','final_receipts','reports','shift_reports','refund_slips'));

create or replace function public.fn_update_fnb_print_job(
  p_property_id uuid,p_job_id uuid,p_status text,p_error_message text default null,p_printer_id uuid default null
) returns public.fnb_print_jobs
language plpgsql security invoker set search_path=public
as $$
declare v_row public.fnb_print_jobs;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_status not in ('queued','printing','printed','failed','cancelled') then raise exception 'Invalid print job status.'; end if;
  update public.fnb_print_jobs
  set status=p_status,error_message=p_error_message,printer_id=coalesce(p_printer_id,printer_id),
      attempts=case when p_status='printing' then attempts+1 else attempts end,
      last_attempt_at=case when p_status='printing' then now() else last_attempt_at end,
      printed_at=case when p_status='printed' then coalesce(printed_at,now()) else printed_at end
  where id=p_job_id and property_id=p_property_id
  returning * into v_row;
  if v_row.id is null then raise exception 'Print job not found.'; end if;
  return v_row;
end;
$$;

revoke all on function public.fn_update_fnb_print_job(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.fn_update_fnb_print_job(uuid,uuid,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
