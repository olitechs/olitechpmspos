# ADR-0003: Dead-code removal requires a proven zero-reference audit

Date: 2026-11-15. Status: Accepted.

## Context

Phase 5 (architecture hygiene) includes dead-code removal. The repo rules
forbid deletion until "no imports remain, no route depends on it, no data
migration depends on it" is proven, and mark specific workflow files
(`Cashier.jsx`, `components/pos/*`, receipt/payment functionality,
`v6/`) as protected.

## Decision

A file may be deleted only when a mechanical scan shows:
1. no `import`/`from`/dynamic `import()` reference to its module name anywhere
   under `src/`, `tools/`, `scripts/`, `supabase/tests` (excluding `v6/`),
2. no route in `src/routes/AppRoutes.jsx` renders it,
3. no contract test reads its source text,
4. it is not on the AGENTS.md protected list.

## Applied in Phase 5 (2026-11-15)

Deleted after the audit:
`components/admin/Printers.jsx`, `components/admin/TableSetup.jsx`,
`components/pos/FitText.jsx`, `components/settings/PrintManager.jsx`,
`components/settings/PrinterGroupModal.jsx`, `components/ui/GoogleIcon.jsx`,
`components/ui/ProtectedRoute.jsx`, `components/ui/StatusLegend.jsx`,
`components/ui/ThemeToggle.jsx`, `components/ui/index.js`,
`data/modules/employeeStore.js`, `data/modules/inventoryStore.js`,
`hooks/use-size.jsx`, `services/printerGroupService.js`.

Deliberately kept despite zero component imports:
- `components/modules/Cashier.jsx` — on the protected list; `POSApp` redirects
  the legacy `cashier` module to the canonical POS shift workflow
  (`POSContainer initialTab="shifts"`), so the component is unused, but removal
  needs explicit owner approval.
- `services/printRoutingCore.js` — no component consumers but its test
  (`printRoutingCore.test.js`) is wired into `npm run test:architecture`;
  it is the pure-library contract for printer-group routing.
- `v6/` — untouched pending separate approval (OPEN_QUESTIONS #5).
