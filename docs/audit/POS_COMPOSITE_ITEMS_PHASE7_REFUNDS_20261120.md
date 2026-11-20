# POS composite items — Phase 7: refunds and void reversals

Date: 20 November 2026

## What changed

- Composite stock-consumption movements are linked to the exact POS receipt after the receipt row is inserted. The recipe consumer passes its movement IDs through a transaction-local PostgreSQL setting; the receipt trigger consumes and clears that setting immediately.
- Added `fn_reverse_pos_composite_stock`, which accepts receipt line indexes (1-based) and menu-unit refund quantities. It calculates each component reversal from the original movement snapshot and original receipt-line quantity, not from the current recipe. Recipe edits after the sale therefore cannot change the amount restored.
- Partial refunds cannot exceed the unrefunded component balance. Duplicate line indexes in a single request are rejected, and the refund action is written to the existing audit log.\n- Important boundary: this RPC reverses composite component inventory only. It does not issue money, alter payment allocations, or recalculate receipt totals; the financial refund must be handled by the existing authorized payment/refund workflow. Each component restoration is a positive stock movement linked to its original movement through `reversal_of_id`, with receipt ID, original line key, recipe version, unit, cost, reason and idempotency key preserved.
- Repeated refund requests with the same idempotency key do not restore stock twice.
- `fn_void_pos_receipt` now restores only the remaining unrefunded composite component balance before marking the receipt void. The stock reversal and receipt status update are in the same transaction.
- Existing folio-charge protection is retained: receipts with a folio charge still require the folio charge to be reversed first.
- Property-scoped receipt permission checks remain enforced through `receipts.void`; stock movements and product updates are scoped to the same property.

## Wastage scope decision

No wastage RPC or UI was added in this phase. The live permission catalog currently exposes `receipts.void` but does not expose a stock-wastage permission. Reusing receipt-void permission for wastage would grant the wrong authority. A separate wastage workflow must first define a manager/stockkeeper permission and approval policy, then record wastage as its own negative stock movement with reason, actor and idempotency key.

## Validation and deployment

- Added source-contract tests for receipt linkage, partial quantity calculation, over-refund protection, idempotency, reversal ledger links, full void integration and property permission checks.
- These tests are static contract tests; they do not prove live database execution or concurrent refund behavior.
- Migration: `20261120110000_phase7_composite_refunds_and_voids.sql`.
- Migration remains on the feature branch and has not been applied to production.
- Before merge, run the full architecture suite and apply all feature migrations to an isolated PostgreSQL/Supabase test database containing the real relevant schema. Verify partial refund, duplicate retry, over-refund rejection, full void after partial refund, direct-stock sale behavior, and folio-charge protection.
