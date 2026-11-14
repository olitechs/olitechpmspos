# AUDIT.md — OliTechs PMS+POS (olitechpmspos)

Phase 0 audit report. Written **before any code changes** (except the skills installation and toolchain setup described below).
Branch: `audit/cleanup-and-ui` · Date: 2026-11-13 · Working dir: repo root.

**How this repo arrived here:** the working snapshot came from `olitechpmspos-main.zip` (a GitHub "Download ZIP" of `olitechs/olitechpmspos`, so it had no `.git`). I ran `git init`, made one import commit (`9f0dd4a`), created `audit/cleanup-and-ui` off it, and committed the skills install (`dd7d5e3`). Commit identity is local-only (`OliTechs Audit Agent <audit@olitechs.local>`) — change it before any push if you want different attribution.

---

## 0. Environment & toolchain (newly provisioned)

The machine had **no Git and no Node.js**. With your approval I installed via winget:

- Git for Windows 2.56.0.4 (`winget install --id Git.Git`)
- Node.js LTS v26.13.1 (`winget install --id OpenJS.NodeJS.LTS`)
- npm v11.20.0. Note: PowerShell execution policy blocks `npm.ps1`; I use `npm.cmd` (no policy change).

## 1. Stack detection (summary)

- **App:** Vite 6 + React 18 SPA (`type: module`), React Router 6, ~249 source files, no `src/assets`.
- **Styling:** Tailwind CSS 3.4 + shadcn/Radix UI + a custom token system in `src/index.css` ("Coastal Linen / OliTechs navy" light-only theme, enforced by `tools/design-system/check-coastal-linen.mjs` and `scripts/check-colors.mjs` inside `npm run lint`).
- **State/data:** TanStack React Query (`src/lib/query-client.js`), Zustand (`src/data/modules/employeeStore.js`), orchestration stores `src/data/PmsStore.jsx` (PMS) and `src/data/AppStore.jsx` (POS), React Hook Form + Zod (used once, printer groups).
- **Backend:** Supabase (Postgres + Auth + RLS + RPCs; 150 migration files; 2 Edge Functions: `print-proxy`, `platform-account-recovery`). Tenant isolation enforced in DB.
- **Print:** local Node print agent on `127.0.0.1:8631` (`tools/print-agent/print-agent-v2.js`, Windows installer/service scripts, extensive `node --test` suite) + ESC/POS payload builder shared with the `print-proxy` Edge Function + jsPDF/ExcelJS document exports.
- **Deploy targets:** Vercel (`vercel.json`), Docker/nginx (`Dockerfile`, `docker-compose*.yml`, `nginx/`), and `public/.htaccess` for Apache hosts.
- **Tests:** `node --test` suites: `test:reports` (12), `test:print-agent` (107), `test:architecture` (366). No browser/e2e tests.
- **Historical tree:** `v6/` is a duplicate legacy application (AGENTS.md protects it; excluded from this audit).

## 2. Skills installation (requested in Phase 0 step 3)

All four repos were cloned to a temp dir; READMEs read; **no install scripts were executed** (everything was copied manually per your rule):

| Repo | Status | Where |
|---|---|---|
| `nextlevelbuilder/ui-ux-pro-max-skill` | ✅ Installed — 7 skills copied from its `.claude/skills/` (self-contained: each has SKILL.md + data/references/scripts): `ui-ux-pro-max`, `design-system`, `design`, `ui-styling`, `brand`, `banner-design`, `slides` | `.opencode/skills/` |
| `elayadesign/ai-design-skills` | ✅ Installed — `landing-page-design`, `figma-designer` | `.opencode/skills/` |
| `bergside/awesome-design-skills` | ✅ Installed — all 67 registry skills, each with SKILL.md + DESIGN.md | `.opencode/skills/` |
| `emilkowalski/skills` | ✅ **Already installed** — the repo vendors 17 curated web-relevant skills in `.agents/skills/` (README there documents the curation; React Native/Swift skills deliberately excluded). OpenCode discovers `.agents/skills/` natively, so no copy made — a duplicate would collide IDs | `.agents/skills/` (vendored) |

Total: 76 skill folders in `.opencode/skills/` (all have SKILL.md) + 17 vendored. Verified installed: `76/76`.

⚠️ One runtime note: `ui-ux-pro-max`'s search script is Python 3 (stdlib only). **Python is not installed on this machine** (only the Microsoft Store stub). Say the word and I'll `winget install Python.Python.3.12`, or we use the skill's reference docs without the search CLI in Phase 2.

⚠️ The vendored `.agents/skills/landing-page-design` differs from elayadesign upstream (different hash). The freshly installed `.opencode/skills/landing-page-design` (upstream) takes precedence in OpenCode. Flagging in case the vendored copy was intentionally customized.

## 3. Regression baseline (Phase 0 step 4)

| Check | Result |
|---|---|
| `npm install` | ✅ 703 packages. Warnings: deprecated `rimraf@2`, `inflight@1`, `glob@7`, `fstream@1`, `uuid@8`, `lodash.isequal`, `recharts@2.15`, `eslint@9.39`. npm blocked 2 postinstall scripts (`core-js` banner script, `esbuild` install.js) — build works anyway; noted in case future tooling needs them. |
| `npm run lint` | ✅ PASS (eslint `--quiet` + Coastal Linen token check + color-token audit: "291 active files; color literals confined to src/index.css"). |
| `npm run typecheck` | ✅ PASS (`tsc -p jsconfig.json`, zero errors). |
| `npm run build` | ✅ PASS, 23.2s. ⚠️ Warnings: 2 chunks >500 kB — `index` 2.34 MB (gzip 663 kB) and `exceljs` 940 kB. Rollup suggests manualChunks. |
| `npm run test:reports` | ⚠️ **10 pass / 2 fail / 12 total** (details below). |
| `npm run test:print-agent` | ✅ 106 pass / 1 skip / 0 fail (2.4s). |
| `npm run test:architecture` | ✅ 365 pass / 1 skip / 0 fail (11s). |

**Baseline test failures (details):**

1. `src/services/reportDocumentEngine.test.mjs:56` — "generated PDFs use landscape…" fails with `spawnSync pdfinfo ENOENT`. The test shells out to **poppler binaries (`pdfinfo`/`pdftotext`) which aren't installed on this Windows machine** → environmental, not a code bug. I can install poppler for Windows if you want this suite green locally.
2. `src/services/reportDocumentEngine.test.mjs:107` — "generated Excel uses a combined branded summary…" asserts `FF0A3F4A` (old teal `#0A3F4A`) but the engine emits `FF101A35` (current brand navy `#101A35` = `--deep-lagoon`, verified in `src/index.css:16` and enforced by `check-coastal-linen.mjs`). **The test is stale; the engine is correct.** Fix = update the test expectation (Phase 3, one commit).

---

## 4a. Route & feature inventory

All routes live in `src/App.jsx`; nav models in `src/data/modules/navArchitecture.js` (workspace switcher + back-office/stores sidebars), `src/components/layout/FrontOfficeShell.jsx` (PMS sidebar), `src/data/modules/sidebarNavigation.js` (legacy standalone POS sidebar). A contract test (`src/data/modules/navigationRouting.test.js`) asserts every nav destination has a registered route — and passes.

**Public:** `/`, `/home`, `/signin`, `/signup`, `/login`, `/register` (auth), `/forgot-password`, `/reset-password`, `/terms` + `/privacy` (stub page `LegalComingSoon`), `/404` + `*` → PageNotFound. ✅ working.

**Back Office** (`/backoffice/*`, guard `ProtectedRoute app="backoffice"`, layout `AppShell`): dashboard; items (list/categories/modifiers/discounts); reports (sales/inventory/employees/shifts); inventory (purchase-orders, transfers, adjustments, counts, productions, history, valuation, suppliers); stores; pos-devices; printers; employees (list/access-rights/timecards/hours); customers; integrations (BookingEngine); settings dispatcher (`/backoffice/settings/:slug`, 12 slugs handled); help. ⚠️ `/backoffice/reports/employees` renders a "not yet implemented" placeholder (ModuleStatusPage) — by design, but listed.

**Front Office / PMS** (`/frontoffice/*`, layout `FrontOfficeShell`): dashboard, room-planner (Rooms + RoomPlanner), rooms, reservations, folio, housekeeping, night-audit, channels, structure, manuals, check-in group (arrivals/in-house/departures/walk-in/express-checkout/registration-cards), statistics/:report (7 placeholder reports), services (housekeeping/room-charges live; minibar/laundry/maintenance/guest-requests → placeholders). ✅ live modules working; placeholders by design.

**Stores** (`/stores/*`): StorekeeperDashboard; stock, stock-alerts, purchasing, transfers, inventory ops tabs, reports (sales/inventory), requisitions (placeholder), KDS (`/stores/kds`).

**POS** (`/pos`, intentionally chrome-less, touch-first): `POSContainer` with 4 internal tabs — **shifts** (ShiftManagementPage, default & required first), **floor** (FloorPlan + table sessions), **order** (OrderTaking + KOT printing), **bill** (BillPayment + payment/receipts). Plus modals: OpenTableDialog, transfer/merge, MenuManager, POSSettings (5 tabs), CloseShiftModal, POSAccessGate (property PIN), staff-switch PinPad. Also `/pos/access-pin`.

**Admin** (`/admin/*`, `AdminRoute`): dashboard, properties (list/new/detail/edit), usage, users, recovery, audit-log; property-side: roles, settings (printers/receipt/unsettled-receipt). ✅ working.

**POSApp module registry** (`src/pages/POSApp.jsx`, module switch used by both `/backoffice` embed and standalone): dashboard, pos, reservations, rooms, guests, receipts, folio, cashier→(redirects to POSContainer shifts), night-audit, kitchen, housekeeping, maintenance, purchasing, recipes, laundry, transfers, booking-engine, channels, registration-cards, walk-in-checkin, express-checkout, distribution-ops, inventory, store, reports, settings.

**Print-agent hooks** (local agent default `http://127.0.0.1:8631`, tests all pass): KOT/order tickets by production department (`printOrderByCategory` → `printDepartmentRoutingCore` → agent `/print`), unsettled/final receipts, void/refund slips, shift open/close reports, test page/cut calibration/test order/receipt, cash drawer, health `/health`, queue retry `/queue/retry`, pairing `/pair` (Supabase RPCs), diagnostics `/diagnostics`. Cloud fallback: `supabase/functions/print-proxy` TCP bridge.

**Supabase surface:** 24 service modules under `src/services/` (auth, PMS, POS, inventory, printing, settings, reporting, storekeeper). 150 migrations under `supabase/migrations/` (AGENTS.md: duplicate numeric prefixes are deployment history — do not renumber).

## 4b. Broken links, imports, assets, URLs

**Build guarantees:** `vite build` passes, so no broken ES imports exist. Findings are navigation/asset/URL level.

| # | Finding | Location | Severity |
|---|---|---|---|
| B1 | **Dead navigation target `/booking`** — the Booking Engine screen's availability search does `window.location.href='/booking?check_in=...'`; no `/booking` route exists → user lands on 404. | `src/components/modules/BookingEngine.jsx:1` (the `search()` fn inline in the minified file) | HIGH |
| B2 | **Redirect that silently loses its slug** — `SystemSettingsLayout` navigates to `/settings/system/<slug>` but `App.jsx` redirects all `/settings/system/*` → `/backoffice/settings/features`. Every sidebar click (Billing, Taxes, Loyalty…) lands on Features. The whole `SystemSettingsPage`/`SystemSettingsLayout` chain is only reachable on a path that always gets redirected away → effectively dead feature. | `src/App.jsx:118` vs `src/components/settings/SystemSettingsLayout.jsx:9` + `src/components/settings/systemSettingsNav.js:14`, used by `src/components/modules/SettingsPanel.jsx:39` | HIGH |
| B3 | Orphan file `public/manus-routes.json` — a route manifest authored for the "Manus" AI site-builder; **zero code/script references** anywhere (only prose mentions in two docs). Also not auto-synced with real routes. | `public/manus-routes.json` | MED |
| B4 | Orphan file `public/fonts/OFL.txt` — font license shipped but never referenced (the font itself is used). | `public/fonts/OFL.txt` | LOW |
| B5 | Unverified external embed — Tawk.to live-chat widget hardcoded in `index.html` with an unverified widget ID; loads on every page including POS. | `index.html:25` | MED (needs your call) |
| B6 | Scaffold-leftover hero video — CloudFront URL with `user_38xzZboKViGWJOttwIXH07lWA1P/` path (looks like a Base44/scaffold asset); unverifiable, could 404 anytime; no poster, no reduced-motion fallback. | `src/pages/PublicHome.jsx:267` | MED |
| B7 | Guessed social links + TODO — `SocialFAB` has `// TODO: swap these for OliTechs' real profile URLs — only WhatsApp below is confirmed real.`; instagram/tiktok/linkedin/facebook `@olitechs` handles are guesses. | `src/components/shell/SocialFAB.jsx:5-12` | MED |
| B8 | Domain spelling conflict — reset-password redirect uses `app.olitechs.co.ke` while footer says `olitechs.co.ke` and email is `info@olitech.co.ke` (missing "s"). Three variants of the brand domain. | `src/services/authService.js:314`, `src/pages/PublicHome.jsx:10,319` | LOW |
| B9 | Dead fallback `to='#'` in AppShell nav (currently unreachable; would be a dead link if data regresses). | `src/components/layout/AppShell.jsx:118` | LOW |

Everything else (128 `to=` targets, all `href` anchors, all public/ assets, all index.html tags) resolves correctly. ✅

## 4c. AI-slop inventory (by file & line)

**Genuinely clean overall** — no lorem ipsum, no commented-out code blocks, no AI/chatbot features in app code. Findings:

**Fake / fabricated content (production views):**
| File:line | Item |
|---|---|
| `src/pages/PublicHome.jsx:99,108,115,120,142,144,153,234` | Fabricated marketing demo data: "Michael Otieno – 4 nights", "The Grand Hotel, Nairobi", fake revenue "KES 1,842,600", fake "TABLE 08" order + demo "Charge to room" button, fake planner legend, `.stay-purple` purple chip (the exact "AI purple" anti-pattern). **Note:** this is the public marketing page — some demo content may be intentional. Need your call: keep as marketing demo or replace with neutral content. |
| `src/components/settings/ReceiptPreview.jsx:20` | `email@example.com` fallback rendered inside receipt preview. |
| `src/pages/Register.jsx:13` | `placeholder="Jane Doe"`. |
| `src/pages/Admin/AdminCreateProperty.jsx:161`, `AdminPropertyDetail.jsx:180,186` | `owner@example.com` / `staff@example.com` placeholders in forms. |
| `src/data/mockData.js` | Dedicated mock/seed-defaults data file (`// ...the values here are the seed defaults.`) — check what imports it before touching. |

**Marketing filler:** `src/pages/PublicHome.jsx:283` — "A **seamless** front desk" (only filler-word hit in repo).

**Console statements (41 across 13 files, all error/warn/info — zero plain `console.log`):**
`src/data/AppStore.jsx` (11: 66,112,174,199,230,233,278,357,397,552,589) · `src/services/printService.js` (6) · `src/components/pos/OrderTaking.jsx` (5) · `src/components/pos/BillPayment.jsx` (4) · `src/services/authService.js` (4) · `src/components/pos/POSContainer.jsx` (2) · `src/services/pmsService.js` (2) · `src/services/posService.js` (2) · `src/components/pms/RoomPlanner.jsx` (1) · `src/components/settings/KitchenPrintersPage.jsx` (1) · `src/components/ui/ErrorBoundary.jsx` (1) · `src/lib/supabaseClient.js` (1) · `src/pages/Register.jsx` (1). Most are error-path logging; several log raw errors with user-visible toasts in parallel. Proposed: keep error-path logging, strip duplicates/noise — list per-file before removal.

**TODO stubs:** `src/components/shell/SocialFAB.jsx:5` (see B7 above).

**Emoji/glyph-as-icon:** no true emoji anywhere; but BMP glyph-mix instead of icon components: `src/components/pos/AppHeader.jsx:7-10` (▦ ▤ ▧ ◷ as POS tab icons), `src/components/pms/RoomPlanner.jsx:834` (♙ chess pawn as guests icon), `src/pages/PublicHome.jsx` (● ⌄ ↑ → ↗ text glyphs), heavy `→` arrows in buttons across 18 files (many are fine as typographic arrows; the icon-substitutes are the problem).

**Decorative effects:** `src/lib/PageNotFound.jsx:27-131` — animated 404 "glow" orbs (`ot404-glow__ball` ×10) with reduced-motion opt-out (at least it degrades gracefully); `src/pages/PublicHome.jsx:234` purple chip (above).

**"Coming soon" stubs (by design, listed for completeness):** `SettingsPanel.jsx:50` badge, `LegalComingSoon.jsx:20`, FrontOffice statistics/services placeholders, `ModuleStatusPage` routes (`/backoffice/reports/employees`, `/stores/requisitions`, FO statistics & minibar/laundry/maintenance/guest-requests).

**Non-functional/dead code:**
| File | Item |
|---|---|
| `src/components/modules/Cashier.jsx` | **Orphaned** — zero imports anywhere (only a contract test *reads its text* via fs). POSApp's `cashier` module redirects to POSContainer `shifts`. ⚠️ Protected by AGENTS.md §6 — **needs your explicit approval to delete**. |
| `src/components/settings/SystemSettingsPage.jsx` + `SystemSettingsLayout.jsx` | Dead chain (B2 above). |
| `public/manus-routes.json` | Orphan (B3). |
| 10 over-exported helpers | `safeReportText`, `escapeSpreadsheetFormula`, `resolveReportTheme` (reportDocumentEngine.js:25,27,45); `isValidIPv4`, `isValidPort` (printerService.js:63,67); `hasSubscriptionModule`, `canRoleUseModule`, `hashPin` (authService.js:44,50,71); `SUPPORTED_AGENT_PORTS`, `isSupportedAgentPort` (printerSetupCore.js:6,62) — exported but never imported elsewhere. De-export, don't delete. |

**Unused dependencies — 27 packages with zero imports anywhere (verified individually, including config files; `tailwindcss-animate` correctly kept):**
`@hello-pangea/dnd`, `@stripe/react-stripe-js`, `@stripe/stripe-js`, `canvas-confetti`, `cmdk`, `embla-carousel-react`, `input-otp`, `lodash`, `moment`, `next-themes`, `react-day-picker`, `react-hot-toast` (app uses `sonner`), `react-leaflet`, `react-markdown`, `react-quill-new`, `react-resizable-panels`, `three`, `vaul`, and **20 Radix packages**: `@radix-ui/react-accordion`, `-alert-dialog`, `-aspect-ratio`, `-avatar`, `-collapsible`, `-context-menu`, `-dropdown-menu`, `-hover-card`, `-menubar`, `-navigation-menu`, `-popover`, `-progress`, `-radio-group`, `-separator`, `-slider`, `-switch`, `-tabs`, `-toast`, `-toggle`, `-toggle-group`. (Only `react-slot`, `-checkbox`, `-dialog`, `-label`, `-select` are actually used.) Note `cmdk`/`vaul`/`next-themes` etc. are typical shadcn scaffolding — removal is safe but touches `package.json` + lockfile only.

## 4d. UI problems (by file, with severity)

**Tokens/global**
- `src/index.css:61` — `--danger` is **orange** (`#EE8A3C`), so "danger"/error/bill-printed states render orange, not red. MED (verify intent before changing — it doubles as the "Not paid" legend colour).
- `bg-[var(--surface)]/70`-style Tailwind alpha-on-CSS-var classes **silently don't apply alpha** (Tailwind 3 limitation) — recurring invisible styling failure: `FrontOfficeShell.jsx:93,96,99`, plus `src/components/settings/PrinterSetupWizard.jsx:214`, `src/components/shell/Sidebar.jsx:55`, `src/pages/SettingsPrinters.jsx:866` siblings. MED.
- `src/index.css:208` global 44px button minimum is overridden by `h-9`/`min-h-9` (36px) in many places → inconsistent touch targets: `AppShell.jsx:110,119,124`, `POSContainer.jsx:395`, `ShiftManagementPage.jsx:109,112,181`, `pages/Dashboard.jsx:112,354`. MED for POS (touch-first).

**Dashboard** — room-status colour contradicts RoomPlanner: `pages/Dashboard.jsx:30-35` maps available→green `--room-clean` while `RoomPlanner` maps available→grey. MED. Composite index keys (`Dashboard.jsx:380,402,424`). 30s polling without visibility gating (`:192`).

**App shell / nav** — `FrontOfficeShell.jsx:87-104` two stacked top bars ≈116px chrome; dropdown panels positioned with arbitrary absolute offsets (`right-20/16/3 top-[66px]`), no portal, no click-outside (Escape only). `TopAppNav.jsx:59-60` active-tab highlight computed from `window.location.pathname` without subscription → stale highlight after in-app nav. Sign-out hidden behind expanding account row (`AppShell.jsx:134`).

**POS (touch-first)**
- `AppHeader.jsx:14-16` — clock/date computed once at render with `new Date()`, **no interval → frozen clock on a POS header**. MED.
- `AppHeader.jsx:22,45-46,65` — inline `style` palette constants mixed with Tailwind vars in the same header (two styling systems). MED.
- `FloorPlan.jsx:30-35,184-186` — legend lists only 3 of 5 statuses (missing Reserved, Paid); "Bill printed" swatch uses orange `--danger`; `reserved` tile painted with `--room-checkout` — **legend misleads staff**. MED.
- `POSContainer.jsx:427-461` vs Dashboard — inconsistent radius/typography systems (`rounded-3xl font-black` vs `rounded-lg font-medium`). MED.
- `POSContainer.jsx:433`, `CloseShiftModal.jsx:100` — icon-only close buttons without `aria-label`. LOW.
- `OrderTaking.jsx:472` — **hardcoded "Visiwa Beach Resort"** in ticket header instead of the property name. MED.
- `OrderTaking.jsx:556` — "Choose up to null" when a multiple-choice group lacks `max_selections`. LOW.
- `OrderTaking.jsx:392-393` — category tile colours assigned by array position → colours reshuffle when categories reorder. LOW.
- `OrderTaking.jsx:386,414` — duplicated `gap-1.5` in same class string. LOW.
- `BillPayment.jsx:48` — native `window.confirm` for room charge (inconsistent with custom modals). LOW.
- Duplicated near-identical tile-render blocks `FloorPlan.jsx:163,167`. LOW.

**PMS / Room planner**
- `Rooms.jsx:14,74` — `openRoom` state never set → **RoomPanel detail modal is dead code** (can never open). MED.
- `Rooms.jsx:65` — "Remove" reservation button has **no confirmation dialog**. MED.
- `RoomPlanner.jsx:641-656` — duplicate conflicting CSS rule blocks (44px filter rows at 641-648 immediately overridden to 36px at 649-656) → sub-44px targets + dead CSS. MED.
- `RoomPlanner.jsx:918` — internal variable names leak into user copy: "…plannerRooms linked". `:395,980` confirm() strings leak "plannerReservations"/"plannerRooms". MED.
- `RoomPlanner.jsx:121-123` — mock-preview fake controls ('‹ Today ›') rendered in the live UI. LOW.
- `RoomPlanner.jsx:129-131,870-976` — inline style palette constants mixed with CSS vars. MED.
- Payment legend colours (Paid #3FA77A / Deposit #F2C14E / Not paid #EE8A3C) correctly tokenized at `index.css:27-31` ✅ — do not change.

**PublicHome** — hardcoded brand hexes (`#285FE7`, `#101A35`) + a large inline `<style>` duplicating tokens instead of using `index.css` vars (`:82,89,198,200-248`); hero autoplay video without reduced-motion/poster (`:266-268`); ideographic-space layout hacks (`:120,153`).

**Typography/spacing inconsistency pattern:** `rounded-3xl/font-black` (POS modals) vs `rounded-lg/font-medium` (Dashboard) vs `rounded-2xl` (BookingEngine) — three radius/type scales coexist. Phase 2 will unify via tokens.

## 4e. Functional bugs found

| # | Bug | Location | Severity |
|---|---|---|---|
| F1 | **Stale test assertion** — Excel report test expects teal `FF0A3F4A`; engine correctly emits current brand navy `FF101A35`. Test is the stale side (token contract confirms). | `src/services/reportDocumentEngine.test.mjs:107` vs `reportDocumentEngine.js:131+` & `index.css:16` | HIGH (suite red) |
| F2 | Report test suite shells out to `pdfinfo`/`pdftotext` (poppler) — undocumented environment dependency; red on any machine without it. | `reportDocumentEngine.test.mjs:66,71` | MED (env) |
| F3 | **Frozen POS clock** — `AppHeader` computes time once, no interval. | `src/components/pos/AppHeader.jsx:14-16` | MED |
| F4 | **Print/confirm state desync** — `onConfirmPayment` records the payment, `await printReceipt(...)` can throw, and the catch shows "Payment was not recorded" while the payment *was* recorded and table release (runs after print) is skipped → table stays occupied with a wrong message. | `src/components/pos/BillPayment.jsx:90-127` | HIGH |
| F5 | Voided-items lookup fetches **all** property voids then string-matches `table_label`+`order_number` client-side — fragile match + heavy query. | `src/components/pos/BillPayment.jsx:93-94` | MED |
| F6 | Floating-point money persisted (price×qty sums, /100 deltas) — violates the project's own "no float money" rule. Needs a careful, approved fix. | `BillPayment.jsx:27-28`, `OrderTaking.jsx:106,300-302`, `POSContainer.jsx:156` | MED (schema-adjacent; Phase 3 with your approval) |
| F7 | Split-payment rows keyed `key={i}` (index) on removable/reorderable rows → stale row state after removal. | `src/components/pos/BillPayment.jsx:158` | MED |
| F8 | KOT race — `setActiveTab('floor'); setActiveTable(null)` fire before the async KOT snapshot persists; reopening the same table mid-persist can overwrite its snapshot with a stale one. | `src/components/pos/POSContainer.jsx:222-262` | MED |
| F9 | **Opening-shift notes silently dropped** — `CloseShiftModal` passes `notes` to `openShift`, whose signature has no `notes` param. | `src/components/pos/CloseShiftModal.jsx:31` vs `src/services/shiftService.js:44` | MED |
| F10 | Direct Supabase query inside a presentational modal (violates AGENTS.md rule). | `src/components/pos/CloseShiftModal.jsx:87` | MED (arch) |
| F11 | Manager-PIN variance threshold hardcoded KES 500 (not configurable). | `CloseShiftModal.jsx:66,110` | LOW |
| F12 | Shift summary prints to only `assigned[0]` printer — other assigned shift-report printers ignored. | `src/components/pos/ShiftManagementPage.jsx:62` | MED |
| F13 | RoomPanel modal dead (see 4d) + destructive "Remove" without confirm. | `Rooms.jsx:14,65,74` | MED |
| F14 | Kids-age fields keyed by index on length-driven list → wrong values after row removal. | `RoomPlanner.jsx:932`, `Reservations.jsx:339` | LOW |
| F15 | O(n²) filter per row per render in planner grid. | `RoomPlanner.jsx:821` | LOW (perf) |
| F16 | "Today" frozen in `useMemo([])` → planner misbehaves across midnight. | `RoomPlanner.jsx:147` | LOW |
| F17 | Category list not deduped → duplicate keys if category names repeat. | `OrderTaking.jsx:64-66,387` | LOW |
| F18 | `/booking` search button 404s (B1) and `/settings/system/*` slug-loss redirect (B2) — counted once each, listed here because they are functional breakages too. | BookingEngine.jsx / App.jsx:118 | HIGH |
| F19 | AdminRecovery uses `window.print()` for a historical folio export — per printerService rules this *system* printer usage may be intentional; verify intent before Phase 3 changes. | `src/pages/Admin/AdminRecovery.jsx:15` | LOW (informational) |

**Print-agent integration status (Phase 0 verification):** all 107 agent unit/contract tests pass locally; the agent's health-check URL and all frontend call sites are consistent on `127.0.0.1:8631`. Full runtime verification (agent + real/virtual printer) is deferred to Phase 3 as planned.

---

## 5. Proposed Phase 1 actions (for your approval — nothing deleted yet)

**Removals (need your OK, itemised):**
1. Delete `public/manus-routes.json` (B3) — orphan.
2. Delete `public/fonts/OFL.txt` (B4) — orphan license file (or keep for legal hygiene — your call; it's 1 file).
3. Delete `src/components/modules/Cashier.jsx` — orphaned, but AGENTS.md-protected. **Explicit approval required.** Alternative: keep + note.
4. Delete dead chain `SystemSettingsPage.jsx` + `SystemSettingsLayout.jsx` + `systemSettingsNav.js` **or** fix B2 by re-pointing SettingsPanel at real `/backoffice/settings/*` slugs (this keeps the settings tab working — recommended).
5. Remove 27 unused dependencies (list in 4c) — package.json only, then reinstall + full re-run. One caveat: `@stripe/*`, `react-leaflet`, `three`, `react-markdown`, `react-quill-new` may be on the feature roadmap — confirm none are planned for near-term use.
6. Strip/trim the 41 console statements (keep error-path logging, remove dupes/noise — I'll list each edit).
7. PublicHome demo content + purple chip + "seamless" (some may be intentional marketing — need your steer: neutralise or keep).
8. SocialFAB guessed URLs — replace with the confirmed WhatsApp link only, or remove FAB entirely pending real handles.
9. Tawk.to widget in index.html — keep (real support channel?) or remove (it loads on POS screens too)?

**Fixes:**
10. B1 `/booking` — wire the search button to real behaviour (e.g. route to the public booking flow if one exists, or disable with a clear notice). **Question: is there a real public booking page, or should this navigate to the public site?**
11. B2/F18b — restore working `/backoffice/settings/:slug` deep links from SettingsPanel.
12. F1 — update stale test colour to `FF101A35`.
13. F3 frozen clock; 4d legend/RoomPanel-removal-confirm hardening where behaviour-safe.
14. Add `scripts/check-links.mjs` link-check script (internal `to=`/`href=` targets vs routes + asset existence) and wire as `npm run check:links`.
15. Reconcile brand domain spelling (B8) — tell me the canonical domain.

**Deliberately deferred (by design):** placeholders/statistics pages (they're documented as not-yet-implemented), the 10 over-exported helpers (cosmetic de-export — will fold into a cleanup commit), chunk-size warnings (Phase 2/3 territory unless you want manualChunks now), float money (F6 — Phase 3 with approval, needs DB-check).

## 6. Open questions (answer with the phase go-ahead)

1. **Cashier.jsx**: delete (it's AGENTS.md-protected) or keep as-is?
2. **Tawk.to widget**: keep or remove?
3. **PublicHome demo content**: neutralise or keep as marketing demo?
4. **Unused deps incl. Stripe/leaflet/three**: any of the 27 needed for planned features?
5. **Install poppler + Python** (winget) so the reports test and ui-ux-pro-max search script work locally?
6. **Canonical brand domain**: `olitechs.co.ke` or `olitech.co.ke`? And is `app.olitechs.co.ke` the real app host?
7. **`/booking`**: real public booking page exists anywhere (on the public site, or is the BookingEngine config a URL that should be used instead of hard-coding `/booking`)?

— END OF PHASE 0. Awaiting your approval before Phase 1. —
