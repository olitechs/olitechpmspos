# POS Order Screen V2 — Operational Acceptance Plan

**Branch:** `feat/pos-order-screen-v2`  
**PR:** #94  
**Status:** Prepared; real-property acceptance has not yet been executed.  
**Safety boundary:** Use a dedicated QA property, test menu items, test tables and non-production payment/printer integrations. Do not run destructive checks against live guest orders, live stock, or settled payments.

## 1. Test setup and evidence

Before testing, record:
- QA property name and property ID (do not paste secrets or guest data into the PR).
- Build/commit SHA and deployed QA URL.
- Tester, date/time and browser version.
- Active POS role and staff module assignment.
- Test table, test menu item IDs/SKUs, configured categories and Kitchen/Bar printer/KDS targets.
- Starting stock quantities and the corresponding stock-ledger snapshot for test products.

Capture screenshots for layout checks and redacted order/stock/KDS references for workflow checks. Never include PINs, payment credentials, guest personal data or access tokens.

## 2. Responsive screen acceptance

Run each case at 390×844 (phone), 768×1024 (tablet) and 1366×768 (desktop), plus one actual device if available.

| ID | Check | Expected result |
|---|---|---|
| UI-01 | Open an active QA table and load the order screen | Menu loads for the active property; no cross-property menu data is visible. |
| UI-02 | Open each configured category | Product tiles match the category and show configured name, price and SKU where present. |
| UI-03 | Return to categories | Back action returns to the category tiles without changing the current order. |
| UI-04 | Search by product name, SKU and category | Matching products appear; search is case/diacritic tolerant and supports multiple terms. |
| UI-05 | Search for a non-existent item | Empty-state message appears; current order remains unchanged. |
| UI-06 | Inspect low-stock and zero-stock products | Low-stock state is visible; zero-stock product cannot be added. |
| UI-07 | Add items and inspect order summary | Product quantity badges, line quantities, subtotal, VAT and total remain consistent. |
| UI-08 | Expand/collapse the mobile order sheet | Summary remains visible while collapsed; full ticket and actions are reachable when expanded. |
| UI-09 | Inspect desktop ticket | Ticket remains visible beside the menu; no mobile-only collapse hides it. |
| UI-10 | Use keyboard navigation and browser zoom | Search, category tiles, product tiles and order actions remain operable and readable. |

## 3. Menu configuration acceptance

Use a QA-only category and products:
1. Open POS Menu Manager as an authorized role.
2. Move a category up one position, save, close and reopen the manager.
3. Confirm the category order persists and the order screen refreshes after the menu-updated event.
4. Confirm product counts and Kitchen/Bar production-center labels remain accurate.
5. Verify a second QA property retains its own independent category ordering.
6. Confirm a role without menu-management permission cannot perform unauthorized edits.

Do not rename, merge, deactivate or delete production categories during this acceptance run. Those operations are outside this change's scope.

## 4. Order lifecycle and kitchen/bar routing

Use a fresh QA table for each scenario:
- Add a Kitchen item and a Bar item; confirm each order line retains its production center.
- Send the first order. Confirm one ticket reaches the expected Kitchen/Bar destination and the table session records sent lines.
- Add another item and send again. Confirm only newly added/unsent lines are fired; previously sent lines are not duplicated.
- Retry the send action with no new lines. Confirm the user receives the existing no-new-items feedback and no duplicate ticket is created.
- Test an item with required modifiers and one with optional modifiers. Confirm required selections are enforced and modifier price deltas appear on the line and bill.
- Test printer/KDS unavailability in the QA environment. Confirm the existing error/fallback path is visible and order/session state is not silently reported as printed.
- Refresh the browser and return to the QA table. Confirm the existing table session and order lines hydrate correctly.

## 5. Voids, table movement and billing

- Send a QA item, then attempt to reduce/remove the sent item. Confirm the existing reason and manager-approval flow is required and the control-void record is created.
- Move an unsettled QA order to an empty table. Confirm the order and session move together and the source table is released.
- Join/transfer only using QA tables; confirm both sessions and order numbers remain consistent with the existing transfer rules.
- Request the bill and confirm the bill screen shows the same lines, modifiers, tax and total.
- Exercise each payment method only in an approved test/sandbox configuration. Verify payment result, receipt output, table settlement and cashier transaction record.
- Test room-charge posting only with a designated QA guest/room and verify the folio entry and POS settlement are consistent.
- Verify a settled order cannot be accidentally paid twice.

## 6. Authoritative inventory ledger checks

These checks require a disposable QA property and products with known stock balances:
1. Record opening stock and latest stock movement for a mapped QA product.
2. Complete one QA sale containing a mapped stock item.
3. Verify the stock deduction is posted through the existing stock adjustment/ledger path and the movement reference identifies the POS sale.
4. Confirm the resulting stock balance matches the expected quantity and the POS availability display refreshes as designed.
5. Test an unmapped menu item in QA. The sale/inventory workflow must surface the existing missing-mapping error rather than silently skipping the deduction.
6. Confirm the same product ID in another property is not read or modified by this property's order.

Do not simulate a stock shortage by editing live quantities. Do not issue repeated sales just to test the deduction; restore the QA fixture through the approved test reset procedure.

## 7. Shift, receipt and reconciliation checks

- Open a QA shift with an authorized cashier.
- Complete a small set of QA transactions using distinct payment methods.
- Confirm receipt contents, order reference, table, items, tax, totals and property branding.
- Confirm cashier totals and payment-method breakdown match the test transactions.
- Confirm Shift Report totals and transaction references reconcile with the same QA set.
- Close the QA shift and confirm the existing close-shift permission rules and summary.
- Verify a non-authorized role cannot close the shift or access restricted manager controls.

## 8. Tenant and authorization checks

The isolated PostgreSQL regression workflow already covers owner access, cross-property denial, non-POS member denial, unrelated staff-session denial, allowed front-desk access, explicit POS-module assignment, missing JWT identity and trusted service-role access.

On the deployed QA app, additionally verify:
- Authorized user sees only the selected property's categories and products.
- Switching to another property refreshes menu data and does not retain the previous property's menu.
- A non-POS role cannot call the menu RPC successfully.
- Menu Manager actions remain restricted according to the app's existing permissions.

## 9. Release decision record

Do not mark this PR operationally accepted until the following have named evidence:
- [ ] Phone, tablet and desktop layout checks.
- [ ] Category ordering persistence and property isolation.
- [ ] Kitchen/Bar ticket routing and KDS/printer fallback.
- [ ] Modifier, repeat-send and control-void workflows.
- [ ] Table transfer/join and session persistence.
- [ ] Payment, receipt and room-charge QA.
- [ ] Stock ledger deduction and missing-mapping failure.
- [ ] Cashier reconciliation and Shift Report.
- [ ] QA property authorization checks.

**Current limitation:** repository CI verifies builds, static contracts, isolated PostgreSQL authorization and SKU/tenant regression. It does not prove that a real property's printer hardware, KDS, payment terminal, room folio, live inventory or cashier shift works end-to-end. Those checks require the QA property and integrations described above.
