# Open Questions

Facts that the code cannot answer and that must not be invented. Each entry says
what is blocked, what the code does today, and what is needed from the owner.

| # | Question | What the code does today | Needed to close |
|---|---|---|---|
| 1 | Should the POS ticket VAT rate come from `property_settings` (`unsettled_receipt_vat_rate`) instead of the fixed 16%? | `src/lib/posTax.js` uses `VAT_RATE = 0.16`, matching the schema default. Wiring the setting would change ticket totals, so it is intentionally fixed. | Owner decision on whether per-property VAT is desired; if yes, a phase that changes financial behaviour and its tests. |
| 2 | Should floor zones/tables be shared across terminals? | Stored per property in this browser (`olitech_pos_floor:<propertyId>`); table sessions are server-side. | A `zones`/`tables` table plus RLS, or confirmation that browser-local layout is acceptable. |
| 3 | Which legal pages must the public site publish, and what wording? | Not yet written. No legal copy exists to copy from. | Owner-supplied entity name, address, contact, and policy text. Do not draft legal text. |
| 4 | Which support email/phone should public and error screens show? | Screens either omit contact details or link to an in-app destination. | Confirmed support contact. |
| 5 | Should the leftover `v6/` tree be removed? | Left untouched by instruction. `AGENTS.md` marks it file-safe. | Separate approval to delete, after proving no route/import depends on it. |
| 6 | Are the placeholder brand assets the final artwork? | `public/` brand files are templates with `{{BRAND_NAVY}}`/`{{BRAND_BLUE}}` placeholders rendered at dev/build time. | Final logo/social assets, if different from the template geometry. |
| 7 | Does the product still need the marketing pages at all, or is the app login-first? | Both exist: public marketing routes and the app. | Confirmation of the intended entry point. |

Add rows here instead of guessing. Remove a row only when the answer is recorded
somewhere in the repository.
