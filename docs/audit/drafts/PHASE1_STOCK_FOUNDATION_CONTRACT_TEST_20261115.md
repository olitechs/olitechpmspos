# Phase 1 Stock Foundation — Contract Test Coverage

Date: 2026-11-15  
Status: test source committed; execution not yet verified in a checked-out runtime.

## Change made

Added `tools/inventory/phase1-stock-foundation.contract.test.mjs` and included it in `npm run test:architecture`.

The test reads the exact Phase 1 migration:
`supabase/migrations/20261115055500_phase1_stock_control_foundation.sql`.

It guards these source-level contracts:

- inventory unit and conversion tables plus the standard base units;
- product tracking, stock item type and base-unit columns;
- movement provenance, reversal and idempotency metadata/indexes;
- documented `warn_allow` / `block` negative-stock policy;
- product row locking, property membership check, untracked-product behavior and movement insertion in the shared writer;
- explicit scope boundary: Phase 1 is not yet the location-aware posting cutover, does not enforce Stores entitlement in the shared writer, and does not retire the default-location trigger.

## How to run

From the repository root:

```bash
npm run test:architecture
```

Or run only the new contract:

```bash
node --test tools/inventory/phase1-stock-foundation.contract.test.mjs
```

## What this does not prove

These are source-contract checks, not PostgreSQL behavior tests. They do not prove:
- migration replay against a clean schema;
- runtime authorization or RLS behavior;
- location/aggregate balance correctness;
- concurrent posting or idempotent retry behavior;
- POS, GRN, transfer, adjustment, wastage, count or refund correctness.

Those still require the production-equivalent disposable database and the existing runtime regression gate. The current Supabase preview branch is migration-failed, so it is not an acceptable substitute. Do not run the runtime SQL suite against production.

## Deployment safety

No production SQL, stock quantities, triggers, grants, or application workflows were changed by this test-only follow-up. The existing stock anomaly remains untouched pending physical stocktake.
