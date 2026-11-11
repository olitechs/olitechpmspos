# Phase 1 — Repository Audit and Implementation Plan

**Programme:** Upgrade the OliTechs local print agent into a reliable, automatically managed Windows printing service.
**Phase:** 1 of 10 (audit and architecture only — no production code changes in this phase).
**Repository:** `olitechs/olitechpmspos`
**Baseline:** `main` @ `4025a34` ("Clean up platform property access and package controls")
**Audit date:** 2026-11-11

This document is the Phase 1 deliverable. It records what actually exists today, what is missing, and the architecture and test plan the later phases implement. Every statement below was verified against the code at the baseline commit; anything that could not be verified in this environment is listed explicitly in §8.

---

## 1. Executive summary

The product already has a working print agent — it is **not** a greenfield build. `tools/print-agent/server.mjs` (490 lines) is a real Node HTTP service that:

- binds `127.0.0.1:8631` by default;
- prints raw ESC/POS over TCP to LAN printers (ports 9100–9102);
- prints raw ESC/POS through the **Windows spooler** for Windows-installed (USB/Bluetooth-driver) printers;
- scans the local private `/24` networks and mDNS for printers;
- serialises writes per physical printer to stop interleaved tickets;
- supports older URL aliases (`/api/*`, `/print-agent/*`);
- can optionally subscribe to Supabase realtime and print `print_jobs` rows.

It is **started by a Task Scheduler task at user logon**, not by the Windows Service Control Manager.

The web app already has a full printer settings page, role assignments, a durable Supabase-side job table (`fnb_print_jobs`), ESC/POS templates, printer-group routing, and browser WebUSB / Web Bluetooth / Web Serial transports.

So the gaps are about **service lifetime, reliability, queue ownership, authentication and packaging** — not about printing bytes. The correct approach is to harden and wrap what exists (Phase 2 onwards) and explicitly *not* create a second printing system.

The three structural weaknesses that drive the whole programme:

1. **The agent dies when the user logs out** (scheduled task with `InteractiveToken`). Logging out, or a Fast User Switch shutdown, stops printing. A power cycle only restarts it if someone logs in.
2. **The agent is not the owner of the queue.** `fnb_print_jobs` is written *and consumed* by the browser (`src/services/printService.js`). If the browser closes between "job created" and "job printed", the queued job sits there until a staff member clicks retry. The agent only has a partial realtime path for the legacy `print_jobs` table.
3. **The local API has no authentication.** Security is an `Origin` allow-list plus loopback binding. Loopback binding is genuine protection against remote network access, but it is not authentication: any local process, and any page that can reach `127.0.0.1` without an `Origin` (non-browser clients, `file://`, some embedded webviews), can print. `PRINT_AGENT_HOST` can also be set to `0.0.0.0`, which removes the network boundary entirely.

Everything else in the ten-phase brief (tray app, installer, diagnostics, paper-out reporting) is genuinely absent and must be built new.

---

## 2. Current architecture

### 2.1 Component map (verified)

| Concern | Implementation | Location |
| --- | --- | --- |
| Local agent process | Node ESM HTTP server | `tools/print-agent/server.mjs` |
| Agent entry point | Re-export shim | `tools/print-agent/print-agent-v2.js` (`import './server.mjs'`) |
| Agent auto-start | Scheduled Task "OliTechs Print Agent", `AtLogOn`, `InteractiveToken`, Limited | `tools/print-agent/install-windows.ps1` |
| Agent launcher | PowerShell wrapper resolving `node.exe` | `tools/print-agent/run-windows.ps1` |
| Agent removal | Unregister scheduled task | `tools/print-agent/uninstall-windows.ps1` |
| One-click installer | `.cmd` prompt for workspace/agent ID + service-role key | `install-print-agent.cmd` |
| ESC/POS payload builder | Shared `buildEscPosPayload` / `finishPrintJob` | `src/services/escposJob.js` |
| Receipt / KOT / BOT / void / refund / shift templates | Text + HTML builders | `src/services/printTemplates.js`, `src/services/printService.js` |
| Browser transports (USB/BT/serial/system) | WebUSB, Web Bluetooth, Web Serial, `window.print()` | `src/services/printerService.js` |
| Print-orchestration service | Property printers, assignments, jobs, retries | `src/services/printService.js` (913 lines) |
| Printer-group routing | Group-by-category → `print_jobs` insert | `src/services/printRoutingService.js`, `src/services/printRoutingCore.js` |
| Printer settings UI | Roles, discovery, Windows printer list, test prints | `src/pages/SettingsPrinters.jsx` (564 lines) |
| Kitchen printer page | `fnb_print_jobs` monitor | `src/components/settings/KitchenPrintersPage.jsx` |
| Thermal settings persistence | `localStorage` key `olitechs:thermal-printer-settings:v1:<printerId>` | `src/services/printerPrintSettings.js` |
| Server-side public print path | Supabase Edge Function "print-proxy" | `supabase/functions/print-proxy/index.ts` |
| Legacy workspace printer stack | `printers`, `printer_groups`, `print_agents`, `print_jobs` | `supabase/migrations/0061_printer_recode_settings.sql` and earlier |
| Property printer stack | `property_printers`, `printer_assignments`, `fnb_print_jobs`, `print_logs` | `supabase/migrations/0044_*.sql`, `20261008152500_phase5_fnb_print_recovery.sql` |

### 2.2 Two parallel print stacks (important)

The repo contains **two** printer data models that overlap:

- **Property stack (current, actively developed):** `property_printers` + `printer_assignments` (roles: `food_orders`, `drinks_orders`, `void_food_orders`, `void_drinks_orders`, `unsettled_bills`, `final_receipts`, `reports`, `shift_reports`, `refund_slips`) + `fnb_print_jobs` (durable queue) + `print_logs` (audit trail). Used by `printService.js` for receipts, KOT/BOT, voids, refunds, shift reports. This is where receipts and kitchen tickets are actually printed today.
- **Workspace stack (legacy/printer-group):** `printers` + `printer_groups` + `print_agents` + `print_jobs` (raw ESC/POS base64). Used by `printRoutingService.printOrder()` when the `printerGroupRouting` feature flag is on, and consumed by the agent's realtime subscription to `print_jobs`.

`printService.js` (property stack) prints by **direct HTTP to the local agent**; `printRoutingService.js` (workspace stack) prints by **inserting a row and letting the agent's realtime subscription pick it up**. Both are reachable in the running app depending on feature flags and screen. This duplication is the single biggest source of duplicate-print risk in Phase 4.

The plan keeps both stacks working throughout (no silent removal), but only **one** of them may become the agent-owned queue in Phase 4 — see §5.

### 2.3 Current diagram — print path as it exists today

```
                     ┌─────────────────────────────────────────────┐
                     │  Browser (Vite SPA, React 18, Supabase JS)   │
                     │                                             │
  SettingsPrinters ──┤  printRoutingService ─► print_jobs  (legacy) │
  POS / Front desk ──┤  printService         ─► fnb_print_jobs     │
                     │        │                    (property)       │
                     │        │  ESC/POS base64                    │
                     └────────┼────────────────────────────────────┘
                              │  fetch http://127.0.0.1:8631
                              │  (Origin allow-list, no auth token)
                              ▼
              ┌───────────────────────────────────────┐
              │ tools/print-agent/server.mjs (Node)   │
              │ Task Scheduler: AtLogOn, Interactive  │
              │                                       │
              │  /health /discover /windows-printers  │
              │  /print /test /windows-print /open-..  │
              │  per-printer write queue (in memory)  │
              └───────┬───────────────────────┬───────┘
                      │ raw TCP 9100-9102     │ winspool.drv WritePrinter
                      ▼                       ▼
              ┌───────────────┐       ┌────────────────────┐
              │ LAN thermal   │       │ Windows-installed   │
              │ ESC/POS       │       │ printer (USB/BT)    │
              └───────────────┘       └────────────────────┘

  Optional/parallel paths (still present):
   • Browser WebUSB / Web Bluetooth / Web Serial / window.print()
   • Supabase Edge Function "print-proxy" (public TLS endpoint, CORS "*")
   • Agent → Supabase realtime on print_jobs (service-role key on POS PC)
   • Agent heartbeat/discovery → print_agents, printers
```

### 2.4 How receipt and kitchen printing work today

1. `printReceipt('UNSETTLED' | 'FINAL', data)` loads `property_settings`, resolves `printer_assignments` for `unsettled_bills` / `final_receipts`, and loops over every assigned printer × every copy label (`CUSTOMER COPY`, `CASHIER COPY`, …).
2. Each copy is rendered independently (`buildUnsettledReceiptText` / `buildFinalReceiptText`), converted to ESC/POS bytes, optionally with a raster logo, then base64-encoded.
3. `printToPrinter()` creates an `fnb_print_jobs` row (`status: queued`), flips it to `printing`, calls the agent (`/print` for `network_ip`, `/windows-print` for `windows_printer`, or browser APIs for `usb`/`bluetooth`/`serial`), then writes `printed` or `failed` plus a `print_logs` row, and updates `property_printers.is_online` / `last_status` / `last_error`.
4. Kitchen/bar: `printOrderByCategory()` splits lines by drink vs food, renders a KOT/BOT per target printer, and uses the same `printToPrinter()` path. `printRoutingService.printOrder()` is the alternative group-based path that inserts `print_jobs` instead.
5. Voids (`printVoidTicket`), refunds (`printRefundSlip`) and shift reports (`printShiftReport`, two copies) reuse the same pipeline and write back `pos_void_items.status`.

**Critical property:** every one of these paths requires the serving browser tab to stay open for the duration of the print. That is precisely what the brief's Scenarios B and C demand be removed.

### 2.5 Printer configuration today

- Per printer (`property_printers`): `name`, `type` (`receipt_80mm`/`kitchen`/`bar`/`label`), `connection_type`, `ip_address`, `port`, `windows_printer_name`, `agent_url`, `paper_width`, `character_width`, cut/feed settings, `open_drawer_after_sale`, `is_online`, `last_status`, `last_error`, `last_tested_at`, `last_connected_at`.
- Role assignment is a separate table (`printer_assignments`, unique on `printer_id, assignment_type`), enforced by a dedicated atomic-save RPC (`20261012140000_phase1_printer_authorization_atomic_save.sql`).
- Thermal cut/feed profile is stored **in browser `localStorage`**, not in the database (`printerPrintSettings.js`). This is a real gap for a service-based agent: a Windows session's calibration does not exist for a service running outside that session.

### 2.6 Existing failure and recovery handling

Present:
- Six-second client timeout with distinct `LOCAL_AGENT_UNAVAILABLE` / `LOCAL_AGENT_TIMEOUT` codes and human-readable messages.
- TCP `ETIMEDOUT` / `ECONNREFUSED` mapping to friendly text; write-drain and `close`-before-drain detection in the agent.
- Per-printer serialisation of concurrent writes.
- `fnb_print_jobs` + `fnb_print_jobs_recovery_idx`, `attempts`, `last_attempt_at`, `retry_of`, and a manual `retryFnbPrintJob()` that prefers an online printer.
- Printer status persisted (`is_online`, `last_status`, `last_error`) and surfaced in the settings UI with Connected / Offline / Not verified badges.
- Windows scheduled task restarts the process up to 10 times at 1-minute intervals.
- `print_logs` audit rows for every attempt.

Missing:
- No restart of a *completed* processing that crashed mid-write (no "uncertain" state).
- No automatic retry loop; only manual per-job retry from the UI.
- No background worker of any kind that drains `fnb_print_jobs` without a browser.
- No duplicate suppression: `createFnbPrintJob` has no idempotency key, and neither request path deduplicates.
- No printer health polling; status only changes when a human presses Test.
- No paper-out / offline / error-state interpretation from the spooler (`Get-Printer` output is fetched but `PrinterStatus` is not used for anything).
- No service-level supervision (Task Scheduler `RestartCount` is not a crash-loop-safe policy and does not cover logoff).

---

## 3. Missing functionality vs. the brief

| Brief requirement | Status |
| --- | --- |
| 2A Windows Service, auto-start, survives logoff | **Missing** — Task Scheduler at logon, interactive token |
| 2A SCM recovery policy, single-instance, controlled shutdown | **Missing** |
| 2A Service-compatible printer access | **Unverified** — spooler RAW printing works per-user today; service-account context must be validated |
| 2A Structured logging | **Missing** — `console.log` only, no rotation, no file |
| 2B Tray application | **Missing** entirely |
| 3 Discovery + setup wizard (detect, name, roles, paper, test, save) | **Mostly present** in `SettingsPrinters.jsx`; needs agent detection, role-first wizard flow, and no-terminal install messaging |
| 4 Persistent queue with states/timestamps/idempotency/uncertain state | **Partial** — table exists, browser-owned; no idempotency, no `uncertain` state, no worker |
| 5 Automatic recovery (A–H) | **Partial** — A/B fail (browser/terminal dependence), D/E only manual, F/G depend on the task, H not implemented |
| 6 Dashboard | **Partial** — settings page exists; no agent/queue/last-print health dashboard |
| 7 Security, pairing, rate limits, tenant isolation | **Partial** — loopback + origin allow-list + tenant RLS on data; **no auth token/pairing**, no rate limit, no service hardening |
| 8 Installer, signed updates, rollback, clean uninstall | **Missing** — `npm` + PowerShell only; `install-print-agent.cmd` path is broken |
| 9 Diagnostics export | **Missing** |
| 10 Compatibility matrix | **Missing** — and cannot be produced in this environment (no Windows, no printer hardware) |

### 3.1 Defect found during the audit

`install-print-agent.cmd` line 26 invokes:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0toolsprint-agentinstall-windows.ps1"
```

The backslashes have been stripped from the path, so the "one-click" installer can never find `tools\print-agent\install-windows.ps1`. This confirms that the current installer path has not been exercised recently, and is fixed as part of Phase 8 (installer), with a regression test on the path expression in Phase 2.

### 3.2 Security observations to carry into Phase 7

- `PRINT_AGENT_HOST` can be set to `0.0.0.0`; nothing warns or blocks it.
- `isAllowedOrigin('')` returns `true` for empty origins (intentional for CLI clients) — this is the main unauthenticated hole.
- `install-print-agent.cmd` prompts for a **Supabase service-role key** and stores it with `setx` in the user's environment. That is a full-tenant bypass key on a POS workstation; the cloud-realtime path should be redesigned rather than extended.
- `print-proxy` is a public HTTPS endpoint with `Access-Control-Allow-Origin: *`. It only accepts IPv4 + 9100–9102, but it lets anyone who can reach Supabase Functions attempt prints to LAN addresses. It must be rate-limited, authenticated, or retired.
- `window.localStorage` holds printer calibration; not a secret, but session-scoped and not service-readable.

---

## 4. Proposed architecture

Constraints that shape the design:

- The web app must remain a static Vite SPA on Vercel — no server runtime may be introduced for printing.
- The existing `property_printers` / `printer_assignments` / `fnb_print_jobs` model and `SettingsPrinters.jsx` workflow must keep working.
- ESC/POS construction must stay in `src/services/escposJob.js` + `printTemplates.js` and remain shared (the Edge Function and the agent already import from `src/`).
- No customer secrets may be embedded in the workstation, so the agent must not depend on a service-role key.

### 4.1 Proposed diagram

```
┌───────────────────────────────────────────────────────────────────┐
│ Olitech web app (Vite SPA, Vercel)                                │
│  SettingsPrinters / Print dashboard                               │
│    • agent detection (GET /health with pairing token)             │
│    • wizard: detect → choose → role → paper → test → confirm      │
│    • queue view, retry, diagnostics download                      │
└───────────────┬───────────────────────────────────────────────────┘
                │ 1. enqueue (RLS, tenant-scoped)   2. authenticated
                │    Supabase  fnb_print_jobs          loopback API
                ▼                                          ▲
   ┌──────────────────────────────┐                        │
   │ Supabase (Postgres + RLS)    │                        │
   │  fnb_print_jobs              │                        │
   │  print_job_events (new)      │                        │
   │  printer_agents (new, paired)│                        │
   │  property_printers           │                        │
   └──────────┬───────────────────┘                        │
              │ 3. poll/realtime claim (agent credentials)  │
              ▼                                             │
┌────────────────────────────────────────────────────────────┴──────┐
│ WINDOWS SERVICE  "OliTechsPrintAgent"  (SCM)                      │
│  • auto start, restart-on-failure, no user session required       │
│  • single-instance mutex + lease on jobs                          │
│  • persistent local spool (SQLite) for outbound jobs              │
│  • job states: queued → claimed → printing → printed              │
│                         ↘ failed | uncertain (manual retry)       │
│  • printer monitor loop (spooler status, TCP probe)               │
│  • structured JSON logs + rolling file + in-memory ring buffer    │
│  • local API 127.0.0.1:8631 (paired token, origin allow-list,     │
│    rate limit, body limit, tenant binding)                        │
│  • transports: raw TCP ESC/POS | winspool RAW                     │
└──────────┬────────────────────────────────────┬───────────────────┘
           │ raw TCP 9100-9102                  │ WritePrinter (RAW)
           ▼                                    ▼
    ┌──────────────┐                    ┌──────────────────────┐
    │ LAN ESC/POS  │                    │ Windows spooler      │
    └──────────────┘                    │ (USB / BT driver)     │
                                        └──────────────────────┘
┌───────────────────────────────────────────────────────────────────┐
│ Tray app (optional, .NET self-contained, talks to same local API) │
│  status • pending • last print • settings • test • restart •      │
│  troubleshooting • export diagnostics                             │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Key design decisions

1. **Service, not task.** Ship the existing Node agent under a proper Windows service host. Recommended: **WinSW** (single signed-capable EXE + XML config) because it gives SCM `startmode=Automatic`, `<onfailure>` restart with reset period, `<stoptimeout>`, log redirection and `<serviceaccount>` without adding a native Node dependency or rewriting the agent in C#. Alternative considered: `node-windows` (adds a dependency and a wrapper script; weaker recovery semantics) and rewriting in .NET (too large, duplicates ESC/POS logic). The service runs as `LocalSystem` by default because **spooler RAW printing as a normal user is not reliably available to a service**; printer access is validated in Phase 2 and documented as a known limitation if a customer requires a restricted account.
2. **The agent owns the queue.** `fnb_print_jobs` remains the system of record (audit, RLS, tenant scoping) and the agent becomes its consumer via a **job-claim RPC** (`SECURITY DEFINER`, agent credential, `FOR UPDATE SKIP LOCKED`), not via the browser. The browser keeps printing immediately for interactive feedback but the job is considered durable only once enqueued, so a browser close cannot lose a job.
3. **Persistent local spool.** A small SQLite (or JSON-WAL) spool inside `%ProgramData%\OliTechs\PrintAgent` holds claimed payloads so a crash between claim and spool-drain can be resolved to `uncertain` rather than silently lost.
4. **Idempotency.** Every job gets a deterministic `idempotency_key` (`property_id + assignment_type + document_id + copy`), unique in `fnb_print_jobs`; duplicate submissions collide instead of printing twice.
5. **Uncertain is a first-class state.** If bytes were handed to the spooler/TCP socket but no completion confirmation exists, the job becomes `uncertain` and requires a manual, clearly-labelled reprint. Never auto-resend.
6. **Pairing, not CORS.** Phase 7 adds a one-time pairing code issued from Olitech, exchanged for a long random token stored in `%ProgramData%` (ACL'd to `SYSTEM` + `Administrators`). Every API call carries it. Origin checks stay as defence in depth, and empty `Origin` stops being sufficient.
7. **No service-role key on workstations.** The existing service-role-key path is replaced by a scoped agent credential (a Supabase auth user with an `agent` role, or a signed agent JWT minted server-side) whose RLS grants only its own property's printer rows and job claims.
8. **Tray app is optional and independent** — it only calls the local API; the service never imports tray code.
9. **One template engine.** Receipts/KOT/BOT/voids/refunds/shift reports keep using the shared `escposJob.js` + `printTemplates.js` builders, so rendering cannot drift between the browser and the service.

### 4.3 Phase dependency notes

- Phase 2 (service) is a hard prerequisite for 4, 5 and 8.
- Phase 4 (queue) touches DB schema → requires the repo's reviewed migration workflow and **must not** be applied to production as part of the PR (see `supabase/migrations/README.md` and the existing convention used by `docs/PRINT_AGENT_SETUP.md`).
- Phase 6 (dashboard) depends on the Phase 4 read model.
- Phase 7 (security) must land **before** Phase 8 ships anything to a customer, because the installer will distribute the authenticated build.
- Phase 10 cannot be completed in this environment; it needs real Windows machines and printers.

---

## 5. Files and modules to change

### Phase 2 — Service foundation
- `tools/print-agent/server.mjs` — extract `createServer()`/`start()` so it can be hosted; add `/health` detail (uptime, pid, version, queue depth), graceful `SIGTERM`, single-instance guard.
- `tools/print-agent/run-windows.ps1` — keep as a diagnostic entry point only.
- `tools/print-agent/install-windows.ps1`, `uninstall-windows.ps1` — service install/uninstall, recovery config, idempotent re-install.
- **New** `tools/print-agent/service/OliTechsPrintAgent.xml` (WinSW config), `tools/print-agent/service/install-service.ps1`, `uninstall-service.ps1`, `tools/print-agent/config.js` (config load/validation/`%ProgramData%` paths).
- **New** `tools/print-agent/logger.mjs` — structured JSON logging with rotation and redaction.
- `install-print-agent.cmd` — fix the broken script path; remove the service-role-key prompt (moves to pairing in Phase 7).
- `package.json` — new scripts; `tools/print-agent/README.md`, `docs/PRINT_AGENT_SETUP.md` updated.

### Phase 3 — Discovery and setup wizard
- `tools/print-agent/server.mjs` — richer `/discover` (USB/Windows + LAN + mDNS, stable ids, friendly names, online/offline).
- `src/pages/SettingsPrinters.jsx` — wizard step machine, agent detection banner, role-first assignment, paper/settings step, test-then-confirm.
- `src/services/printService.js` — `discoverAgentPrinters()`, `getAgentHealth()`.
- **New** `src/components/settings/PrinterSetupWizard.jsx` (or split into steps under `src/components/settings/printer-wizard/`).
- **New** tests `src/pages/SettingsPrinters.wizard.test.mjs`.

### Phase 4 — Persistent queue
- **New** migration `supabase/migrations/<ts>_print_queue_durable.sql`: `fnb_print_jobs` additions (`idempotency_key` unique, `claimed_by`, `claimed_at`, `lease_expires_at`, `uncertain` status), `print_job_events`, claim/complete RPCs, agent-scoped RLS.
- **New** `tools/print-agent/queue/spool.mjs` (local durable spool), `tools/print-agent/queue/worker.mjs` (claim → print → complete, retry/backoff, uncertain).
- `src/services/printService.js` — send `idempotency_key`, surface new states, keep interactive path.
- `src/services/printRoutingCore.js` / `printRoutingService.js` — route through the same queue instead of ad-hoc inserts.
- **New** tests `tools/print-agent/queue/worker.test.mjs`, `spool.test.mjs`, `supabase/tests/print_queue_contract.test.mjs`.

### Phase 5 — Recovery and monitoring
- **New** `tools/print-agent/monitor.mjs` (spooler status poll, TCP probe, offline→online resume, recovery event log).
- `tools/print-agent/queue/worker.mjs` — resume-on-reconnect, crash reconciliation on startup.
- `service/OliTechsPrintAgent.xml` — `onfailure`/reset policy.
- UI status surfacing in `src/pages/SettingsPrinters.jsx`.
- **New** tests `monitor.test.mjs`, `recovery.test.mjs`.

### Phase 6 — Dashboard
- **New** `src/pages/PrintDashboard.jsx` (or a section of `SettingsPrinters.jsx` if routing/nav prefers that), nav registration in `src/data/modules/navArchitecture.js` / `sidebarNavigation.js`, route in `src/App.jsx`.
- `src/services/printService.js` — dashboard read model (`getPrinterHealth`, `getQueueSummary`).
- Reuse `design-system/olitechs-pms-pos/MASTER.md` components and tokens.

### Phase 7 — Security
- `tools/print-agent/server.mjs` — token auth, rate limit, body limit, tenant binding, origin hardening, refusal to bind non-loopback.
- **New** `tools/print-agent/security/pairing.mjs`, `tokens.mjs`.
- **New** migration for `printer_agents` (pairing codes, token hashes, property scope).
- `supabase/functions/print-proxy/index.ts` — authenticate + rate limit, or retire.
- `supabase/migrations/0061_printer_recode_settings.sql` follow-up migration removing service-role reliance.
- **New** tests `security.test.mjs` (replacing source-text assertions with behaviour tests where feasible).

### Phase 8 — Installer and updates
- **New** `installer/` (Inno Setup or WiX) building a signed `.exe`/`.msi` that bundles the Node runtime, installs the service, optional tray app, preserves `%ProgramData%\OliTechs`.
- **New** `tools/print-agent/update/` (manifest verification, staged swap, rollback).
- `install-print-agent.cmd` — becomes a thin bootstrap that launches the installer.

### Phase 9 — Diagnostics
- **New** `tools/print-agent/diagnostics.mjs` (report assembly + redaction) and `GET /diagnostics`.
- Tray app export action; dashboard "Export diagnostics".
- **New** `docs/print-agent/TROUBLESHOOTING.md`.

### Tests to extend (existing suites that must keep passing)
`tools/print-agent/server.security.test.mjs`, `tools/print-agent/thermal-output.contract.test.mjs`, `src/services/escposJob.test.mjs`, `src/services/printService.thermal.test.mjs`, `src/services/printRoutingCore.test.js`, `src/services/printTemplates.test.js`, `src/pages/SettingsPrinters.rpcContract.test.mjs`, `supabase/tests/printer_cash_drawer_schema_contract.test.mjs`, `supabase/tests/printer_character_width_migration.test.mjs`.

---

## 6. Implementation checklist

- [x] Phase 1 — audit, diagrams, plan (this document; no production code changed)
- [ ] Phase 2 — Windows service: SCM install, auto-start, recovery, graceful shutdown, structured logs, single instance, health endpoint, service-account printer validation
- [ ] Phase 3 — discovery + non-technical wizard (detect agent → printers → role → settings → test → save)
- [ ] Phase 4 — durable queue: local spool, server-side claim, idempotency key, `uncertain` state, controlled retry
- [ ] Phase 5 — automatic recovery A–H + printer monitoring (USB/network disconnect, paper-out where reported)
- [ ] Phase 6 — Olitech printer dashboard (agent, printer, queue, last print, troubleshooting actions)
- [ ] Phase 7 — pairing/token auth, non-loopback refusal, rate limits, tenant isolation, print-proxy decision
- [ ] Phase 8 — signed installer, bundled runtime, safe upgrade + rollback, clean uninstall, version reporting
- [ ] Phase 9 — diagnostics export with redaction + troubleshooting guide
- [ ] Phase 10 — real-device QA, compatibility matrix, lint/typecheck/build/test on Windows

---

## 7. Phase-by-phase test plan

Automated (runs in CI/Linux; must not require Windows or hardware):

| Phase | Tests |
| --- | --- |
| 2 | Service config XML parses and contains Automatic start + restart-on-failure; `install-*` scripts reference existing paths (guards the §3.1 defect); `/health` returns version/uptime/queue depth; SIGTERM exits within timeout; second instance refuses to start |
| 3 | Discovery response schema; wizard step transitions; role→assignment mapping; "no printers found" guidance; agent-not-running state |
| 4 | Idempotency collision inserts once; claim is exclusive under concurrency (`SKIP LOCKED`); crash between claim and write yields `uncertain`; retry only for eligible failures; spool survives restart; duplicate submit never double-prints |
| 5 | Offline→online resumes only pending jobs; error mapping (paper-out/unreachable) produces actionable text; max attempts honoured; no auto-resend of `uncertain` |
| 6 | Dashboard read model shape; empty/offline/error states render; actions wired to correct service calls |
| 7 | Unauthenticated request → 401; wrong-origin → 403; rate limit → 429; oversized body → 413; non-loopback bind refused; cross-property job claim denied |
| 8 | Installer manifest checksums verify; failed update rolls back to previous version and keeps config; uninstall keeps `%ProgramData%` unless confirmed |
| 9 | Diagnostics excludes tokens/passwords/guest/payment fields; report schema stable |
| 10 | Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:architecture`, plus the new suites |

Manual, real-device (cannot be satisfied here — Phase 10):
install without terminal; service survives logoff; restart Windows; force-kill recovery; USB disconnect/reconnect; network printer disconnect/reconnect; duplicate submit; paper-out; upgrade; rollback; uninstall; receipt + kitchen + multi-role printing; tenant isolation with two properties.

Each phase's PR must state which of these were executed, on what Windows version and printer model, and which remain unverified.

---

## 8. Risks, dependencies and unverified items

**Risks**
- **Session vs service printer access.** Windows printers installed for one user may not be visible to a service account. Mitigation: validate in Phase 2, prefer per-machine drivers, document the requirement; the settings UI must distinguish "installed for this user" from "available to the service".
- **Engineering drivers.** `winspool` RAW path assumes the driver accepts raw ESC/POS (typical of generic/text-only thermal drivers). GDI-only drivers will print garbage. Must be detected and documented, not guessed.
- **Dual stack → double printing.** Mitigated by a single idempotency key and one claiming path in Phase 4; the legacy `print_jobs` realtime consumer is retired behind a flag only after the property queue is proven.
- **Schema migration risk.** New columns/statuses on `fnb_print_jobs` affect a live queue; migration must be additive, with the `check` constraint widened before any writer emits new statuses.
- **Service-role key on workstations (existing).** Must be removed, not carried forward.
- **Vercel/CORS/PNA.** Chromium Private Network Access preflight is already handled; the pairing token must be sent as a header the preflight allows.
- **Node runtime dependency.** Customers currently need Node 20+; Phase 8 must bundle it, otherwise the "no terminal" goal is not met.

**Unverified in this environment (must not be claimed as supported)**
- Any Windows version behaviour (no Windows host available).
- Any specific printer model, USB/BT/network transport, or driver.
- Whether a `LocalSystem` service can reach a given spooler queue on a customer machine.
- Whether the current agent actually runs on a workstation today (the broken installer path suggests the packaged install flow was not recently exercised).
- Supabase production schema state (migrations are reviewed separately; production was not inspected).

**Dependencies**
- Reviewed migration workflow for any schema change (Phases 4, 7).
- A Windows 10/11 test workstation with at least one USB thermal printer and one network ESC/POS printer (Phase 10).
- Code-signing certificate for Phase 8 releases.
- Product decision (needed before Phase 6): keep both printer stacks, or formally deprecate the workspace/`print_jobs` stack.

---

## 9. Phase 1 outcome

The existing system is understood end to end: a Node loopback agent driven by Task Scheduler, two overlapping Supabase printer models, a browser-owned durable queue, shared ESC/POS builders, and a settings page that already covers most of the Phase 3 user journey.

No production code was changed in this phase. Phase 2 begins with the Windows service foundation described in §4 and §5.
