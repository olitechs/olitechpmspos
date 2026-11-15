# UI & Link Audit

Findings from the broken-links / broken-UI inspection (Phase 4). Date: 2026-11-15.

## How it was inspected

- **Static link audits (automated):** `node scripts/check-links.mjs` and
  `node scripts/audit-links.mjs`. Both pass: 112 routes declared in
  `src/App.jsx`, 124 internal navigation targets, every target resolves to a
  declared route. Both checkers run as part of the lint chain via
  `npm run check:links`.
- **Manual code inspection:** every `href="#"`-style anchor, `window.open()`
  call, external URL, and `mailto:`/`tel:` reference in `src/` was read and
  traced to a real destination.
- **Runtime visual pass:** attempted with the dev server, but the in-app
  browser loads pages through a network proxy that cannot reach
  `localhost:5173` (502 Bad Gateway). A runtime walkthrough at
  desktop/tablet/phone widths therefore remains outstanding for the next
  environment where a browser can reach the dev server. Everything below is
  from the static passes.

## Broken links

**None found in the committed code.** Specifically verified:

- All in-page anchors on the marketing page (`src/pages/PublicHome.jsx`) —
  `#platform`, `#features`, `#solutions`, `#about`, `#pricing`, `#contact`,
  `#faq` — resolve to real section IDs in the same page.
- The password-reset redirect in `src/services/authService.js`
  (`https://app.olitechs.co.ke/reset-password`) points to a route that exists
  in the SPA (`/reset-password`). The hostname is a deployment-environment
  assumption; see `docs/OPEN_QUESTIONS.md` for owner-facts.
- `mailto:`, `tel:`, and WhatsApp links (`wa.me/254745043121`) are consistent
  between `PublicHome.jsx` and `components/shell/SocialFAB.jsx` and are
  already recorded in `docs/OPEN_QUESTIONS.md` as needing owner confirmation.
- No dynamic image `src` templates or dangling asset imports were found.

## Broken UI (found and fixed)

Empty states were missing in six data views: with no data, the user saw a bare
table shell or blank panel with no explanation. All follow the existing
empty-state conventions already used elsewhere in the repo
("No X yet." + muted centre text).

| File | Problem | Fix |
|---|---|---|
| `src/components/store/SupplierList.jsx` | Empty `<tbody>` when no suppliers | Empty row: "No suppliers yet. Use "Add supplier" to create your first one." |
| `src/components/pms/Rooms.jsx` | Reservations table had no empty row | Empty row: "No reservations yet. Create one from the Reservations tab." |
| `src/components/pos/settings/tabs/TablesTab.jsx` | Blank panel when no floor zones exist | Dashed-border empty panel: "No floor zones or tables configured yet." |
| `src/components/modules/Transfers.jsx` | Blank list when no transfers; no hint when locations/products are missing | Empty list message: "No stock transfers yet." + hint when locations/products are unset |
| `src/components/modules/Laundry.jsx` | Blank queue when no laundry orders | Empty message: "No laundry orders yet." |
| `src/pages/admin/Roles.jsx` | File missing from the working tree while `App.jsx` still imports it (`/admin/roles`, `/backoffice/employees/access-rights`); Vite dev server reported "Failed to resolve import" | Restored from git (`git checkout --`). The file is tracked in HEAD and no commit deleted it — the deletion was accidental and local. |

Also re-checked and confirmed already handled (no change needed):

- `src/components/modules/ExpressCheckOut.jsx` — shows
  "No guests are currently checked in." under the guest select.
- `src/pages/FrontOfficeStatistics.jsx` — channels / guest-origin / forecast
  reports each have their own empty-state messaging.
- `src/pages/Admin/AdminRecovery.jsx` — pop-up blocker handled with a toast;
  empty search results reported via `toast.info`.
- `src/components/pos/MenuManager.jsx` — category `<select>` has a fallback
  option when no categories exist.

## Known limitations recorded elsewhere

- The whole app (including public marketing routes) renders
  `SupabaseSetupNotice` until `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
  are set. Intentional for deployment, but it means a runtime walkthrough
  requires real env values — tracked as part of the Phase 4 definition of done.
- `npm run test:reports` PDF assertions need Poppler (`pdfinfo`), which is not
  installed locally; those tests remain unverified on this machine.
