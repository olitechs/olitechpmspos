# POS Composite Items — Phase 5 Availability, Alerts and History

**Status:** Implemented on the composite-items feature branch; validation pending.  
**Migration:** `20261120100000_phase5_composite_stock_availability.sql`

## Delivered

### Component-aware availability
- Adds a property-scoped RPC that expands active, product-linked recipes and calculates each component's required quantity per one sellable menu item.
- Calculates the maximum sellable quantity constrained by each component's current stock.
- Returns component status as available, low stock or out of stock.
- The POS loads this data with its menu and shows component-low/component-out badges.
- Composite menu tiles are disabled when any required component cannot cover one sale. Low-stock components remain sellable but are visibly warned.

### Low-stock alert lifecycle
- Adds a product trigger that synchronizes active low-stock/out-of-stock alerts whenever stock or minimum threshold changes.
- Resolves stale alerts when stock recovers or the alert state changes.
- Reconciles existing products once during migration.
- Keeps expiry alerts untouched.

### Component movement history
- Adds a property-scoped, bounded history RPC for component movements originating from composite POS sales.
- Includes component, quantity/base unit, unit cost, recipe version, reason and timestamp.
- Adds an index supporting the history query.
- Exposes inventory service methods for availability and history.

## Boundaries

- No stock is changed by the availability RPC.
- No production migration has been applied.
- No changes to receipt, refund or wastage flows.
- Availability is an advisory menu snapshot; Phase 4 sale-time stock validation remains authoritative and must run inside the checkout transaction.
- Existing low-stock alerts and expiry alerts are retained.

## Validation required

- Phase 2–5 architecture contract tests, full architecture suite, lint, typecheck and production build.
- Disposable database tests for stock crossing min threshold, stock recovery, zero stock, multiple components limiting sellable quantity, property isolation, history pagination/limit and sale rollback.
- Verify cashier POS warning behaviour with real authorized accounts before production release.
