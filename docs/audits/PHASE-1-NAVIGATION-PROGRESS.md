# Phase 1 — Navigation and shell remediation progress

**Branch:** `phase-1-navigation-shell`  
**Status:** implementation slice committed; verification and phase acceptance remain open  
**Production impact:** none; no deployment or database operation was performed

## Changes in this slice

- Workspace tabs stay in the current browser tab instead of forcing new tabs.
- Workspace tabs scroll horizontally on narrow screens rather than expanding the page width.
- Route normalization now removes trailing slashes (except at `/`) and query/hash suffixes for active-navigation comparisons.
- The package entitlement map uses the canonical `stores` workspace ID, matching `MAIN_NAV`; regression coverage checks the affected package tiers.
- The legacy sidebar's **Access rights** item now points to `/backoffice/employees/access-rights`, distinct from Employee list.
- The shared shell closes the mobile sidebar with Escape.
- Added static architecture smoke tests for navigation destinations, workspace shell ownership, the full-screen Room Planner exception, embedded legacy navigation suppression, and trailing-slash handling.

## Verification not yet claimed

The GitHub connector could not execute the Node test suite locally. The repository's current validation workflows are configured for `main` and pull requests targeting `main`; no PR has been opened from this branch because Phase 0 remains open and its audit/remediation commits must not be mixed into a Phase 1 PR.

Before accepting this phase:
1. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test:architecture`, `npm run check:contrast`, and `npm run build` against the exact branch head.
2. Add/run real browser smoke checks at 1440px, 1024px, and 390px for workspace links, direct routes, trailing slashes, back/forward, mobile open/close/Escape, role filtering, and the Room Planner full-screen exception.
3. Verify every navigation destination renders its intended page content and exactly one intended shell.
4. Resolve or explicitly accept the remaining Phase 0 gate blockers before promotion: the migration source reconciliation, isolated browser tests, and unexecuted local test suite.

Do not merge or deploy based on static source assertions alone.
