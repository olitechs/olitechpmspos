# Phase 0 — Forward Remediation Status

**Date:** 2026-10-11  
**Branch:** `audit/phase-0-baseline`

## Source-controlled remediation added

Added `supabase/migrations/20261011120000_phase0_rpc_tenant_guard_remediation.sql`.

This is a **new forward migration draft**, not a reconstruction or replacement for any of the six historical ledger entries. It addresses two authorization gaps previously confirmed during read-only audit:

1. `public.fn_list_pos_menu(uuid)` now checks platform-owner/property membership before returning rows for the supplied property ID.
2. `public.create_pending_property_for_user(uuid,text,text,text)` now requires the authenticated user ID to match `p_user_id`, except for trusted service-role JWT calls.

The migration retains authenticated access for these workflows, explicitly removes the anonymous/public EXECUTE grants, and does not apply blanket grant revocations to unrelated SECURITY DEFINER functions.

## Deployment status and required gates

- **Not applied to Supabase.** Only the repository file was committed.
- No live schema or data was changed.
- No production migration was replayed.
- No new Supabase branch was created.
- The six historical ledger/source mappings remain a separate provenance question and must not be marked closed by this new migration.

Before deployment, validate in a local/disposable database with two property users and a service-role workflow:
- member can list their own property's enabled POS menu;
- non-member cannot list another property's menu;
- platform owner can list an authorized property menu;
- authenticated user cannot create or retrieve a pending property for another user ID;
- own-user signup remains idempotent;
- trusted service-role signup workflow remains functional;
- grants are correct for `anon`, `authenticated`, and `service_role`.

After those tests pass, review the diff and apply only through the normal migration process with an approved backup/rollback plan. Do not use this new file to edit or falsify the historical migration ledger.
