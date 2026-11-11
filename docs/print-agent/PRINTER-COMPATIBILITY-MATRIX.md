# Printer compatibility matrix and go-live evidence

This is how a printer becomes "supported" at OliTechs, and how a hotel proves —
before it takes real bookings — that its printers actually work.

It exists because two different claims get confused:

- **Expected support** comes from a printer family's documented ESC/POS
  behaviour. It is what the matrix below records, and it is a starting point.
- **Validated support** comes from a technician running the checks on that
  printer, in that hotel, with the installed agent. It is recorded in
  `tools/print-agent/compatibility-evidence.json` and nothing else counts.

The evidence file ships empty on purpose. No printer is validated until someone
has stood in front of it and printed.

## Support levels

| Level | Meaning |
| --- | --- |
| `supported` | Expected to work from documented ESC/POS behaviour. Must have a validated site record before the hotel goes live. |
| `conditional` | Works only in a specific configuration, or firmware varies between units. A validated record must say what the workaround is. |
| `unsupported` | Known not to work for OliTechs receipt printing. Do not sell it as compatible. |

An empty evidence column in a status report means **not validated yet**, never
"works fine".

## What the agent can and cannot print

The agent sends ESC/POS text jobs: initialise, left-align, print plain text lines
already laid out into columns, feed, then one cutter command. That brings real
limits, and they are the reason a printer can fail validation:

- **Text only.** Logos and images are converted to text or dropped. There is no
  raster image path in the agent, so a printer that only prints graphics is not
  compatible.
- **One codepage.** The agent does not send a codepage selection command, so a
  printer that does not default to the code page the hotel needs may print
  accents or currency symbols wrongly. Check the receipt text, not just the
  test page.
- **Column layout, not fonts.** 58mm printers default to 32 columns, 80mm to
  48. Character-width overrides from 24 to 64 are supported per printer.
- **Cutter commands vary.** GS V 66 n, GS V 1, GS V 0, ESC i and ESC m are
  selectable, plus "none". Older Xprinter units often need ESC i or ESC m; this
  is exactly what `cut_calibration` catches.
- **Cash drawer only over LAN.** The drawer pulse is sent to a network printer's
  kick port. A Windows-driver, USB, Bluetooth or serial printer will not open a
  drawer through OliTechs.
- **Driver-only printers are out.** A GDI printer that cannot interpret ESC/POS
  bytes produces blank or garbled pages. The matrix lists one so nobody tries.

## The matrix

Expected support only. The Evidence column is deliberately absent here; run
`npm run print-agent:compatibility status` for the current state of the
evidence log.

| Model | Connects via | Paper | Expected |
| --- | --- | --- | --- |
| Epson TM-T20III | LAN 9100, Windows driver | 80mm, 58mm | supported |
| Epson TM-T82III | LAN 9100, Windows driver | 80mm | supported |
| Epson TM-T88VI | LAN 9100, Windows driver | 80mm | supported |
| Xprinter XP-80C | LAN 9100, Windows driver | 80mm | supported |
| Xprinter XP-58IIH | LAN 9100, Windows driver | 58mm | supported |
| Bixolon SRP-350III | LAN 9100, Windows driver | 80mm | supported |
| Star TSP143IV | Windows driver | 80mm | conditional |
| Unbranded ESC/POS 58mm/80mm clone | LAN 9100, Windows driver | 58mm, 80mm | conditional |
| GDI-only office printer (e.g. small laser) | Windows driver | 80mm | unsupported |

Per-model notes (cutter quirks, drawer behaviour) live in
`tools/print-agent/compatibility.mjs`, next to the machine-readable matrix, so
the document and the tooling cannot drift apart silently.

## The checks

Every record covers the same eight checks. Five are required, and a failure in
any of them means the printer cannot go live, however good the test page looks.

| Check | Required | What it proves |
| --- | --- | --- |
| `test_page` | yes | The printer is reachable and cuts cleanly. |
| `receipt` | yes | Columns, totals and currency text are correct on real paper. |
| `reprint` | yes | A job that failed can be sent again from the app. |
| `offline_recovery` | yes | A job queued while the printer was switched off prints when it returns. |
| `restart_recovery` | yes | A queued job survives stopping and starting the agent service. |
| `order_ticket` | no | Kitchen/bar tickets print with the right routing. |
| `cash_drawer` | no | The drawer opens from this printer (LAN only). |
| `cut_calibration` | no | The cut lands correctly after adjusting feed dots. |

Results are `pass`, `fail` or `not-tested`. A missing required check is a
rejected record, not a silent pass.

## Record a site validation

Write one JSON file per visit. Include a unique id, the model id from the
matrix, and every check result. Do not include passwords, tokens, pairing codes,
receipt text or raw print data — the tool refuses records containing them.

```json
{
  "id": "example-hotel-kitchen-2026-11",
  "modelId": "epson-tm-t20iii",
  "site": "Example Hotel — kitchen",
  "workstation": "POS-KITCHEN-01",
  "transport": "network_ip",
  "paperWidth": "80mm",
  "agentVersion": "2.2.0",
  "windowsVersion": "Windows 11 24H2",
  "recordedAt": "2026-11-11T09:30:00.000Z",
  "checks": {
    "test_page": "pass",
    "receipt": "pass",
    "reprint": "pass",
    "offline_recovery": "pass",
    "restart_recovery": "pass",
    "order_ticket": "pass",
    "cash_drawer": "pass",
    "cut_calibration": "pass"
  },
  "notes": "Reprint and restart recovery confirmed with the printer unplugged.",
  "reportFiles": ["kitchen-test-page.jpg", "kitchen-receipt.jpg"]
}
```

The `recordedAt` value above is a placeholder: use the real date and time of the
visit, in UTC.

Then:

```bash
npm run print-agent:compatibility record -- path/to/record.json
npm run print-agent:compatibility status
npm run print-agent:compatibility report -- --out docs/print-agent/COMPATIBILITY-STATUS.md
```

`record` validates the file, refuses secrets and unknown models, appends to
`compatibility-evidence.json`, and exits non-zero when the printer is not
validated so a script can catch it. Use `--dry-run` to check a file without
writing anything.

## Go-live gate

A hotel may go live only when every printer **role it actually uses** has a
`validated` record:

- final receipts → one validated receipt printer;
- food and drink tickets → one validated printer per production point;
- shift closing reports → one validated printer;
- cash drawer → a validated LAN receipt printer, if the hotel takes cash.

`npm run print-agent:compatibility status` prints `Go-live: blocked` and lists
each supported model still without evidence. A `conditional` record closes
nothing on its own: the caveat must be written down and accepted by whoever
signs off the installation.

## When a printer fails validation

1. Do not hide it and do not mark a required check as `pass`. Record the real
   result; a failed record is useful evidence.
2. Check the small things first: cable or LAN reachability, paper width setting,
   cutter command, feed dots, and whether the printer is driver-only.
3. If a workaround works, record it as `conditional` with the workaround in
   `notes`, and tell the hotel what to expect.
4. If nothing works, mark the matrix expectation `unsupported` in
   `tools/print-agent/compatibility.mjs` (with the reason) rather than leaving a
   supported label that traps the next installer.

## Maintaining this document

- Add a model to `MATRIX` in `tools/print-agent/compatibility.mjs` **before**
  anyone tries to record evidence for it. Unknown models are refused.
- Add the same model to the table above; a test fails if the document and the
  data disagree.
- When a model's behaviour changes with a firmware revision, add a new matrix
  entry instead of editing old evidence: evidence is a historical record, not a
  current opinion.
