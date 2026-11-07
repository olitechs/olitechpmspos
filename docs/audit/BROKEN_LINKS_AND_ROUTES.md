# OliTechs Broken Links and Routes Audit

**Audit date:** 2026-11-07  
**Scope:** Active root Vite application, public deployment, README/docs links, public assets, and declared navigation/role contracts. Historical `v6/` code is excluded because repository guidance identifies it as an inactive duplicate. No production writes were made.

## Findings and fixes

| Location | Problem | Fix applied | Status |
|---|---|---|---|
| `src/pages/PublicHome.jsx` footer | Terms and Privacy were empty `href="#"` anchors and did not open a page. | Replaced them with `/terms` and `/privacy` links that show an accessible, branded coming-soon page. | Fixed; covered by `navigationRouting.test.js`. |
| `src/components/shell/SocialFAB.jsx` | The X profile URL `https://x.com/olitechs` returned HTTP 404. | Removed the dead X destination from the visible social menu. | Fixed. WhatsApp, Instagram, TikTok, LinkedIn and Facebook destinations returned HTTP 200; HTTP reachability does not independently confirm profile ownership. |
| `src/data/modules/navArchitecture.js`, `src/services/authService.js` | `store_keeper` did not normalize to the Stores role; `storekeeper` was only handled by the staff normalizer and not the app navigation normalizer. | Added both spellings as aliases for `store_manager` in both app navigation and staff authorization normalization. | Fixed; regression tests cover Stores access. |
| `src/App.jsx`, `src/pages/LegalComingSoon.jsx` | There were no dedicated legal destinations for the public footer placeholders. | Added `/terms` and `/privacy` routes outside the signed-out-only redirect group. | Fixed; route contracts pass. |
| `src/data/modules/*` navigation declarations | Potential sidebar/menu routes could point to missing registered paths. | Audited route declarations against navigation source and ran the route/role contract suite. | No other missing navigation routes found; 30/30 focused tests pass. |
| `README.md` and `docs/**/*.md` | External links could be stale or broken. | Checked 21 link occurrences across 20 unique HTTP(S) URLs, following redirects. | No HTTP failures observed; all resolved to HTTP 2xx. |
| `src` relative and `@/` imports | Broken local assets/imports could fail during build. | Scanned active source import targets and ran the production build. | 0 unresolved local imports; build passes. |
| Live production public assets | Logo, favicon, manifest, JavaScript and CSS could be missing. | Checked the production HTML's actual JS/CSS hashes plus `/favicon.svg`, `/app-icon.svg`, `/manifest.json`, and `/olitechs-logo.svg`. | All checked assets returned HTTP 200 with expected content types. |
| `src/pages/SettingsPrinters.jsx` / local Print Agent | Printer settings depend on the workstation agent at `127.0.0.1:8631`. | Preserved its configured default and print workflow. | Not exercised: the local agent and printer hardware are not available in this sandbox. |

## Verification limits

The deployed `/` page returned HTTP 200 and was inspected in a signed-out browser. No `.env` file or test staff accounts were supplied, so authenticated role-by-role behavior (including admin, cashier, waiter and store keeper) could only be checked through source contracts and tests, not by signing into live workspaces. Public-page responsive verification and the color audit are handled separately from this route audit. No tablet/mobile screenshot is claimed here.
