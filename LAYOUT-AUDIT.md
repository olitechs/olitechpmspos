# LAYOUT-AUDIT.md — Global responsive layout and contrast audit

**Phase:** 0 (inspection only — no application code changed)
**Date:** 2026-11-19
**Baseline commit:** `329c601a` (`main`, after PR #176)
**Scope:** every active route in Back Office, Front Office, POS & F&B, Stores,
Admin and the public/marketing pages.
**Status:** awaiting approval to start Phase 1.

---

## 1. Summary

| # | Reported problem | Verdict | Root cause (short) |
|---|------------------|---------|--------------------|
| 1 | Modals taller than the viewport; title/close clipped at top, Cancel/Save clipped at bottom | **Confirmed in code** | 29 hand-rolled `fixed inset-0` overlays; **11** have no `max-height` on the panel and no scrollable body. The panel is vertically centred and `overflow-hidden`, so it overflows equally at both ends. |
| 2 | Dark text on blue (selected "POS & F&B" tab, "Add Staff" button) | **Confirmed, measured 3.18:1** | Elements set `bg-primary` **and** `text-foreground` (navy), or `bg-primary` with no `color` at all, so they inherit `body { color: var(--text) }`. 27 solid-blue class strings have no paired `--on-primary`. |
| 3 | Cards get "stuck"; two scrollbars | **Confirmed** | 5 `max-h-*` + `overflow-*` regions nested inside the page scroll area, including the Employees activity card. |
| 4 | Table names truncate ("Shadrack ri…") with no tooltip | **Confirmed** | 12 tables render with no scroll wrapper; `StaffAdmin` truncates staff names with no `title`; `Roles` pins `min-w-[900px]`. |
| 5 | Add Staff autofills admin email + PIN | **Confirmed** | The staff form's email/PIN/confirm-PIN inputs have no `autoComplete`, no `name`, no `id`; `type="password"` invites password-manager autofill. |
| 6 | "Assign Tabs" orphans "Stores" | **Confirmed** | `grid grid-cols-3` with exactly 4 modules (`MODULE_NAMES`). |

---

## 2. Method and evidence

### 2.1 What was run

| Check | Tool | Result |
|---|---|---|
| Stack / primitive inventory | source read | complete |
| Static layout + contrast scan | `layout-scan.mjs`, `layout-scan2.mjs`, `scan3.mjs` (Node, read-only) | complete |
| Contrast maths | WCAG 2.1 relative-luminance script | complete |
| Runtime detector harness | Edge headless + Chrome DevTools Protocol (Node built-in `WebSocket`, **no new dependency**) | built and **validated** |
| Runtime sweep of real screens | same harness, 5 viewports × 7 reachable routes | **blocked — see 2.3** |
| Build / lint / typecheck / tests | `npm run …` | green (see §9) |

### 2.2 Runtime harness validation

The detector was run against a synthetic fixture containing one instance of each
defect class. All six detectors fired correctly, including the exact contrast
failure from the report:

```json
{"type":"contrast","el":"button.blue","fg":"rgb(16, 26, 53)",
 "bg":"rgb(40,95,231)","ratio":3.18,"need":4.5}
{"type":"clipped-overlay","el":"div.clip","bottom":1000}
{"type":"nested-scroll","el":"div.inner","inside":"div.outer"}
{"type":"small-touch-target","el":"button.tiny","w":20,"h":20}
{"type":"truncated-no-tooltip","el":"div.trunc","text":"Shadrack riwera long name"}
{"type":"page-horizontal-overflow","scrollWidth":2000}
```

So the harness is trustworthy; it is the *data* that is missing, not the tool.

### 2.3 Blocker: no authenticated runtime sweep in this environment

- There is **no `.env`** in the workspace (only `.env.example`), and no Supabase
  URL/anon key are available. `src/lib/supabaseClient.js` therefore substitutes
  a placeholder client and the app renders `SupabaseSetupNotice`.
- Measured: 5 viewports × 7 public routes = 35 navigations. Every page rendered
  43 DOM nodes of setup notice, **0 application nodes**. `/backoffice/*` etc.
  redirect to `/login` without a session.
- I did **not** point the harness at production (`olitechs.co.ke`) because that
  is live user data and no credentials were supplied.

**Consequence:** the findings below are proven by *source + measured token
contrast*, which is conclusive for these defects (each is a literal class string
or CSS value). The runtime harness is ready and will be wired as `npm run
test:layout` in Phase 3; it needs either a `.env` with a test project or a
seeded staging login.

### 2.4 Viewport matrix used for planning

| Bucket | Sizes |
|---|---|
| Desktop | 1920×1080, 1600×900, 1536×730, 1366×768 |
| Short laptop | **1280×600**, 1536×730 |
| Tablet landscape (POS) | **1024×768** |
| Tablet portrait | 820×1180, **768×1024** |
| Phone | 412×915, **390×844**, 360×640 |
| Phone landscape | 844×390 |
| Zoom | 100 / 125 / 150 / 200 % (125–200 % is equivalent to reducing the CSS viewport to roughly 1250×600–1536×730, which is why those two sizes drive the fixes) |

---

## 3. Stack and shared primitives

**Stack:** Vite 6 · React 18 · React Router 6 · Tailwind 3.4 · Radix UI
(dialog, select, checkbox, label, slot) · CVA · Sonner · Zustand · TanStack Query.
Styling is **Tailwind utilities + CSS custom properties**; the single token
source is `src/index.css` `:root`. `tailwind.config.js` only maps tokens.

**Token reality check:** `--primary` → `var(--coastal-teal)` → `#285FE7`;
`--primary-hover` → `#174AC8`; `--on-primary` → `#FFFFFF`. Confirmed at
`src/index.css:11-12,23-24,59-64`.

| Primitive | Where it lives | State |
|---|---|---|
| Modal / Dialog | `src/components/ui/dialog.jsx` (Radix) + **29 hand-rolled** `fixed inset-0` overlays | fragmented; Radix used by **1** file only |
| Button | `src/components/ui/button.jsx` (CVA) + `.global-primary-button` in `index.css:284` | two parallel systems; both correct for the default variant |
| Card / Panel | `src/components/ui/system.jsx` (`Card`, `CardHeader`, `StatTile`), `.global-card` | OK |
| Badge / Chip | `system.jsx` `StatusBadge` (soft tones only) | no solid-blue chip primitive |
| Table | **none** — every screen hand-writes `<table>` | no shared wrapper |
| Tabs / Segmented | **none** — ad-hoc button grids (e.g. `Roles.jsx` `grid-cols-3`) | no primitive |
| Input / Select | `ui/input.jsx`, `ui/select.jsx` + raw `<input>` in ~67 files | no shared field wrapper |
| Toast | Sonner `<Toaster/>` | OK |
| Dropdown / Popover | none shared; hand-rolled (e.g. `StorekeeperDashboard.jsx:216`) | no primitive |
| Sidebar | `src/components/shell/Sidebar.jsx` (legacy) + `AppShell` internal nav | two sidebars |
| Page shell | `AppShell.jsx` (backoffice/pos/stores), `FrontOfficeShell.jsx` | OK structure, see §5.3 |
| POS grids | `POSContainer.jsx`, `AppHeader.jsx`, `StaffDock.jsx` | one scroll container, OK |

---

## 4. Route inventory

112 `path=` entries in `src/routes/AppRoutes.jsx`. Grouped:

| Workspace | Routes |
|---|---|
| Public / marketing | `/`, `/home`, `/signin`, `/signup`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/terms`, `/privacy` |
| Back Office | `/backoffice`, `items/{list,categories,modifiers,discounts}`, `reports/{sales,inventory,employees,shifts}`, `inventory/{purchase-orders,transfer-orders,stock-adjustments,counts,productions,suppliers,history,valuation}`, `stores`, `pos-devices`, `printers`, `employees/{list,access-rights,timecards,hours}`, `customers`, `integrations`, `settings/:slug`, `help` |
| Front Office | `/frontoffice`, `room-planner`, `rooms`, `reservations`, `folio`, `housekeeping`, `night-audit`, `manuals`, `assistance`, `dashboard`, `channels`, `structure`, `configuration`, `tags`, `check-in/{arrivals,in-house,departures,walk-in,express-checkout,registration-cards}`, `statistics/:report`, `services/{housekeeping,room-charges,minibar,laundry,maintenance,guest-requests}` |
| Stores | `/stores`, `manage`, `stock`, `stock-alerts`, `purchasing`, `transfers`, `inventory/*`, `reports/*`, `requisitions`, `settings`, `pos-devices`, `printers` |
| POS | `/pos`, `/pos/access-pin`, `/dashboard`, `/pms`, `/store`, `/rooms`, `/settings/{kitchen-printers,system,stores,printers,receipt}`, `kds` |
| Admin | `/admin`, `/admin/{login,usage,users,recovery,settings,properties,properties/new,properties/:id,properties/:id/edit,audit-log,roles,settings/printers,settings/receipt,settings/unsettled-receipt}` |
| Fallback | `*` → `AppRoutes.jsx:123` full-screen `z-[9999]` wrapper |

**Defect-bearing routes for this audit:** all 29 modal-bearing screens, the
Employees screens, all 12 unwrapped tables, the POS shells, Room Planner, and
the auth pages.

---

## 5. Root causes

### R1 — Modal height is set on the overlay, not the panel; the panel has no height budget

29 overlays use `fixed inset-0 … flex items-center justify-center … p-4`
(`layout-scan2.mjs`). **11** of the inner panels have **neither** a `max-height`
**nor** a scrollable body:

`Roles.jsx:32`, `POSDevicesPage.jsx:43`, `RoomPanel.jsx:63`,
`OrderTaking.jsx:602`, `Folio.jsx:267`, `KitchenDisplay.jsx:229`,
`CloseShiftModal.jsx:43`, `CloseShiftModal.jsx:99`, `CategoriesPage.jsx:129`,
`Phase2CataloguePage.jsx:8`, `SupplierList.jsx:9`.

When such a panel is taller than the viewport:

- `items-center` centres it, so it overflows **equally above and below**;
- `overflow-hidden` on the panel (e.g. `Roles.jsx:32`) clips both ends;
- nothing scrolls, so the footer buttons are unreachable.

Even the panels that do scroll (`max-h-[90vh] overflow-y-auto`) scroll the
header and footer **with** the body, and use `90vh`, not `100dvh − margin`.
`src/components/ui/dialog.jsx:15` is better (`max-h-[calc(100dvh-1rem)]`) but
still scrolls the whole dialog: header and footer are not pinned, and there is
no `100vh` fallback if `dvh` is unsupported.

### R2 — Solid blue with no paired foreground

`body { color: var(--text) }` (`index.css:265`) means any element that sets
`bg-primary` without also setting `color` inherits **navy**. `Button`'s default
variant pairs correctly (`button.jsx:11`), but hand-written buttons and chips do
not. 27 distinct class strings:

- **Text-bearing, must fix:** `Roles.jsx:29` (page "Add Staff"), `:30` (avatar
  tile, module chips), `:32` (selected module tab, "Save Staff"), `Store.jsx:77,
  97, 99`, `StoresPage.jsx:107,152`, `POSContainer.jsx:509`, `KitchenDisplay.jsx:152,239`,
  `UsageForm.jsx:3`, `PaywallGuard.jsx:86,100`, `RouteGuard.jsx:168`.
- **Icon tile only:** `SubscriptionPanel.jsx:75`, `PendingApproval.jsx:51`,
  `SupabaseSetupNotice.jsx:8`.
- **Decorative, no text (no change needed):** progress bars/dots in
  `Dashboard.jsx:409`, `Reservations.jsx:156`, `AdminDashboard.jsx:141`,
  `PinPad.jsx:75`, `SocialFAB.jsx:25`, `PrinterSetupWizard.jsx:229,345`.

Measured contrast (WCAG 2.1):

| Pair | Ratio | Verdict |
|---|---|---|
| `#101A35` on `#285FE7` (the bug) | **3.18** | fails 4.5 for normal text |
| `#FFFFFF` on `#285FE7` | **5.41** | passes |
| `#FFFFFF` on `#174AC8` | **7.37** | passes |
| `#101A35` on `#F8FAFF` | 16.47 | passes |
| `#285FE7` on `#FFFFFF` | 5.41 | passes (links) |
| `#285FE7` on `--primary-soft` | 4.82 | passes |
| `#FFFFFF` on `#3FA77A` (paid) | 2.99 | **sanctioned exception** |
| `#FFFFFF` on `#EE8A3C` (not paid) | 2.52 | **sanctioned exception** |

The last two are explicitly frozen by `Design.md:51` and the standing rules
(“do not change payment colours”). They are recorded, not proposed for change.

### R3 — Nested scroll containers

One scroll container per view is the rule. Five places add a second:

| File | Line | Region |
|---|---|---|
| `src/pages/admin/Roles.jsx` | 31 | `max-h-72 overflow-auto` activity log, inside `<main overflow-auto>` |
| `src/components/modules/Folio.jsx` | 272 | `max-h-56 … overflow-y-auto` charge list inside a modal |
| `src/components/modules/InventoryOperations.jsx` | 20 | `max-h-80 overflow-auto` inside the page |
| `src/pages/FrontOfficeMinibar.jsx` | 60 | `max-h-52 … overflow-y-auto` inside the page |
| `src/pages/StorekeeperDashboard.jsx` | 216 | `max-h-72 … overflow-y-auto` search results popover |
| `src/components/pos/POSContainer.jsx` | 483 | `max-h-[55vh] overflow-y-auto` inside the POS modal |

The Employees "module/activity card" from the report is `Roles.jsx:31`.

### R4 — Tables have no responsive strategy

No shared table primitive exists. 12 tables render with no scroll container:

`GuestList.jsx:50`, `RoomManagement.jsx:110,118`, `Rooms.jsx:58`,
`EmployeeListPage.jsx:2`, `OperationalSettingsPage.jsx:51,53,55`,
`Phase2CataloguePage.jsx:13`, `TimecardsPage.jsx:2`, `AdminProperties.jsx:99`,
`AdminRecovery.jsx:15`.

Two opposite failures:

- **Clipped/wrapped:** `EmployeeListPage.jsx:2` is `w-full` inside
  `overflow-hidden rounded-2xl` — at narrow widths the browser squeezes columns
  and the last visible texture is cut.
- **Forced horizontal scroll:** `Roles.jsx:30` is `min-w-[900px]` inside
  `overflow-x-auto` — works, but the first column does not stick and there is no
  width adaptation.
- **Silent truncation with no tooltip:** `StaffAdmin.jsx:80-81` uses
  `truncate` on `full_name` / role inside `max-w-xl`, so names render as
  “Shadrack ri…” with no `title`. This is the reported symptom.

### R5 — Fixed pixel sizing and `100vh`

| File | Line | Issue |
|---|---|---|
| `src/components/shell/Sidebar.jsx` | 30 | `h-[calc(100vh-16px)]` — overshoots with mobile URL bar; should be `dvh` |
| `src/components/ui/AuthLayout.jsx` | 8, 15 | `min-h-[calc(100vh-3rem)]` + `lg:min-h-[760px]` — 760px card cannot fit 730px height |
| `src/lib/PageNotFound.jsx` | 59 | `min-height: 100vh` |
| `src/components/ui/dialog.jsx` | 15 | `dvh` with no `vh` fallback |

There is **no z-index token scale**. 19 ad-hoc values are in use:
`60, 80, 85, 90, 100, 110, 120, 200, 220, 240, 250, 260, 270, 280, 300, 400,
450, 500, 550, 9999` (plus Tailwind `z-40`/`z-50`). The `9999` values in
`PinPad.jsx:55`, `POSAccessGate.jsx:23` and `AppRoutes.jsx:123` will sit above
any future modal.

Spacing/type scales exist (`index.css:239-252`) but are fixed px, so they do not
breathe at 125–200 % zoom.

### R6 — Forms and autofill

Good news: login/registration forms already declare proper hints
(`Login.jsx:13-14`, `AdminLogin.jsx:49,56`, `Register.jsx:13`,
`PublicSignIn.jsx:81,99`, `PublicSignUp.jsx:128-187`,
`ResetPassword.jsx:100,117`, `POS/access-pin/AccessPinTab.jsx:72,75`).

The hazard is the **staff-creation form** (`Roles.jsx:32`):

- email `<input type="email">` — no `autoComplete`, no `name`, no `id`;
- `Set PIN` and `Confirm PIN` — `type="password"`, no `autoComplete`, no `name`,
  no `id`.

Chromium/Edge heuristics treat an unlabelled password field near an email field
as a login form and offer the signed-in admin's credentials. Fix: `autoComplete="off"`
on the form, `autoComplete="email"`/`"off"` on email as appropriate, and
`autoComplete="new-password"` + `name="staff-pin"`/`"staff-pin-confirm"` +
`id` on the PIN fields. (284 `<input>` elements across 67 files lack
`autoComplete`; only forms that mint credentials or PINs are in scope.)

### R7 — Segmented pickers do not fit their options

`Roles.jsx:32` uses `grid grid-cols-3` for 4 modules
(`authService.js:20` `MODULE_NAMES = ['backoffice','frontoffice','pos','store']`),
so “Stores” lands alone on row 2. The same pattern appears wherever a fixed
`grid-cols-N` is used for a variable option count.

### R8 — Selected state has no non-colour cue

Selected tabs/chips are communicated by blue fill alone. `MASTER.md:20` and
`Design.md:51` both require a second cue. There is no shared segmented control to
add one to.

---

## 6. Issue register (grouped by shared component)

### A. Modal / Dialog / Drawer — **29 sites**

| Route / screen | File | Line | Defect | Severity |
|---|---|---|---|---|
| Back Office → Employees → Access rights → **Add Staff** | `src/pages/admin/Roles.jsx` | 32 | no max-height, no body scroll, header+footer clipped | **P1** |
| Back Office → POS devices | `src/components/stores/POSDevicesPage.jsx` | 43 | panel has no max-height | **P1** |
| Front Office → Rooms → room panel | `src/components/pms/RoomPanel.jsx` | 63 | no max-height | P2 |
| Front Office → Folio → charge/payment | `src/components/modules/Folio.jsx` | 267 | no max-height; inner list scrolls | **P1** |
| Kitchen Display → re-fire | `src/components/modules/KitchenDisplay.jsx` | 229 | no max-height | P2 |
| POS → Open shift / Close shift | `src/components/pos/CloseShiftModal.jsx` | 43, 99, 101 | 43 & 99 no max-height; 101 `max-h-[72vh]` but header/footer scroll | **P1** |
| POS → Order notes / item dialog | `src/components/pos/OrderTaking.jsx` | 582, 602 | 582 `90vh` but header/footer scroll; 602 no max-height | P2 |
| POS → table dialog | `src/components/pos/OpenTableDialog.jsx` | 31 | 90vh, header/footer scroll | P2 |
| POS → bill confirm | `src/components/pos/POSContainer.jsx` | 474, 483 | 55vh inner scroll inside modal | P2 |
| Back Office → Items → rename category | `src/components/settings/CategoriesPage.jsx` | 129 | no max-height | P2 |
| Back Office → Items → modifiers/discounts | `src/components/settings/Phase2CataloguePage.jsx` | 8 | no max-height (3 modals) | P2 |
| Back Office → Stores → supplier | `src/components/store/SupplierList.jsx` | 9 | no max-height | P2 |
| Admin → Assign package | `src/pages/Admin/PackageAssignmentModal.jsx` | 38 | 90vh, no `dvh`, header sticky | P2 |
| Front Office → Reservations → new/edit | `src/components/modules/Reservations.jsx` | 449, 541 | 449 is a right drawer with inner scroll; 541 `92vh`, header/footer scroll | P2 |
| Front Office → receipt detail | `src/components/pms/ReceiptDetailModal.jsx` | 36 | 92vh, sticky header only | P2 |
| Room Planner → controls modal | `src/components/pms/planner/plannerControls.jsx` | 11 | `max-h-[92vh]`, header/footer scroll | **P1** |
| Settings → printer wizard | `src/components/settings/PrinterSetupWizard.jsx` | 212 | overlay scrolls, page behind also scrolls | P2 |
| Settings → printers | `src/pages/SettingsPrinters.jsx` | 879 | overlay scrolls | P3 |
| Global fallback | `src/routes/AppRoutes.jsx` | 123 | `z-[9999] overflow-auto` full page | P3 |
| Shared | `src/components/ui/dialog.jsx` | 15 | whole-dialog scroll, no `vh` fallback | **P1** |

Missing on **all** hand-rolled modals: focus trap, Escape close, scroll lock,
return focus, `aria-modal`. Radix already provides these in `ui/dialog.jsx`;
the hand-rolled ones must migrate to it.

### B. Button / Tab / Badge / Chip contrast — **27 class strings**

Listed in R2. Highest impact:

1. `Roles.jsx:29` — page-header **Add Staff** button.
2. `Roles.jsx:32` — selected **POS & F&B** module tab and **Save Staff**.
3. `Roles.jsx:30` — avatar tile and module chips.
4. `Store.jsx:77,97,99`, `StoresPage.jsx:107,152`, `POSContainer.jsx:509`,
   `KitchenDisplay.jsx:152,239`, `UsageForm.jsx:3`, `PaywallGuard.jsx:86,100`,
   `RouteGuard.jsx:168`.

### C. Scroll model — 5 nested regions + 2 shell issues

See R3. Also:

- `AppShell.jsx:89,142` — `<main class="overflow-auto">`; any page that adds a
  `max-h` card inside becomes a nested scroll.
- `FrontOfficeShell.jsx:106` — `<main class="overflow-hidden">`; pages must own
  their scroll, which several do not (`Reservations`, `Folio`).

### D. Tables — 12 unwrapped + 1 forced min-width

See R4.

### E. Segmented pickers — 1 reported + pattern

`Roles.jsx:32` `grid-cols-3` / 4 options.

### F. Sizing / tokens / z-index

See R5.

### G. Forms / autocomplete

See R6.

### H. Public / auth / marketing

| File | Line | Defect |
|---|---|---|
| `src/components/ui/AuthLayout.jsx` | 8, 15 | `100vh` + fixed `760px` card; overflows short laptops |
| `src/lib/PageNotFound.jsx` | 59 | `min-height: 100vh` |
| `src/pages/PublicHome.jsx` | — | no horizontal-overflow guard found in source; must be verified at runtime |

### I. POS touch surfaces

`index.css:269` already enforces `button { min-height: 44px }`, and
`.pos-control` is 48px (`index.css:318`). Gaps:

- `input`/`select` have no minimum height;
- `<a>` and `[role="button"]` are not covered;
- `GuestList.jsx:83`, `RoomPlanner.jsx:822`, `SettingsPrinters.jsx:646` use
  small padding classes but still inherit the 44px button minimum; width may
  fall below 44px in tight rows.

---

## 7. Reported-problem reproduction

| Report | Route | Component | Proof |
|---|---|---|---|
| 1 Modal clipped | `/backoffice/employees/access-rights` | `Roles.jsx:32` | panel `max-w-xl overflow-hidden`, no `max-h`; overlay `items-center`; 7 fields + header + footer ≈ 720–780 px at 14 px text |
| 2 Dark on blue | same | `Roles.jsx:29`, `:30`, `:32` | `bg-primary … text-foreground`; measured **3.18:1** |
| 3 Stuck card | same | `Roles.jsx:31` | `max-h-72 overflow-auto` inside `<main overflow-auto>` |
| 4 Name truncation | `/backoffice/employees/list` + POS settings staff card | `EmployeeListPage.jsx:2`, `StaffAdmin.jsx:80` | `w-full` table in `overflow-hidden`; `truncate` with no `title` |
| 5 Staff autofill | `/backoffice/employees/access-rights` | `Roles.jsx:32` | password inputs with no `autoComplete`/`name`/`id` |
| 6 Assign Tabs orphan | same | `Roles.jsx:32` | `grid-cols-3`, `MODULE_NAMES.length === 4` |

---

## 8. Proposed fix plan

### 8.1 Phase 1 — shared primitives (one fix, everywhere)

**Files I propose to change (13 + 2 test/tool files):**

| # | File | Change |
|---|---|---|
| 1 | `src/index.css` | add `--z-{dropdown,sticky,nav,modal,toast}` scale; `--modal-max-h`, `--modal-gap`; fluid type/spacing via `clamp()`; `.modal-frame/.modal-body/.modal-header/.modal-footer` + scroll-shadow; safe-area padding helpers; input min-height 44px; disabled-state tokens |
| 2 | `src/components/ui/dialog.jsx` | rebuild `DialogContent` as flex column: `max-h` on panel from `dvh` **with `vh` fallback**, pinned `DialogHeader`/`DialogFooter`, `DialogBody` with `min-height: 0; overflow-y: auto`, close button inside header, bottom-sheet at ≤640px, safe-area insets |
| 3 | `src/components/ui/button.jsx` | keep default/destructive pairs; make every filled variant set `--on-primary`; add `size` values in `rem`; disabled contrast ≥ 3:1 |
| 4 | **new** `src/components/ui/Segmented.jsx` | responsive `grid-template-columns: repeat(auto-fit, minmax(…)`, paired foreground, check icon on selected |
| 5 | **new** `src/components/ui/Table.jsx` | `TableShell` (`overflow-x-auto`, `overscroll-behavior: contain`), sticky-first-column option, `TruncatedCell` that always emits `title` |
| 6 | `src/components/ui/system.jsx` | `StatusBadge` gains solid tone using `--primary`/`--on-primary`; add `Chip` |
| 7 | `src/components/layout/AppShell.jsx` | `dvh` with fallback; z tokens; single scroll owner; sticky header offset |
| 8 | `src/components/layout/FrontOfficeShell.jsx` | same, and fix the `overflow-hidden` main so pages can scroll |
| 9 | `src/components/shell/Sidebar.jsx` | `h-[calc(100dvh-16px)]` with `vh` fallback; z token |
| 10 | `src/components/ui/AuthLayout.jsx` | `min-h-[100dvh]`, replace fixed `760px` with `clamp()` |
| 11 | `src/lib/PageNotFound.jsx` | `100dvh` with fallback |
| 12 | **new** `tools/design-system/check-contrast-pairs.mjs` | fail when a solid `bg-primary`/`--primary` class string has no paired foreground |
| 13 | `tools/design-system/touch-targets.test.mjs` | extend to `input`, `select`, `[role=button]`, anchors |
| 14 | `package.json` | add `check:contrast-pairs` to `lint` |
| 15 | `src/components/**` (≤ 12 files) | migrate the 9 height-less modals + the 5 contrast hotspots to the primitives above |

**Deliberately not changed in Phase 1:** payment/room/table/print colour
tokens, `.room-planner` `--pay-*`, `.62` checked-out opacity, `Cashier.jsx`,
`v6/`.

### 8.2 Phase 2 — screen sweep (after Phase 1 review)

1. Migrate the remaining 20 hand-rolled overlays to `Dialog`/`ModalFrame`.
2. `Roles.jsx`: rebuild the Add Staff modal on the primitive, fix the 5 contrast
   sites, `grid-cols-3` → responsive segment grid, autocomplete attributes.
3. `EmployeeListPage` / `StaffAdmin`: responsive table + `title` on truncation.
4. POS: verify 1024×768 and 768×1024 — ticket panel and totals always visible.
5. Room Planner: toolbar overflow and clipped panels only; legend untouched.
6. Public/auth pages at short viewports.

### 8.3 Phase 3 — guardrails

`npm run test:layout` (the CDP harness validated in §2.2, promoted to
Playwright), `UI-RULES.md`, before/after screenshots at 1536×730, 1280×600,
1024×768, 768×1024, 390×844.

---

## 9. Baseline gates (branch `main` @ `329c601a`)

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 (includes brand, colour, link, contrast checks) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 — built in 24.59 s |
| `npm run test:architecture` | 451 tests · 450 pass · 1 skipped · 0 fail |
| `Roles.jsx` guard | `b57f2a61814928c4ba2034cb0bf64472111835f9` (worktree = HEAD) |

---

## 10. Risks and non-goals

- **Windows case collision:** `src/pages/Admin/` and `src/pages/admin/` are the
  same directory on this machine; git tracks `src/pages/admin/Roles.jsx`. All
  edits to Roles will be staged by that exact path and re-verified with
  `git ls-files`; never `git add -A`.
- **`Roles.jsx` is minified** (34 lines, long lines). Phase 1/2 will format only
  the sections being edited, or format the file in its own commit, to keep the
  diff reviewable.
- **Contrast of payment/room colours is frozen** by instruction; those two
  WCAG failures stay and are documented, not “fixed”.
- **Runtime verification** needs a `.env` or a staging login (see §2.3).
- Presentation only: no business logic, permissions, data flow or schema changes.

---

## 11. Decision needed

Phase 0 is complete and this document is the approval artefact. Two things I
need from you:

1. **Approve the Phase 1 file list in §8.1** (or trim it), and confirm I may
   edit `src/pages/admin/Roles.jsx` — it is the file behind the reported screen
   and currently the only intentional exception to “don’t touch minified
   files”.
2. **Decide the runtime-verification route:** supply a `.env`/staging login for
   the authenticated sweep, or accept source-level verification plus the
   validated harness until Phase 3.

I have not changed any application code in this phase.
