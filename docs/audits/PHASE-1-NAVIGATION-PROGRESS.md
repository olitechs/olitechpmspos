# Phase 1 — Navigation and shell remediation progress

**Branch:** `phase-1-navigation-shell`  
**Status:** navigation implementation slice committed; CI gates pass on code head `a1f2ae82e4cf730f2e8e7bfedcc53a600a4cdb5f`; browser verification and phase acceptance remain open  
**Production impact:** none; no deployment or database operation was performed

## Changes in this slice

- Workspace tabs stay in the current browser tab instead of forcing new tabs.
- Workspace tabs scroll horizontally on narrow screens rather than expanding the page width.
- Route normalization now removes trailing slashes (except at `/`) and query/hash suffixes for active-navigation comparisons.
- The package entitlement map uses the canonical `stores` workspace ID, matching `MAIN_NAV`; regression coverage checks the affected package tiers.
- The legacy sidebar's **Access rights** item now points to `/backoffice/employees/access-rights`, distinct from Employee list.
- The shared shell closes the mobile sidebar with Escape.
- Added static architecture smoke tests for navigation destinations, workspace shell ownership, the full-screen Room Planner exception, embedded legacy navigation suppression, and trailing-slash handling.

## Remaining implementation item

- The standalone `/pos` route now uses `POSLayout` and embeds `POSApp`, preserving `POSContainer`'s floor/order/bill controls while using the shared global workspace switcher. The generic sidebar is hidden for this workspace to avoid a second unrelated navigation system. Browser verification is still required to confirm the POS controls, provider state, and narrow-screen layout behave as expected.

## Automated verification

GitHub Actions passed on code head `a1f2ae82e4cf730f2e8e7bfedcc53a600a4cdb5f`:
- ESLint
- TypeScript typecheck
- Architecture/navigation test suite (27 tests, including route and shell smoke checks)
- Theme contrast audit
- Vite production build
- Production QA workflow build/lint

An earlier CI run exposed a literal escaped newline in the route helper and then an overly broad route-test parser. Both were corrected; the passing runs above include those corrections. These are CI results, not proof of browser-level interaction behavior.

No PR has been opened from this branch because Phase 0 remains open and its audit/remediation commits must not be mixed into a Phase 1 PR.

Before accepting this phase:
1. Run real browser smoke checks at 1440px, 1024px, and 390px for workspace links, direct routes, trailing slashes, back/forward, mobile open/close/Escape, role filtering, and the Room Planner full-screen exception.
2. Verify every navigation destination renders its intended page content and exactly one intended shell; static source checks cannot prove page behavior.
3. Resolve or explicitly accept the remaining Phase 0 gate blockers before promotion: migration source reconciliation and isolated security regression tests.

Do not merge or deploy based on static source assertions alone.
