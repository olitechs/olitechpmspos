# Stock Authorization and Entitlement Rules — Implementation Addendum
Date: 2026-11-15
Status: design clarification; not deployed.

## Why a single unconditional Stores gate is incorrect

The product requirement is:
- If the property has the Stores entitlement, eligible stock events must post to inventory through the authoritative stock writer.
- If the Stores entitlement is absent, POS and folio financial operations must continue to work, but they must not deduct stock.
- Store-only operations (manual adjustment, wastage, count approval, receiving, transfer, production and manual usage) must remain denied without Stores entitlement and the relevant staff/property capability.

Therefore the internal writer must not blindly call `can_store_write` for every caller. POS cashiers/waiters can be authorized to settle POS sales without having Store module access. An unconditional Stores role gate would break valid POS sales when the Store module is enabled/disabled independently.

## Required operation-aware authorization contract

Separate three decisions:

1. **Can the business operation proceed?**
   - POS sale: use the existing POS/cashier/shift authorization. Do not make Store entitlement a prerequisite for posting the receipt/payment.
   - Folio charge/payment: use the existing folio role and reservation checks.
   - Store operation: require Store subscription/module access and an allowed Store action role.

2. **Should this operation post stock?**
   - POS/folio stock-linked line: if the Store entitlement is absent, skip inventory movement but keep the financial/operational transaction valid.
   - POS/folio stock-linked line: if Store entitlement is present, post stock exactly once through the writer.
   - Store-only operation: no Store entitlement means deny the operation; do not silently accept an unposted adjustment/receipt/count/transfer.

3. **May this actor perform this stock action?**
   - For Store-only operations, use `can_store_write(property_id, category)` or a stricter action-specific helper after confirming exact role and active-session behavior.
   - For POS stock posting, validate the POS operation actor through the POS/cashier permission path, then use an internal-only writer that cannot be invoked directly by API clients.
   - For folio stock posting, validate the folio action and ensure the stock-linked line is an authorized product issue; the financial folio charge remains independent when Stores is not entitled.

## Live helper behavior inspected

- `can_store_write(property_id, category)` requires `fn_subscription_module_allowed(property_id,'store')`, `fn_staff_module_access(property_id,'store')`, and one of the Store-capable staff/property roles.
- Staff role paths include `hotel_admin`, `super_admin`, `store_manager`, `housekeeping_supervisor`; `fb_manager` is category-limited to F&B; property roles include owner/admin/manager/storekeeper when there is no current staff role.
- `current_staff_role` only returns an active staff session verified within the last 30 minutes. `fn_staff_module_access` separately reads active staff membership/assigned modules.
- This is suitable as a Store-operation gate only after role/session edge cases are tested. It is not the POS cashier authorization helper.

## Implementation details

- Make the internal writer non-callable by `anon` and `authenticated`; only trusted business RPCs call it.
- The business RPC decides whether stock posting is enabled for that source event. Avoid silently catching authorization failures or insufficient-stock errors when the Store entitlement is active.
- When Store entitlement is absent, record enough audit metadata on the POS/folio event to explain that stock was not tracked due to module entitlement, without inserting a fake zero-quantity stock movement.
- Keep the configured negative-stock policy in effect when Store is enabled.
- Do not let a POS cashier or folio-only role call Store adjustment/receiving/count/transfer RPCs merely because they can settle a sale or post a folio charge.

## Regression cases

- Store enabled + authorized cashier: POS sale succeeds and stock posts exactly once.
- Store disabled + authorized cashier: POS sale and payment succeed; no stock movement is written.
- Store disabled + Storekeeper: Store-only adjustment/GRN/count/transfer is denied.
- Store enabled + cashier without Store permission: POS sale can proceed and stock is posted through the internal trusted path; cashier still cannot use Store-only RPCs.
- Store enabled + unauthorized user: POS and Store operations follow their separate authorization rules and fail appropriately.
- Folio financial charge without Stores: succeeds without stock deduction.
- Folio stock-linked charge with Stores: stock posts once only after product mapping and physical issue semantics are confirmed.
