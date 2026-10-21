-- Candidate forward-only Phase 1 remediation.
-- Additive only: legacy sessions without a module are intentionally invalidated
-- and must re-authenticate with their PIN. Do not apply to production until the
-- schema-equivalent isolated regression matrix passes.
BEGIN;

ALTER TABLE public.staff_sessions
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS hard_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Existing rows have no reliable module scope. Expire them rather than guessing
-- a module or carrying forward a potentially over-privileged session.
UPDATE public.staff_sessions
SET expires_at = COALESCE(expires_at, verified_at),
    hard_expires_at = COALESCE(hard_expires_at, verified_at),
    revoked_at = COALESCE(revoked_at, now())
WHERE module IS NULL
   OR expires_at IS NULL
   OR hard_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS staff_sessions_active_property_idx
  ON public.staff_sessions(property_id, user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_staff_session_allows_module(
  p_property_id uuid,
  p_module text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_sessions ss
    JOIN public.staff s ON s.id = ss.staff_id
    JOIN public.properties p ON p.id = ss.property_id
    WHERE ss.user_id = auth.uid()
      AND ss.property_id = p_property_id
      AND lower(ss.module) = lower(trim(coalesce(p_module, '')))
      AND ss.revoked_at IS NULL
      AND ss.expires_at > now()
      AND ss.hard_expires_at > now()
      AND s.is_active IS TRUE
      AND s.property_id = ss.property_id
      AND p.status = 'active'
      AND lower(trim(coalesce(p_module, ''))) = ANY (
        SELECT lower(trim(module_name)) FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
      )
  );
$function$;


-- Module authorization must bind a PIN-selected staff identity to the module
-- stored in that same server-side session. Keep membership-only property-admin
-- access separate from staff-PIN access.
CREATE OR REPLACE FUNCTION public.fn_staff_module_access(
  p_property_id uuid,
  p_module text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role text;
  v_assigned text[];
  v_module text := lower(trim(coalesce(p_module, '')));
  v_has_session boolean;
BEGIN
  IF public.is_platform_owner() THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_member_of_property(p_property_id) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = p_property_id AND p.status = 'active' AND p.package <> 'none'
  ) THEN
    RETURN false;
  END IF;
  IF NOT public.fn_subscription_module_allowed(p_property_id, v_module) THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_sessions ss
    WHERE ss.user_id = auth.uid()
      AND ss.module IS NOT NULL
      AND ss.revoked_at IS NULL
      AND ss.expires_at > now()
      AND ss.hard_expires_at > now()
  ) INTO v_has_session;

  IF v_has_session THEN
    IF NOT public.fn_staff_session_allows_module(p_property_id, v_module) THEN
      RETURN false;
    END IF;
    SELECT s.role, s.assigned_modules
      INTO v_role, v_assigned
    FROM public.staff_sessions ss
    JOIN public.staff s ON s.id = ss.staff_id
    WHERE ss.user_id = auth.uid()
      AND ss.property_id = p_property_id
      AND ss.revoked_at IS NULL
      AND ss.expires_at > now()
      AND ss.hard_expires_at > now()
      AND s.is_active IS TRUE
      AND s.property_id = p_property_id
    LIMIT 1;
    IF v_role IS NULL THEN
      RETURN false;
    END IF;
    IF v_role IN ('super_admin', 'hotel_admin') THEN
      RETURN true;
    END IF;
    IF coalesce(array_length(v_assigned, 1), 0) > 0 THEN
      RETURN v_module = ANY (
        SELECT lower(trim(module_name))
        FROM unnest(v_assigned) AS assigned(module_name)
      );
    END IF;
    RETURN CASE v_role
      WHEN 'front_office_manager' THEN v_module = 'frontoffice'
      WHEN 'receptionist' THEN v_module IN ('frontoffice', 'pos')
      WHEN 'front_desk' THEN v_module IN ('frontoffice', 'pos')
      WHEN 'pos_staff' THEN v_module = 'pos'
      WHEN 'waiter' THEN v_module = 'pos'
      WHEN 'cashier' THEN v_module = 'pos'
      WHEN 'store_manager' THEN v_module = 'store'
      WHEN 'fb_manager' THEN v_module IN ('pos', 'store')
      WHEN 'housekeeping_supervisor' THEN v_module = 'frontoffice'
      ELSE false
    END;
  END IF;

  -- Email/password property membership remains a separate authority from a
  -- PIN-selected staff identity. Apply the property role's own module boundary.
  RETURN CASE public.property_role(p_property_id)
    WHEN 'owner' THEN v_module IN ('backoffice', 'frontoffice', 'pos', 'store')
    WHEN 'admin' THEN v_module IN ('backoffice', 'frontoffice', 'pos', 'store')
    WHEN 'manager' THEN v_module IN ('backoffice', 'frontoffice', 'pos', 'store')
    WHEN 'reception' THEN v_module IN ('frontoffice', 'pos')
    WHEN 'housekeeping' THEN v_module = 'frontoffice'
    ELSE false
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_role(p_property_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT s.role
  FROM public.staff_sessions ss
  JOIN public.staff s ON s.id = ss.staff_id
  JOIN public.properties p ON p.id = ss.property_id
  WHERE ss.user_id = auth.uid()
    AND ss.property_id = p_property_id
    AND ss.module IS NOT NULL
    AND ss.revoked_at IS NULL
    AND ss.expires_at > now()
    AND ss.hard_expires_at > now()
    AND s.is_active IS TRUE
    AND lower(ss.module) = ANY (
      SELECT lower(trim(module_name))
      FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
    )
    AND p.status = 'active'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.current_staff_id(p_property_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT s.id
  FROM public.staff_sessions ss
  JOIN public.staff s ON s.id = ss.staff_id
  JOIN public.properties p ON p.id = ss.property_id
  WHERE ss.user_id = auth.uid()
    AND ss.property_id = p_property_id
    AND ss.module IS NOT NULL
    AND ss.revoked_at IS NULL
    AND ss.expires_at > now()
    AND ss.hard_expires_at > now()
    AND s.is_active IS TRUE
    AND lower(ss.module) = ANY (
      SELECT lower(trim(module_name))
      FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
    )
    AND p.status = 'active'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.verify_staff_pin(
  p_property_id uuid,
  p_module text,
  p_pin_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.staff;
  v_module text := lower(trim(coalesce(p_module, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_member_of_property(p_property_id) OR public.is_platform_owner()) THEN
    RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501';
  END IF;
  IF v_module NOT IN ('frontoffice', 'pos', 'backoffice', 'store') THEN
    RAISE EXCEPTION 'Invalid module.' USING ERRCODE = '22023';
  END IF;

  SELECT st.* INTO s
  FROM public.staff st
  WHERE st.property_id = p_property_id
    AND st.is_active IS TRUE
    AND lower(v_module) = ANY (
      SELECT lower(trim(module_name))
      FROM unnest(coalesce(st.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
    )
    AND st.pin_hash = p_pin_hash
  ORDER BY st.id
  LIMIT 1;

  IF s.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'wrong_pin');
  END IF;

  UPDATE public.staff
  SET last_login = now(), updated_at = now()
  WHERE id = s.id;

  INSERT INTO public.staff_sessions
    (user_id, staff_id, property_id, verified_at, module, expires_at, hard_expires_at, revoked_at)
  VALUES
    (auth.uid(), s.id, s.property_id, now(), v_module, now() + interval '30 minutes',
     now() + interval '8 hours', NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET staff_id = EXCLUDED.staff_id,
      property_id = EXCLUDED.property_id,
      verified_at = EXCLUDED.verified_at,
      module = EXCLUDED.module,
      expires_at = EXCLUDED.expires_at,
      hard_expires_at = EXCLUDED.hard_expires_at,
      revoked_at = NULL;

  INSERT INTO public.staff_logs(property_id, staff_id, staff_name, module, action)
  VALUES (s.property_id, s.id, s.full_name, v_module, 'module_entry');

  RETURN jsonb_build_object(
    'ok', true,
    'staff', jsonb_build_object(
      'id', s.id, 'full_name', s.full_name, 'email', s.email,
      'role', s.role, 'assigned_modules', s.assigned_modules, 'avatar', s.avatar
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_active_staff_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.staff_sessions ss
  SET expires_at = LEAST(now() + interval '30 minutes', ss.hard_expires_at),
      verified_at = now()
  FROM public.staff s, public.properties p
  WHERE ss.user_id = auth.uid()
    AND ss.staff_id = s.id
    AND ss.property_id = p.id
    AND ss.revoked_at IS NULL
    AND ss.module IS NOT NULL
    AND ss.expires_at > now()
    AND ss.hard_expires_at > now()
    AND s.is_active IS TRUE
    AND s.property_id = ss.property_id
    AND p.status = 'active'
    AND lower(ss.module) = ANY (
      SELECT lower(trim(module_name))
      FROM unnest(coalesce(s.assigned_modules, ARRAY[]::text[])) AS assigned(module_name)
    );

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_active_staff_session()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.staff_sessions
  SET revoked_at = COALESCE(revoked_at, now()),
      expires_at = LEAST(COALESCE(expires_at, now()), now())
  WHERE user_id = auth.uid();

  RETURN true;
END;
$function$;


-- Normalize individual screen ids to the workspace-level subscription keys used by
-- Platform Admin package assignments. Preserve package-derived entitlements and the
-- dashboard landing-workspace exception from the existing production function.
-- Read-only access evaluation. Subscription creation/update remains in the explicitly authorized
-- platform lifecycle RPCs (approve_property, platform_set_property_package, platform_update_subscription).
create or replace function public.fn_subscription_access(
  p_property_id uuid,
  p_module text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.property_subscriptions;
  p public.properties;
  allowed boolean := false;
  v_entitlement_module text;
  v_enabled_modules text[];
begin
  if not (public.is_platform_owner() or public.is_member_of_property(p_property_id)) then
    raise exception 'Not authorized';
  end if;

  if public.is_platform_owner() then
    return jsonb_build_object('allowed',true,'reason','platform_owner');
  end if;

  select * into p from public.properties where id=p_property_id;
  if not found then
    return jsonb_build_object('allowed',false,'reason','property_not_found');
  end if;

  select * into s from public.property_subscriptions where property_id=p_property_id;

  if s.property_id is null then
    return jsonb_build_object(
      'allowed',false,'reason','subscription_not_configured',
      'status',null,'plan_code',null
    );
  end if;

  -- Preserve the production rule: active property + assigned package + active
  -- subscription is authoritative; trial/grace rules remain unchanged.
  if p.status='active' and p.package<>'none' and s.status='active' then
    allowed:=true;
  elsif s.status='trial' then
    allowed:=(s.trial_ends_at is null or s.trial_ends_at>=now());
  elsif s.status='past_due' then
    allowed:=(s.current_period_ends_at is null or s.current_period_ends_at>=now())
      or (s.grace_ends_at is not null and s.grace_ends_at>=now());
  elsif s.status='suspended' then
    allowed:=s.grace_ends_at is not null and s.grace_ends_at>=now();
  else
    allowed:=false;
  end if;

  -- Translate screen-level IDs to the canonical package entitlement keys.
  v_entitlement_module := case lower(trim(coalesce(p_module,'')))
    when 'frontoffice' then 'frontoffice'
    when 'front_office' then 'frontoffice'
    when 'pms' then 'frontoffice'
    when 'rooms' then 'frontoffice'
    when 'room-planner' then 'frontoffice'
    when 'room_planner' then 'frontoffice'
    when 'reservations' then 'frontoffice'
    when 'guests' then 'frontoffice'
    when 'folio' then 'frontoffice'
    when 'housekeeping' then 'frontoffice'
    when 'night-audit' then 'frontoffice'
    when 'night_audit' then 'frontoffice'
    when 'maintenance' then 'frontoffice'
    when 'laundry' then 'frontoffice'
    when 'pos' then 'pos'
    when 'cashier' then 'pos'
    when 'backoffice' then 'backoffice'
    when 'back_office' then 'backoffice'
    when 'reports' then 'backoffice'
    when 'booking-engine' then 'backoffice'
    when 'booking_engine' then 'backoffice'
    when 'settings' then 'backoffice'
    when 'employees' then 'backoffice'
    when 'customers' then 'backoffice'
    when 'store' then 'store'
    when 'stores' then 'store'
    when 'inventory' then 'store'
    when 'purchasing' then 'store'
    when 'recipes' then 'store'
    when 'transfers' then 'store'
    when 'channels' then 'store'
    when 'kitchen' then 'store'
    when 'kds' then 'store'
    when 'printers' then 'store'
    when 'pos-devices' then 'store'
    when 'pos_devices' then 'store'
    else lower(trim(coalesce(p_module,'')))
  end;

  -- Dashboard is a non-billable landing workspace, as in the existing production
  -- implementation. Unknown module keys remain denied rather than failing open.
  if allowed and v_entitlement_module='dashboard' then
    allowed:=true;
  elsif allowed and v_entitlement_module not in ('frontoffice','pos','backoffice','store') then
    allowed:=false;
  end if;

  -- A blank legacy allowlist follows the assigned package. Non-empty lists remain
  -- enforced, but legacy screen/workspace aliases are normalized before comparison.
  v_enabled_modules := coalesce(nullif(s.enabled_modules,'{}'::text[]), public.platform_package_modules(p.package));

  if allowed and v_entitlement_module <> 'dashboard'
     and not exists (
       select 1
       from unnest(coalesce(v_enabled_modules,'{}'::text[])) as enabled(module)
       where case lower(trim(enabled.module))
         when 'front_office' then 'frontoffice'
         when 'pms' then 'frontoffice'
         when 'rooms' then 'frontoffice'
         when 'room-planner' then 'frontoffice'
         when 'room_planner' then 'frontoffice'
         when 'reservations' then 'frontoffice'
         when 'guests' then 'frontoffice'
         when 'folio' then 'frontoffice'
         when 'housekeeping' then 'frontoffice'
         when 'night-audit' then 'frontoffice'
         when 'night_audit' then 'frontoffice'
         when 'maintenance' then 'frontoffice'
         when 'laundry' then 'frontoffice'
         when 'cashier' then 'pos'
         when 'back_office' then 'backoffice'
         when 'reports' then 'backoffice'
         when 'booking-engine' then 'backoffice'
         when 'booking_engine' then 'backoffice'
         when 'settings' then 'backoffice'
         when 'employees' then 'backoffice'
         when 'customers' then 'backoffice'
         when 'stores' then 'store'
         when 'inventory' then 'store'
         when 'purchasing' then 'store'
         when 'recipes' then 'store'
         when 'transfers' then 'store'
         when 'channels' then 'store'
         when 'kitchen' then 'store'
         when 'kds' then 'store'
         when 'printers' then 'store'
         when 'pos-devices' then 'store'
         when 'pos_devices' then 'store'
         else lower(trim(enabled.module))
       end = v_entitlement_module
     ) then
    allowed:=false;
  end if;

  return jsonb_build_object(
    'allowed',allowed,
    'status',s.status,
    'plan_code',s.plan_code,
    'reason',case when allowed then 'active' else 'subscription_required' end,
    'period_ends_at',s.current_period_ends_at,
    'trial_ends_at',s.trial_ends_at
  );
end;
$$;

revoke all on function public.fn_subscription_access(uuid,text) from public, anon;
grant execute on function public.fn_subscription_access(uuid,text) to authenticated, service_role;

notify pgrst,'reload schema';

-- Guard every existing RLS policy that branches on the selected staff role.
-- Keep membership-role branches unchanged; only the staff-session branch gains
-- an explicit module check. This avoids treating a recent PIN in one module as
-- authorization for another module.
DO $module_guard_policies$
DECLARE
  v_policy record;
  v_guard text;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'cashier_adjustments','cashier_shifts','folio_charges','payments',
        'pos_devices','pos_kitchen_orders','pos_printers','pos_receipts',
        'pos_shift_payments','pos_shifts','pos_table_sessions','pos_void_items',
        'printer_assignments','property_printers','property_settings','stores'
      ])
      AND (coalesce(qual, '') ILIKE '%current_staff_role%'
           OR coalesce(with_check, '') ILIKE '%current_staff_role%')
  LOOP
    v_guard := CASE
      WHEN v_policy.tablename IN ('folio_charges', 'payments')
        THEN 'public.fn_staff_module_access(\1, ''pos'') OR public.fn_staff_module_access(\1, ''backoffice'')'
      WHEN v_policy.tablename = 'stores'
        THEN 'public.fn_staff_module_access(\1, ''store'')'
      WHEN v_policy.tablename = 'property_settings'
        THEN 'public.fn_staff_module_access(\1, ''backoffice'')'
      ELSE 'public.fn_staff_module_access(\1, ''pos'')'
    END;

    v_using := CASE WHEN v_policy.qual IS NULL THEN NULL ELSE
      regexp_replace(
        v_policy.qual,
        'current_staff_role\(([^()]*)\)',
        '(CASE WHEN (' || v_guard || ') THEN current_staff_role(\1) ELSE NULL END)',
        'g'
      ) END;
    v_check := CASE WHEN v_policy.with_check IS NULL THEN NULL ELSE
      regexp_replace(
        v_policy.with_check,
        'current_staff_role\(([^()]*)\)',
        '(CASE WHEN (' || v_guard || ') THEN current_staff_role(\1) ELSE NULL END)',
        'g'
      ) END;

    v_sql := format('ALTER POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
    IF v_policy.qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_using);
    END IF;
    IF v_policy.with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;
    EXECUTE v_sql;
  END LOOP;
END;
$module_guard_policies$;

-- Close the remaining high-risk RPC tenant gaps identified in the live audit.
-- Public booking configuration is intentionally anonymous, but only for active
-- properties whose booking engine is explicitly enabled.
CREATE OR REPLACE FUNCTION public.fn_public_booking_engine_config(p_property_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $booking_config$
  SELECT jsonb_build_object(
    'property_id', p.id,
    'name', p.name,
    'currency', COALESCE(s.currency, p.currency, 'USD'),
    'terms', s.terms,
    'cancellation_policy', s.cancellation_policy,
    'payment_instructions', s.payment_instructions
  )
  FROM public.properties p
  JOIN public.booking_engine_settings s
    ON s.property_id = p.id
   AND s.enabled IS TRUE
  WHERE p.id = p_property_id
    AND p.status = 'active';
$booking_config$;

-- Never trust a caller-supplied property UUID by itself. Staff PIN access must
-- pass the selected module/session/entitlement check; email property membership
-- is evaluated by the same server-side module authorization helper.
CREATE OR REPLACE FUNCTION public.fn_list_pos_menu(p_property_id uuid)
RETURNS TABLE(
  id uuid, sku text, name text, category text, unit text,
  current_stock numeric, min_stock numeric, selling_price numeric,
  production_center text, pos_sort integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $pos_menu$
  SELECT p.id, p.sku, p.name,
         COALESCE(NULLIF(p.pos_category, ''), p.category),
         p.unit, p.current_stock, p.min_stock, p.selling_price,
         p.production_center, p.pos_sort
  FROM public.products p
  WHERE p.property_id = p_property_id
    AND p.pos_enabled IS TRUE
    AND p.pos_active IS TRUE
    AND (
      auth.role() = 'service_role'
      OR public.fn_staff_module_access(p_property_id, 'pos') IS TRUE
    )
  ORDER BY COALESCE(NULLIF(p.pos_category, ''), p.category), p.pos_sort, p.name;
$pos_menu$;

CREATE OR REPLACE FUNCTION public.fn_current_pos_shift(p_property_id uuid)
RETURNS public.pos_shifts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $pos_shift$
  SELECT s.*
  FROM public.pos_shifts s
  WHERE s.property_id = p_property_id
    AND s.status = 'open'
    AND s.date = (now() AT TIME ZONE 'Africa/Nairobi')::date
    AND (
      auth.role() = 'service_role'
      OR public.fn_staff_module_access(p_property_id, 'pos') IS TRUE
    )
  ORDER BY s.opened_at DESC
  LIMIT 1;
$pos_shift$;

-- Property registration uses ensure_my_pending_property() and trusted
-- SECURITY DEFINER signup/admin routines as its entry points. Direct client
-- execution of this low-level helper is unnecessary and allowed cross-user
-- disclosure in the live audit; nested owner-context calls remain available.
REVOKE ALL ON FUNCTION public.create_pending_property_for_user(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_property_for_user(uuid, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.fn_public_booking_engine_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_public_booking_engine_config(uuid)
  TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_list_pos_menu(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_list_pos_menu(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_current_pos_shift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_current_pos_shift(uuid) TO authenticated, service_role;

-- Ensure only authenticated callers can establish, refresh, or revoke their
-- own staff session. Internal helpers are callable by authenticated policies.
REVOKE ALL ON FUNCTION public.verify_staff_pin(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_staff_pin(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.touch_active_staff_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_active_staff_session() TO authenticated;
REVOKE ALL ON FUNCTION public.clear_active_staff_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_active_staff_session() TO authenticated;
REVOKE ALL ON FUNCTION public.fn_staff_session_allows_module(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_staff_session_allows_module(uuid, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_staff_module_access(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_staff_module_access(uuid, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.current_staff_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_staff_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff_role(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_staff_id(uuid) TO anon, authenticated;

COMMIT;
