-- Phase 5 — the print agent can claim queued jobs, and printer health is trustworthy
--
-- Before this migration only a browser could drive fnb_print_jobs: it inserted a
-- job, printed it and updated the row. If the POS workstation was switched off,
-- the job waited for a human to press retry in the app. The agent can now claim
-- queued work itself, with a lease so one workstation cannot hold a job forever.
--
-- Two rules keep this safe:
--   * A claim is exclusive: `for update skip locked` means two agents never take
--     the same job, even when they poll at the same instant.
--   * A lost lease is never re-sent automatically. An agent that dies mid-print
--     leaves the job `uncertain`, because the paper may already be printed. That
--     mirrors the local agent's own queue, so both sides agree on what is known.
--
-- These functions are service-role only. Workstation credentials are introduced
-- in Phase 7 (pairing); until then the agent's claim worker is opt-in and the
-- installer does not collect a service key.

begin;

-- 1. Widen the status set. `uncertain` is the honest outcome when bytes may have
--    reached the printer but no confirmation arrived.
alter table public.fnb_print_jobs drop constraint if exists fnb_print_jobs_status_check;
alter table public.fnb_print_jobs add constraint fnb_print_jobs_status_check
  check (status in ('queued','printing','printed','failed','cancelled','uncertain'));

-- 2. Claim bookkeeping. Additive only, so existing rows and writers keep working.
alter table public.fnb_print_jobs
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists uncertain_at timestamptz;

create index if not exists fnb_print_jobs_claim_idx
  on public.fnb_print_jobs(property_id, created_at)
  where status in ('queued','printing');

-- 3. The existing status RPC rejected `uncertain`, which would have made the new
--    state unreachable from the browser. Keep its shape and permissions.
create or replace function public.fn_update_fnb_print_job(
  p_property_id uuid,p_job_id uuid,p_status text,p_error_message text default null,p_printer_id uuid default null
) returns public.fnb_print_jobs
language plpgsql security invoker set search_path=public
as $$
declare v_row public.fnb_print_jobs;
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then raise exception 'Not allowed.'; end if;
  if p_status not in ('queued','printing','printed','failed','cancelled','uncertain') then raise exception 'Invalid print job status.'; end if;
  update public.fnb_print_jobs
  set status=p_status,error_message=p_error_message,printer_id=coalesce(p_printer_id,printer_id),
      attempts=case when p_status='printing' then attempts+1 else attempts end,
      last_attempt_at=case when p_status='printing' then now() else last_attempt_at end,
      printed_at=case when p_status='printed' then coalesce(printed_at,now()) else printed_at end,
      uncertain_at=case when p_status='uncertain' then now() else uncertain_at end
  where id=p_job_id and property_id=p_property_id
  returning * into v_row;
  if v_row.id is null then raise exception 'Print job not found.'; end if;
  return v_row;
end;
$$;

revoke all on function public.fn_update_fnb_print_job(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function public.fn_update_fnb_print_job(uuid,uuid,text,text,uuid) to authenticated;

-- 4. An expired lease means the agent stopped while holding the job. It may have
--    printed, so it becomes uncertain and is never re-queued automatically.
create or replace function public.fn_expire_fnb_print_leases(p_grace_seconds integer default 0)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_count integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Expiring print leases requires an agent credential.' using errcode='42501';
  end if;

  update public.fnb_print_jobs
  set status='uncertain',
      uncertain_at=now(),
      error_message='The print agent stopped before confirming this job. Check the paper, then reprint from the printer queue if it is missing.',
      claimed_by=null, claimed_at=null, lease_expires_at=null
  where status='printing'
    and lease_expires_at is not null
    and lease_expires_at < now() - make_interval(secs => greatest(0, coalesce(p_grace_seconds,0)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.fn_expire_fnb_print_leases(integer) from public,anon,authenticated;
grant execute on function public.fn_expire_fnb_print_leases(integer) to service_role;

-- 5. Claim a small batch of queued jobs for one agent.
create or replace function public.fn_claim_fnb_print_jobs(
  p_agent_id text,
  p_property_id uuid default null,
  p_limit integer default 3,
  p_lease_seconds integer default 120
) returns setof public.fnb_print_jobs
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_limit integer := greatest(1, least(coalesce(p_limit,3), 25));
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Print job claims require an agent credential.' using errcode='42501';
  end if;
  if p_agent_id is null or length(btrim(p_agent_id)) = 0 then
    raise exception 'Agent id is required.' using errcode='22023';
  end if;

  -- Settle abandoned work first, so this agent never claims a stale attempt.
  perform public.fn_expire_fnb_print_leases(0);

  return query
  with candidate as (
    select j.id
    from public.fnb_print_jobs j
    where j.status = 'queued'
      and (p_property_id is null or j.property_id = p_property_id)
    order by j.created_at
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.fnb_print_jobs j
    set status='printing',
        claimed_by=btrim(p_agent_id),
        claimed_at=now(),
        lease_expires_at=now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds,120), 900))),
        attempts=j.attempts + 1,
        last_attempt_at=now(),
        error_message=null
    from candidate c
    where j.id = c.id
    returning j.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.fn_claim_fnb_print_jobs(text,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.fn_claim_fnb_print_jobs(text,uuid,integer,integer) to service_role;

-- 6. Report the result of a claimed job. Only the claiming agent may complete it,
--    and only with an outcome the queue understands.
create or replace function public.fn_complete_fnb_print_job(
  p_job_id uuid,
  p_status text,
  p_error_message text default null,
  p_agent_id text default null
) returns public.fnb_print_jobs
language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_row public.fnb_print_jobs;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Completing a print job requires an agent credential.' using errcode='42501';
  end if;
  if p_status not in ('printed','failed','uncertain','cancelled') then
    raise exception 'A claimed print job can only be completed as printed, failed, uncertain or cancelled.' using errcode='22023';
  end if;

  update public.fnb_print_jobs
  set status=p_status,
      error_message=case when p_status='printed' then null else left(coalesce(p_error_message,''), 500) end,
      printed_at=case when p_status='printed' then coalesce(printed_at, now()) else printed_at end,
      uncertain_at=case when p_status='uncertain' then now() else uncertain_at end,
      claimed_by=null, claimed_at=null, lease_expires_at=null
  where id=p_job_id
    and (p_agent_id is null or claimed_by is null or claimed_by = btrim(p_agent_id))
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Print job not found or claimed by another agent.' using errcode='P0002';
  end if;

  insert into public.print_logs(property_id, printer_id, job_type, copy_type, status, error_message)
  values (v_row.property_id, v_row.printer_id, v_row.job_type, v_row.copy_type, p_status, v_row.error_message);

  return v_row;
end;
$$;

revoke all on function public.fn_complete_fnb_print_job(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.fn_complete_fnb_print_job(uuid,text,text,text) to service_role;

notify pgrst,'reload schema';

commit;
