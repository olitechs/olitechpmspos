-- Phase 7 — workstation pairing and a scoped agent credential
--
-- Phase 5 let the agent claim cloud print jobs, but only with a Supabase
-- service-role key. That key can read and write every table in the project, so
-- it has no place on a reception desk. This migration adds a per-workstation
-- credential instead:
--
--   1. A manager opens Settings → Printers while signed in and asks for a
--      pairing code (valid 10 minutes, single use).
--   2. The workstation exchanges that code for its own random secret, stored on
--      that PC only. The database stores md5(secret) — never the secret — so a
--      database reader cannot replay it.
--   3. Claim/complete calls authenticate by that secret and are hard-scoped to
--      the credential's property. No service role, no cross-property access.
--
-- The Phase 5 service-role functions remain for platform tooling; nothing about
-- them changes for existing deployments.

begin;

create table if not exists public.print_agent_credentials (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  token_hash text unique,
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  paired_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists print_agent_credentials_property_idx
  on public.print_agent_credentials(property_id, created_at desc);

alter table public.print_agent_credentials enable row level security;
-- No table policies: agents authenticate through the RPCs below, and staff read
-- the list through a membership-checked function. Nothing is exposed directly.

-- Only owners/admins/managers may pair a workstation.
create or replace function public.fn_create_print_agent_pairing(
  p_property_id uuid,
  p_name text
) returns table(credential_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_name text := coalesce(nullif(btrim(p_name), ''), 'POS computer');
  v_code text;
  v_id uuid;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if p_property_id is null then
    raise exception 'Property id is required.' using errcode = '22023';
  end if;
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.is_hotel_admin(p_property_id)
  ) then
    raise exception 'Only a manager can pair a print workstation.' using errcode = '42501';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'Workstation name is too long.' using errcode = '22023';
  end if;

  -- 8 characters from a 32-symbol alphabet: readable over the phone, and long
  -- enough that guessing inside the 10-minute window is not practical.
  v_code := translate(
    substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8),
    '0123456789abcdef',
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  );

  insert into public.print_agent_credentials(property_id, name, pairing_code_hash, pairing_expires_at, created_by)
  values (p_property_id, v_name, md5(v_code), v_expires, auth.uid())
  returning id into v_id;

  return query select v_id, v_code, v_expires;
end;
$$;

revoke all on function public.fn_create_print_agent_pairing(uuid,text) from public, anon;
grant execute on function public.fn_create_print_agent_pairing(uuid,text) to authenticated;

-- Called by the workstation, before it has any credential. The pairing code is
-- the only secret it presents, and it is single use with a short life.
create or replace function public.fn_redeem_print_agent_pairing(
  p_code text,
  p_token text
) returns table(credential_id uuid, property_id uuid, agent_name text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_row public.print_agent_credentials;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
begin
  if coalesce(auth.role(), '') <> 'anon' and coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Pairing requires a public agent key.' using errcode = '42501';
  end if;
  if char_length(v_code) < 6 then
    raise exception 'That pairing code is not valid. Check the code shown in OliTechs.' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    raise exception 'The workstation credential is malformed.' using errcode = '22023';
  end if;

  select * into v_row
  from public.print_agent_credentials c
  where c.pairing_code_hash = md5(v_code)
    and c.paired_at is null
    and c.revoked_at is null
    and c.pairing_expires_at > now()
  for update;

  if v_row.id is null then
    raise exception 'That pairing code is not valid or has expired. Ask a manager for a new code.' using errcode = '22023';
  end if;

  update public.print_agent_credentials
  set token_hash = md5(p_token),
      paired_at = now(),
      last_seen_at = now(),
      pairing_code_hash = null,
      pairing_expires_at = null
  where id = v_row.id;

  return query select v_row.id, v_row.property_id, v_row.name;
end;
$$;

revoke all on function public.fn_redeem_print_agent_pairing(text,text) from public;
grant execute on function public.fn_redeem_print_agent_pairing(text,text) to anon, authenticated;

-- Resolves a workstation secret to its credential, or raises. Every agent call
-- goes through this, so property scoping cannot be bypassed by parameters.
create or replace function public.fn_resolve_print_agent(p_token text)
returns public.print_agent_credentials
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.print_agent_credentials;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'This workstation is not paired. Pair it from Settings, Printers.' using errcode = '42501';
  end if;

  select * into v_row
  from public.print_agent_credentials c
  where c.token_hash = md5(p_token)
    and c.revoked_at is null
    and c.paired_at is not null;

  if v_row.id is null then
    raise exception 'This workstation credential is not recognised or has been revoked. Pair it again from Settings, Printers.' using errcode = '42501';
  end if;

  return v_row;
end;
$$;

revoke all on function public.fn_resolve_print_agent(text) from public, anon, authenticated;

-- Claim queued jobs for this workstation's property only.
create or replace function public.fn_print_agent_claim(
  p_token text,
  p_limit integer default 3,
  p_lease_seconds integer default 120
) returns setof public.fnb_print_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agent_credentials;
  v_limit integer := greatest(1, least(coalesce(p_limit, 3), 25));
begin
  v_agent := public.fn_resolve_print_agent(p_token);

  update public.print_agent_credentials set last_seen_at = now() where id = v_agent.id;

  -- Settle abandoned work for this property first: an expired lease may already
  -- be on paper, so it becomes uncertain and is never re-queued automatically.
  update public.fnb_print_jobs
  set status = 'uncertain',
      uncertain_at = now(),
      error_message = 'The print agent stopped before confirming this job. Check the paper, then reprint from the printer queue if it is missing.',
      claimed_by = null, claimed_at = null, lease_expires_at = null
  where property_id = v_agent.property_id
    and status = 'printing'
    and lease_expires_at is not null
    and lease_expires_at < now();

  return query
  with candidate as (
    select j.id
    from public.fnb_print_jobs j
    where j.status = 'queued'
      and j.property_id = v_agent.property_id
    order by j.created_at
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.fnb_print_jobs j
    set status = 'printing',
        claimed_by = v_agent.id::text,
        claimed_at = now(),
        lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 900))),
        attempts = j.attempts + 1,
        last_attempt_at = now(),
        error_message = null
    from candidate c
    where j.id = c.id
    returning j.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.fn_print_agent_claim(text,integer,integer) from public;
grant execute on function public.fn_print_agent_claim(text,integer,integer) to anon, authenticated;

create or replace function public.fn_print_agent_complete(
  p_token text,
  p_job_id uuid,
  p_status text,
  p_error_message text default null
) returns public.fnb_print_jobs
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agent_credentials;
  v_row public.fnb_print_jobs;
begin
  v_agent := public.fn_resolve_print_agent(p_token);

  if p_status not in ('printed','failed','uncertain','cancelled') then
    raise exception 'A claimed print job can only be completed as printed, failed, uncertain or cancelled.' using errcode = '22023';
  end if;

  update public.fnb_print_jobs
  set status = p_status,
      error_message = case when p_status = 'printed' then null else left(coalesce(p_error_message, ''), 500) end,
      printed_at = case when p_status = 'printed' then coalesce(printed_at, now()) else printed_at end,
      uncertain_at = case when p_status = 'uncertain' then now() else uncertain_at end,
      claimed_by = null, claimed_at = null, lease_expires_at = null
  where id = p_job_id
    and property_id = v_agent.property_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Print job not found for this workstation property.' using errcode = 'P0002';
  end if;

  insert into public.print_logs(property_id, printer_id, job_type, copy_type, status, error_message)
  values (v_row.property_id, v_row.printer_id, v_row.job_type, v_row.copy_type, p_status, v_row.error_message);

  return v_row;
end;
$$;

revoke all on function public.fn_print_agent_complete(text,uuid,text,text) from public;
grant execute on function public.fn_print_agent_complete(text,uuid,text,text) to anon, authenticated;

-- Management surface for Settings → Printers.
create or replace function public.fn_list_print_agent_credentials(p_property_id uuid)
returns table(id uuid, name text, paired_at timestamptz, last_seen_at timestamptz, revoked_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  return query
  select c.id, c.name, c.paired_at, c.last_seen_at, c.revoked_at
  from public.print_agent_credentials c
  where c.property_id = p_property_id
  order by c.created_at desc;
end;
$$;

revoke all on function public.fn_list_print_agent_credentials(uuid) from public, anon;
grant execute on function public.fn_list_print_agent_credentials(uuid) to authenticated;

create or replace function public.fn_revoke_print_agent_credential(p_property_id uuid, p_credential_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not (
    public.is_platform_owner()
    or public.property_role(p_property_id) in ('owner','admin','manager')
    or public.is_hotel_admin(p_property_id)
  ) then
    raise exception 'Only a manager can revoke a print workstation.' using errcode = '42501';
  end if;

  update public.print_agent_credentials
  set revoked_at = now(), token_hash = null
  where id = p_credential_id and property_id = p_property_id;

  -- Jobs this workstation was holding become uncertain rather than lost: it can
  -- no longer report on them, and paper may already have been printed.
  update public.fnb_print_jobs
  set status = 'uncertain',
      uncertain_at = now(),
      error_message = 'This workstation was unpaired before it reported the result. Check the paper, then reprint if it is missing.',
      claimed_by = null, claimed_at = null, lease_expires_at = null
  where property_id = p_property_id
    and status = 'printing'
    and claimed_by = p_credential_id::text;
end;
$$;

revoke all on function public.fn_revoke_print_agent_credential(uuid,uuid) from public, anon;
grant execute on function public.fn_revoke_print_agent_credential(uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
