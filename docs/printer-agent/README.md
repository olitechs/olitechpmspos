# OliTechs Printer Agent — Master Implementation Brief

**AI task keyword:** `PRINTER`  
**Repository:** `olitechs/olitechpmspos`  
**Specification folder:** `docs/printer-agent/`  
**Existing runtime to inspect and preserve:** `tools/print-agent/`, `src/services/printerService.js`, `src/services/printService.js`, POS receipt/KDS routing and Printer Management UI.

## How to assign this work to an AI

Give the coding agent access to this repository, then send this single word:

```text
PRINTER
```

That keyword means:

1. Read this complete file first.
2. Read `AGENTS.md`, `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`, `Memory.md`, `README.md`, `docs/AI_DEVELOPER_GUIDE.md` and `docs/PRINT_AGENT_SETUP.md`.
3. Inspect the current branch, git status, existing printer implementation, tests, package scripts and supported hardware paths.
4. Produce a repository-specific audit and phased implementation plan before changing application code.
5. Follow the repository's approval gates. The keyword starts the printer workstream and authorizes the audit; it does not authorize production deployment, destructive refactors, database production changes, or skipping required phase approvals.
6. Keep the work focused on printer reliability, simple setup and recovery for non-technical hotel/restaurant staff.

Do not assume the Windows or Android implementations described below already exist. Verify each capability against source code and physical-device tests. Report each as **implemented**, **partial**, **planned** or **unverified**.

---

## 1. Product goal

Make printing dependable and easy for ordinary reception, cashier, waiter and kitchen staff. A staff member should not need PowerShell, Command Prompt, Node.js, npm, terminal commands, manual service restarts or technical knowledge to connect a supported printer and print receipts or kitchen tickets.

Support two distinct device platforms:

- **Windows POS computers:** a persistent Windows printing service/agent, installed and maintained like normal desktop software.
- **Android POS tablets:** supported network printers configured by IP address and supported Bluetooth printers paired through Android.

Both platforms must use consistent Olitech printer configuration, roles, job status, auditability and safe reprint behavior where practical. Do not force Android to depend on a Windows computer being powered on.

## 2. Existing repository baseline — inspect before changing

The current repository documentation describes a local Node.js Print Agent at `127.0.0.1:8631`, with network ESC/POS printing, Windows spooler transport and browser-based USB/Bluetooth/serial options where supported. Existing documented endpoints include:

- `GET /health` and `GET /status`
- `GET /discover` and `GET /scan-network`
- `GET /printers/list`
- `POST /print`
- `POST /test`
- `POST /open-drawer`
- `GET /windows-printers`
- `POST /windows-print`
- `POST /windows-test`

The documented default port is `8631`; preserve compatibility unless a reviewed migration proves a change is necessary. The existing agent binds to loopback and has browser-origin restrictions. Do not weaken these protections.

Read the live implementation and tests. Documentation is not proof that every endpoint or feature is currently reliable.

## 3. Track A — Windows Printer Agent reliability

### A1. Audit and architecture

Inspect the current Node Print Agent, Windows scripts, package scripts, printer service, UI settings, print routing, receipt generation, kitchen/bar ticket handling and tests.

Determine whether the existing agent can be hosted safely as a Windows Service. Prefer extending the existing implementation over creating a competing print engine.

Produce a diagram and file-level plan covering:
- Windows Service host and lifecycle.
- Local authenticated API and browser integration.
- Printer discovery and device configuration.
- Durable print queue and job state.
- Windows spooler and network ESC/POS transports.
- Installer, upgrade, recovery and diagnostics.
- Security boundaries and property/register identity.

### A2. Install and everyday operation

Provide a normal Windows installer. A non-technical user must not need to install Node.js or run terminal commands.

The installer should:
- Install required runtime components or package them appropriately.
- Register and configure the Windows Service.
- Set automatic startup.
- Configure least-privilege service permissions.
- Provide clear install, repair, update and uninstall flows.
- Preserve printer settings and queued jobs during supported updates.
- Avoid silently changing firewall rules or exposing the service to the LAN.

A tray/status application may be provided for diagnostics and settings, but printing must not depend on the tray app, an open terminal, an open browser, or a logged-in desktop session.

### A3. Service resilience

The Windows Service must:
- Start automatically after Windows boots, before staff sign in.
- Continue when the terminal, browser or tray UI closes.
- Recover after an unexpected service crash using Windows Service Control Manager recovery settings.
- Recover after computer restart.
- Monitor printer availability and reconnect after supported USB/LAN interruptions.
- Keep configuration across restart.
- Log actionable errors without exposing guest, payment or secret data.

Do not claim the PC itself will power on after a power cut unless the BIOS/UEFI and hardware support it. Document optional UPS and firmware settings separately.

### A4. Durable print queue and correctness

Implement persistent job storage and explicit states such as queued, sending, accepted-by-transport, confirmed where genuinely supported, failed and outcome-unknown.

Requirements:
- Jobs survive service and PC restarts.
- Use unique job IDs and idempotency protections.
- Route receipt, kitchen, bar and other tickets to the correct configured printer.
- Retry only when safe.
- Do not blindly resend when the physical print outcome is uncertain; this can create duplicate receipts or kitchen tickets.
- Provide an authorized, auditable reprint action.
- Never mark a job physically printed merely because bytes were accepted by a TCP socket or handed to an OS spooler.
- Keep print failure separate from financial transaction success. A printer outage must not reverse or duplicate a completed sale.

### A5. Windows setup and diagnostics UX

Build a guided setup experience:
1. Detect available printers where supported.
2. Allow network printer IP and port entry.
3. Allow selection of supported Windows-installed printers.
4. Assign printer roles: receipt, kitchen, bar and other configured stations.
5. Select supported paper width/protocol/settings.
6. Run a test print.
7. Save the configuration against the correct property and POS register.

Provide a simple status screen showing agent status, printer status, pending/failed jobs, last successful test/print and clear next steps. Use plain language such as “Printer is offline — check power and network” rather than raw stack traces.

### A6. Security and maintenance

- Bind local endpoints only as required; do not expose an unauthenticated service on all network interfaces.
- Validate exact allowed browser origins; CORS alone is not authentication.
- Authenticate local requests and validate payloads, size limits and rate limits.
- Protect against arbitrary local-network printer scanning or command injection.
- Keep tenant/property/register identity validated by trusted application logic.
- Sign installers and updates where feasible.
- Provide safe update, rollback, repair and clean uninstall.
- Export diagnostics without credentials, guest personal data or payment details.

---

## 4. Track B — Android Tablet Printer support

Android is a separate platform, not a Windows agent running on a tablet. The tablet must be able to print directly to its supported printer without relying on a Windows PC.

### B1. Audit and architecture

Determine whether the current Vite/React application is used as a browser app or PWA on Android and which device APIs are actually available.

Evaluate:
- A native Android/Kotlin companion or app for reliable Bluetooth and background operations.
- A secure bridge between the Olitech POS UI and native printing capability.
- Direct network printing from a suitable Android component.
- Reuse of shared print-job formatting, routing and job identifiers.
- Compatibility with current application authentication, tenant isolation and POS services.

Do not assume a PWA/browser can provide reliable background Bluetooth printing. Do not add a native app unless the audit demonstrates it is needed; document the decision and trade-offs.

### B2. Network printer by IP address

Allow staff to:
1. Choose **Network Printer**.
2. Enter a friendly printer name.
3. Enter the printer IP address.
4. Enter or confirm the printer port and protocol.
5. Select paper width and supported settings.
6. Run a real connectivity/test-print check.
7. Assign printer roles and save.

TCP 9100 is common for raw ESC/POS network printers, but it is not universal. Verify the actual printer model and protocol. Do not scan arbitrary networks or expose raw printer ports to the internet.

Support a stable IP/reservation recommendation and explain that the tablet and printer generally need to be on a reachable local network.

### B3. Bluetooth printer

Allow staff to:
1. Choose **Bluetooth Printer**.
2. Enable Bluetooth if necessary.
3. Grant the required Android permissions.
4. Pair or select a supported printer.
5. Verify the model/protocol.
6. Run a test receipt.
7. Assign roles and save.

Handle Android version differences. In particular, Android 12+ uses runtime Bluetooth permissions such as `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN` where applicable. BLE and Bluetooth Classic are different transports; do not assume they are interchangeable or that every BLE printer supports ESC/POS.

Never ask staff to enter terminal commands or manually edit application configuration files.

### B4. Android reliability

Test:
- App closure and reopening.
- Tablet restart.
- Screen lock and background behavior.
- Wi-Fi disconnect/reconnect.
- Bluetooth disconnect/reconnect.
- Bluetooth disabled or permission revoked.
- Battery optimization and vendor-specific background restrictions.
- Queue persistence and safe recovery.

Use Android-supported background execution mechanisms. Explain any OS restrictions honestly; do not promise uninterrupted background printing without device testing.

### B5. Android security

- Secure the native bridge and authenticate requests from the Olitech application.
- Validate printer addresses, ports, payloads and job ownership.
- Do not expose printer ports to the internet.
- Do not store service-role secrets or payment credentials on the tablet.
- Isolate property, register and user data.
- Use platform permission prompts only when needed and explain why they are requested.

---

## 5. Shared printer setup and mandatory register activation

A POS register must complete printer setup before it can be activated for normal POS operation:

1. Configure at least one supported printer.
2. Assign its role (receipt, kitchen, bar or another configured station).
3. Complete a successful test print.
4. Save configuration against the correct property and register.
5. Show a clear setup-complete state.

Administrators may configure multiple printers and station routing.

**Important:** mandatory initial setup must not mean that staff lose sales when a configured printer temporarily disconnects. If a printer becomes unavailable after activation:
- Keep the POS transaction workflow safe.
- Persist eligible print jobs.
- Show a prominent printer-offline warning.
- Retry safely when connectivity returns.
- Provide a clear, permission-controlled recovery/reprint workflow.
- Never silently claim that an unprinted job succeeded.

Provide an explicitly governed emergency workflow if the business requires sales to continue without printing. Record the user, register, reason and affected job/transaction. Do not add a hidden bypass.

## 6. Shared job lifecycle and routing

Design a consistent job model across Windows and Android, while respecting platform differences.

At minimum record:
- Unique job ID and idempotency key.
- Property, register and user context.
- Job type and target printer/role.
- Creation time and attempt history.
- Transport and printer model metadata.
- Current status and last error.
- Reprint/override actor and reason when applicable.

Support receipt, kitchen, bar, order update and cancellation workflows that already exist in Olitech. Trace the current POS/KDS behavior before changing it. Ensure cancellation and update tickets are not silently lost.

A transport acknowledgement is not proof that paper physically emerged. Where the printer cannot provide physical status, state the limitation accurately.

## 7. Printer compatibility and physical-device testing

Create a maintained compatibility matrix with:
- Platform and OS version.
- Computer/tablet manufacturer and model.
- Printer manufacturer and model.
- Connection type (LAN/IP, USB, Windows spooler, Bluetooth Classic or BLE).
- Protocol and port.
- Paper width.
- Receipt and kitchen ticket results.
- Reconnect behavior.
- App/service restart and device restart behavior.
- Background behavior where relevant.
- Tested date and test evidence.

Use real hardware for compatibility claims. Emulator and unit tests alone do not establish physical printer compatibility. Mark untested combinations as **not yet verified**.

## 8. Implementation phases and approval gates

Execute in small, reviewable phases:

1. **Phase 0 — Audit:** inspect repository and hardware architecture; map current code; identify gaps; provide proposed design, risks, test matrix and file plan. Read-only.
2. **Phase 1 — Shared print-job foundation:** define job lifecycle, idempotency, routing and observability without breaking existing contracts.
3. **Phase 2 — Windows service:** installable Windows Service, automatic startup, health monitoring and recovery.
4. **Phase 3 — Windows durable queue:** persistence, retry safety, duplicate prevention and recovery.
5. **Phase 4 — Windows operator UX:** setup wizard, role assignment, test printing, diagnostics and installer/update flow.
6. **Phase 5 — Android network printing:** IP configuration, protocol validation, test print and saved settings.
7. **Phase 6 — Android Bluetooth:** permissions, pairing, compatibility checks, native bridge if justified, test print.
8. **Phase 7 — Mandatory setup and shared POS routing:** register activation, receipt/kitchen/bar routing and safe offline/unavailable behavior.
9. **Phase 8 — Security and device compatibility:** tenant isolation, local API security, physical hardware matrix and recovery tests.
10. **Phase 9 — Documentation and release readiness:** user guides, support diagnostics, installer verification, rollback plan and production-readiness report.

After each phase, stop and report results for review where approval is required. Do not implement every phase in one uncontrolled change.

## 9. Protected functionality — no regressions

Preserve:
- Existing POS sales, tables, orders and payments.
- Receipt formatting and receipt history.
- Kitchen Display System and kitchen/bar routing.
- Cash drawer behavior and its existing opt-in configuration.
- Front Office, guest folios and room charges.
- Inventory and stock deduction.
- Taxes, reports, night audit and financial history.
- Property/tenant isolation, roles, permissions and subscription entitlements.
- Existing printer settings and supported transports.

Treat `src/services/printerService.js`, `src/services/printService.js`, `tools/print-agent/`, POS components, `src/data/AppStore.jsx`, receipts and related database migrations as high-risk areas. Map dependencies and tests before changing them.

Do not rename/replay applied Supabase migrations or modify production data without the approved migration process and explicit authorization.

## 10. Required verification

For each phase:
- Inspect git status and existing changes first.
- Use a focused feature branch and small Conventional Commits.
- Add/update unit, integration and architecture tests.
- Run the relevant test suite, lint, typecheck and production build; inspect `package.json` for actual script names.
- Test adjacent POS/KDS/payment/receipt workflows for regressions.
- Verify permissions and tenant isolation.
- Review the final diff for unrelated changes.
- Record actual command output and exit status.

Physical-device acceptance tests must include:
- Install without terminal commands.
- Automatic Windows service startup and recovery.
- Closing terminal/browser/tray without stopping Windows printing.
- Windows logout/reboot behavior.
- Android IP printer setup and successful test print.
- Android Bluetooth pairing and successful test print.
- Android app closure/reopen and tablet restart.
- Network/Bluetooth disconnection and reconnection.
- Persistent queue recovery.
- Duplicate submission and uncertain physical outcome.
- Receipt, kitchen and bar routing.
- Reprint authorization and audit trail.
- Configuration persistence and tenant/register isolation.
- Installer update, rollback, repair and uninstall.

Do not claim a physical test passed unless it was run on the named hardware.

## 11. Required phase report

At the end of every phase, report:

1. Phase and outcome.
2. Findings or behavior implemented.
3. Exact files changed.
4. Database migrations, if any, and whether they were only added or actually applied.
5. Commands/tests run and actual results.
6. Physical hardware tested and what remains unverified.
7. Regression checks performed.
8. Security and reliability risks remaining.
9. Branch and commit SHA / pull request link.
10. The next phase and what approval is needed.

No production deployment, merge to protected branch, destructive cleanup or production database migration without explicit user authorization.

## 12. Definition of done

The printer workstream is ready only when:
- Windows printing runs as a properly installed, automatically recovering service independent of terminal/browser/tray lifetime.
- Android tablets can use supported IP network printers and supported Bluetooth printers without a Windows host.
- Setup is understandable to non-technical hotel/restaurant staff.
- Initial printer configuration and test printing are mandatory for register activation.
- Temporary printer failures do not silently lose jobs or duplicate sales/tickets.
- Jobs, routing, retries, errors and reprints are auditable.
- Tenant isolation and local API security are verified.
- Physical-device compatibility is documented honestly.
- Existing POS, KDS, cashier, receipt, front-office and financial workflows pass regression checks.
- Installation, troubleshooting, updates and recovery are documented.

**Guiding principle:** reliable printing first, simple staff experience second, broader hardware compatibility only when verified. Never trade transaction integrity or security for a superficial “connected” status.
