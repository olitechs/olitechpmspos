# Printer compatibility status

Generated from `tools/print-agent/compatibility.mjs` and the site evidence log.
An empty Evidence column means **no real hardware has been validated in this build** — it does not mean unsupported.

| Model | Connects via | Paper | Expected | Evidence | Last recorded |
| --- | --- | --- | --- | --- | --- |
| Epson TM-T20III | LAN 9100, Windows driver | 80mm, 58mm | supported | no-evidence | — |
| Epson TM-T82III | LAN 9100, Windows driver | 80mm | supported | no-evidence | — |
| Epson TM-T88VI | LAN 9100, Windows driver | 80mm | supported | no-evidence | — |
| Xprinter XP-80C | LAN 9100, Windows driver | 80mm | supported | no-evidence | — |
| Xprinter XP-58IIH | LAN 9100, Windows driver | 58mm | supported | no-evidence | — |
| Bixolon SRP-350III | LAN 9100, Windows driver | 80mm | supported | no-evidence | — |
| Star TSP143IV | Windows driver | 80mm | conditional | no-evidence | — |
| Unbranded ESC/POS 58mm/80mm clone | LAN 9100, Windows driver | 58mm, 80mm | conditional | no-evidence | — |
| GDI-only office printer (e.g. small laser) | Windows driver | 80mm | unsupported | no-evidence | — |

## Go-live gaps

6 supported models without validated evidence:

- Epson TM-T20III (`epson-tm-t20iii`)
- Epson TM-T82III (`epson-tm-t82iii`)
- Epson TM-T88VI (`epson-tm-t88vi`)
- Xprinter XP-80C (`xprinter-xp-80c`)
- Xprinter XP-58IIH (`xprinter-xp-58iih`)
- Bixolon SRP-350III (`bixolon-srp-350iii`)

A hotel cannot go live on a printer that is in this list. Record a site visit with `npm run print-agent:compatibility record <file>.json`.

_Generated 2026-11-12._
