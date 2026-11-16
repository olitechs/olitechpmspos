# ADR-0001: The route table lives in `src/routes/AppRoutes.jsx`

Date: 2026-11-15. Status: Accepted.

## Context

`src/App.jsx` held ~70 imports, the entire 112-route tree, auth guards, page
skeletons and wrapper components in one file. Route audits
(`scripts/check-links.mjs`, `scripts/audit-links.mjs`) and six contract tests
parse the route file's source text as the source of truth for declared routes.

## Decision

- `src/App.jsx` is the application shell only: the `isSupabaseConfigured`
  gate, `QueryClientProvider`, `Router`, `ScrollToTop`, `Toaster`, and the
  `AppRoutes` import.
- The full route tree, guards (`PublicRoute`, `ProtectedRoute`,
  `LegacySystemSettingsRedirect`), page skeletons (`PageSkeleton`,
  `AuthLoading`) and route-local wrappers live in
  `src/routes/AppRoutes.jsx`.
- Every new route is added to `src/routes/AppRoutes.jsx` so the link auditors
  and route contract tests keep verifying it.

## Consequences

- The auditors and `navigationRouting.test.js`,
  `frontOfficeWorkflows.test.mjs`, `front_office_workspace_contract.test.mjs`
  and `pos_shift_access_pin_contract.test.mjs` read
  `src/routes/AppRoutes.jsx` instead of `src/App.jsx`.
- Behaviour is unchanged: same components, same nesting, same guards.
