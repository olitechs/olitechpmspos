# OliTechs Broken Links and Routes Audit

**Latest re-audit:** 2026-11-12  
**Active application:** root Vite/React application  
**Baseline:** the earlier 2026-11-07 audit below  
**Branch:** `fix/link-audit-2026-11-12`

## 12 November re-audit

| Area | Result | Action |
|---|---|---|
| Front Office sidebar | Checked 29 unique declared destinations against route registrations in `src/App.jsx`, including the dynamic statistics route. No missing destinations found. | Added a regression test so Front Office menu destinations are checked alongside the existing Back Office and Stores menus. |
| Public homepage section links | Checked all six unique literal section targets against element IDs. No missing section IDs and no empty `href="#"` placeholders found. | Added regression coverage for missing section IDs and empty placeholder anchors. |
| Public social menu | WhatsApp is the only destination identified in source as verified for OliTechs. Instagram, TikTok, LinkedIn and Facebook used unverified handle guesses. A URL returning HTTP 200 is not proof that it belongs to this business. | Removed the four unverified profile destinations. The menu now exposes only the verified WhatsApp contact. Add other profiles only after the exact official URLs are confirmed. |
| Existing legal footer routes | `/terms` and `/privacy` remain registered and linked from the public footer. | No change required. |
| Existing Back Office and Stores route checks | Existing navigation route contract tests remain in place. | Retained. |

### Code changes in this re-audit

- `src/components/shell/SocialFAB.jsx`: removed unverified social destinations.
- `src/data/modules/navigationRouting.test.js`: added Front Office destination checks, public homepage anchor checks, and a guard against reintroducing unverified social profile URLs.

## Earlier 7 November audit record

The following checks were recorded in the previous audit and are retained as historical evidence, not represented as freshly repeated on 12 November:

- Terms and Privacy footer placeholders were replaced with registered coming-soon pages.
- Store-keeper role aliases were aligned between navigation and staff authorization.
- 21 external-link occurrences across 20 unique HTTP(S) URLs were checked at that time.
- Local source imports and public deployment assets were checked at that time.
- The workstation Print Agent and physical printer hardware were not exercised.

## Verification limits

- This re-audit validates source declarations and adds automated regression checks. It does not claim that every authenticated screen was manually clicked with every staff role.
- The production website and its deployed assets were not independently re-probed in this run. A source-level route registration does not by itself prove that a deployment is live or that hosting rewrites are configured correctly.
- External documentation links were not all re-crawled in this re-audit. The 7 November HTTP results above are historical.
- The local Print Agent at `127.0.0.1:8631` and physical printer hardware remain outside this source audit.
- Historical `v6/` duplicate code is excluded from the active-app scope.

## Recommended verification

Run the focused contract test:

```bash
node --test src/data/modules/navigationRouting.test.js
```

Then run the repository architecture suite and production build:

```bash
npm run test:architecture
npm run build
```

The focused tests are committed in this change; CI results should be reviewed before merging.
