# STANDALONE — Native Desktop, Android and Offline Platform Specification

**Repository:** `olitechs/olitechpmspos`  
**Assignment keyword:** `STANDALONE`  
**Status:** Architecture proposal / implementation not yet started  
**Purpose:** Evolve OliTechs from its current Vite + React application into installable Windows and Android applications that do not require staff to open a browser, while preserving the existing PMS/POS workflows and adding reliable offline operation.

> This document is an implementation brief, not evidence that native packaging or full offline support already exists. Follow the repository's approval gates before changing application code.

## 1. Required outcome

Deliver OliTechs as:

1. An installable Windows desktop application that launches from the Start menu and runs without staff opening Chrome or Edge.
2. An installable Android application suitable for tablets and phones.
3. A dependable local data layer that allows approved hotel operations to continue during internet outages.
4. Safe synchronization between devices and the central server when connectivity returns.
5. Reliable printing and hardware integration on both platforms.
6. A maintainable codebase that reuses business rules and does not create two competing PMS/POS products.

The software must preserve existing reservations, room planning, guest profiles, folios, cashiering, POS, KDS, inventory, housekeeping, reporting, permissions and audit workflows. No feature may be silently removed to make packaging easier.

## 2. Current implementation reality

The active application is the repository root, not the historical `v6/` tree.

Current stack includes:
- Vite, React 18, JavaScript and TypeScript.
- React Router and Tailwind CSS.
- Supabase JS, PostgreSQL, Supabase Auth, RLS, RPC and Realtime.
- TanStack Query, Zustand, React Hook Form and Zod.
- Existing local Node.js print agent and printer services.

Current architecture is hybrid. PMS and POS still have central React state/orchestration stores, and some screens may use static/demo data. The developer guide explicitly states that full IndexedDB outbox synchronization and a shared LAN Edge Server are target capabilities, not completed features.

Before implementation, inspect the actual current branch, source files, migrations, tests, deployment setup and approved architecture documents. Do not infer completion from a screen, menu item or documentation heading.

## 3. Recommended platform architecture

### A. Shared application UI

Keep the existing React UI as the shared presentation layer initially. Gradually move shared domain logic into well-defined services/modules that can be consumed by both desktop and Android shells.

- TypeScript: preferred for new shared modules and gradual migration of high-risk business logic.
- Do not rewrite the whole application in one operation.
- Keep money, reservations, permissions, folio and inventory rules out of platform-specific UI code.
- Maintain one source of truth for business rules and API contracts.

### B. Windows desktop

**Recommended first choice: Tauri 2 + Rust.**

- Tauri provides an installable desktop shell and uses the operating system's WebView to render the React UI. Staff launch OliTechs as an application, not as a browser tab.
- Rust handles native operating-system integration, secure local storage boundaries, device discovery, service communication and native commands.
- Keep the existing print agent compatible during migration. Do not replace it until the new print path passes hardware and regression testing.
- Provide signed installer/update packages, clear version reporting, safe upgrades and rollback.
- Support automatic startup where appropriate, multiple user accounts, restricted permissions and service recovery.

**Alternative:** Electron if the team needs a bundled Chromium runtime and Node ecosystem more than a smaller native shell. It usually has a larger installation and memory footprint. Do not adopt both Tauri and Electron.

**Alternative for a fully native Windows UI:** C#/.NET with WinUI or WPF. This would require a much larger UI rewrite and should not be selected unless the product explicitly rejects embedded WebView rendering.

### C. Android application

**Recommended choice: Kotlin + Jetpack Compose for native Android capabilities.**

- Package and distribute as an Android APK/AAB.
- Use Kotlin for Android lifecycle, background work, permissions, local database access, Bluetooth, USB and network device integrations.
- Reuse shared API contracts and domain rules where practical.
- The existing React interface may be hosted inside an Android WebView for an initial wrapper, but this is not the same as a fully native Android interface.
- Decide explicitly whether the first Android release is a packaged shared UI or a native Compose interface. Do not build two interfaces accidentally.

### D. Local persistence and offline engine

Use SQLite as the durable local database on Windows and Android, with a platform-appropriate driver. For the existing browser/PWA runtime, IndexedDB may remain useful.

The local data layer must provide:
- Versioned schema and safe migrations.
- Encrypted storage for sensitive local data where supported and appropriate.
- A durable outbox for queued operations.
- Idempotency keys for every replayable mutation.
- Retry with bounded backoff and visible failure states.
- Conflict detection and domain-specific resolution.
- Audit trail and sync cursor/checkpoint.
- Safe recovery after application, device or power restart.

Do not simply cache pages and call that offline support.

### E. Central backend and optional hotel LAN server

Keep Supabase/PostgreSQL as the current central backend unless an approved architecture decision changes it.

For multi-terminal hotel-wide offline operation, design a **local LAN Edge Server** as a separate capability. It can coordinate local terminals and printers while internet connectivity is unavailable, then synchronize with the central service.

A single tablet's SQLite database does not automatically synchronize other hotel devices. Define the LAN server's authority, device authentication, replication, conflict handling and recovery before implementing it.

For customers who require deployment without a managed cloud dependency, investigate a separately deployable backend and database package. This is a distinct deployment mode, not something achieved merely by adding SQLite.

## 4. Language and technology responsibilities

| Technology | Responsibility | Priority |
|---|---|---|
| TypeScript | Shared UI, API contracts and safer business logic | High |
| Rust | Tauri desktop shell and native Windows integration | High for desktop |
| Kotlin | Android app and native device integrations | High for Android |
| SQL | PostgreSQL schema, transactions, policies and migrations | Existing |
| SQLite | Durable local operational data and offline queue | High |
| JavaScript/React | Existing shared interface, maintained during migration | Existing |
| C#/.NET | Optional alternative for a fully native Windows rewrite | Not selected |

Do not add a language just to make the stack look more complete. Every new language needs a clearly owned responsibility, maintainers, tests and build pipeline.

## 5. Required operational behaviour

### Application lifecycle
- Install, launch, sign in, update and uninstall without terminal commands for hotel staff.
- Start reliably after device restart.
- Display app version, device identity, connection status and sync health.
- Recover from a crash without corrupting local transactions.
- Never expose secrets in logs or client bundles.

### Offline operation
Define and test which operations are allowed offline. At minimum, the design must consider:
- Viewing previously synchronized room and reservation information.
- Recording permitted front-desk and POS activity locally.
- Queueing charges and operational changes with unique IDs.
- Showing pending, synchronized, rejected and conflict states.
- Preventing duplicate replay.
- Reconciling concurrent room assignments, payments, stock changes and business-date operations.

Payment-provider confirmation must never be fabricated while offline. A queued payment record is not proof that money was received. Night audit and other financially sensitive operations require explicit safe rules before offline execution is enabled.

### Printing and devices
- Preserve current printer service contracts until replacements are verified.
- Windows: network ESC/POS and Windows spooler compatibility.
- Android: network/IP printing first; Bluetooth Classic/BLE and USB only after device-specific compatibility tests.
- Printer configuration must support role assignment (receipt, kitchen, bar, reports, etc.), test print and clear connection diagnostics.
- A successful socket/API response must not be described as proof that paper physically printed.
- Printing failure must not duplicate a sale, payment or kitchen order.
- Provide a reliable queue, retry policy and operator-visible failure recovery.

## 6. Security requirements

- Enforce property/tenant authorization on the server, not only in the app.
- Use per-device identity and revocable device sessions.
- Store tokens and secrets using platform secure storage; never hardcode service-role keys.
- Encrypt sensitive local records and backups where appropriate.
- Apply least privilege to native services and local APIs.
- Bind local-only services to loopback unless an explicitly secured LAN server is required.
- Authenticate and authorize every LAN device.
- Protect updates with signature verification.
- Maintain auditable user, device and synchronization events.
- Do not weaken RLS or database controls to make offline synchronization easier.

## 7. Phased implementation plan

### Phase 0 — Audit and design approval
- Read all mandatory foundation documents and resolve conflicting approval status.
- Inventory routes, features, services, data stores, migrations, tests and deployment dependencies.
- Mark every workflow implemented, partial, demo/static, planned or unverified.
- Map all browser-only APIs and device dependencies.
- Produce architecture decision records for Tauri/Rust, Kotlin, local database and sync.
- Define offline operation matrix and hardware test matrix.
- No application code or production migrations in this phase.

**Exit:** user approves the architecture, scope, security model and phased acceptance criteria.

### Phase 1 — Windows packaged application proof
- Build a minimal Tauri shell around the existing app.
- Implement secure configuration and local application lifecycle.
- Integrate with existing authentication and printer agent without changing business behaviour.
- Produce a development installer and test on clean Windows machines.
- Verify routes, login, POS, PMS, printing and update/uninstall behaviour.

**Exit:** signed-off Windows proof of concept; no claim of full offline capability.

### Phase 2 — Local data foundation
- Introduce a repository/data abstraction without breaking current services.
- Add SQLite schema, migrations and durable outbox.
- Implement idempotent mutation IDs and sync status.
- Add automated restart, retry, duplicate replay and data recovery tests.

**Exit:** selected workflows pass controlled offline/reconnect tests.

### Phase 3 — Android packaged application
- Build Android shell and secure local configuration.
- Implement native lifecycle, local persistence and permission handling.
- Verify supported tablet screen sizes, keyboard, touch, sleep/resume and reconnect.
- Add network printer support and then Bluetooth/USB only for tested models.

**Exit:** installable Android test build with a documented supported-device matrix.

### Phase 4 — Multi-device LAN operation
- Design and implement the optional LAN Edge Server.
- Authenticate terminals and coordinate local operations.
- Define conflict resolution and synchronization authority.
- Test router/internet failure, server restart, device restart and recovery.

**Exit:** multi-terminal offline acceptance suite passes.

### Phase 5 — Production hardening
- Signed releases, staged updates, rollback and backup/restore.
- Security review, tenant-isolation tests and disaster recovery.
- Full regression tests across PMS, POS, cashiering, KDS, inventory and printing.
- Pilot with a test property before any live hotel rollout.

**Exit:** operational sign-off based on measured acceptance results, not merely a successful build.

## 8. Mandatory tests and acceptance evidence

Every phase must report actual results for:
- Clean install, launch, login, logout, update and uninstall.
- Windows and Android restart/recovery.
- Supported screen sizes and input methods.
- Reservations, room planner, folios, payments and cashiering.
- POS sale, table session, kitchen ticket and receipt.
- Inventory movement and permissions.
- Printer disconnection, reconnection, queue retry and duplicate prevention.
- Offline mutation, reconnect, idempotent replay and conflict handling.
- Tenant isolation, role permissions and device revocation.
- Backup restore and schema migration.
- Build, lint, typecheck and relevant architecture/regression tests.

Physical printing and hardware claims require tests on the actual printer/tablet models. Unit tests alone are insufficient.

## 9. Non-negotiable repository instructions for the assigned agent

1. Start by reading `AGENTS.md`, `docs/AI_DEVELOPER_GUIDE.md` and all mandatory foundation documents.
2. Reconcile the Phase 0 approval statements. If approval is unclear, perform read-only audit and ask before code changes.
3. Work only in the active root application unless a separately approved task says otherwise.
4. Do not delete or replace protected PMS/POS stores, services, routes, receipts, cashiering, night audit or migrations as a shortcut.
5. Do not migrate the entire application to Rust or Kotlin. Use each language only for its assigned platform responsibility.
6. Do not claim that a Tauri WebView is a browser-free rendering engine. It removes the need for staff to open an external browser; it still uses an embedded WebView.
7. Do not claim full offline operation until the durable local data layer, synchronization, conflict handling and tests exist.
8. Never run production database migrations or deploy a production release without explicit user authorization.
9. Keep changes small and reversible. Run the required tests and build, inspect the diff, and report commit SHA.
10. Do not push directly to `main` unless the user explicitly authorizes that action and repository rules permit it.

## 10. Agent completion report

For every phase, report:
- Phase and acceptance criteria.
- Files and modules changed.
- New dependencies and why they are needed.
- Database migrations and whether they were applied.
- Windows/Android versions and physical devices tested.
- Commands and tests actually run, with pass/fail results.
- Existing workflows regression-tested.
- Known limitations, risks and rollback procedure.
- Commit or pull request reference.

**Definition of success:** OliTechs installs and runs as an application on Windows and Android, preserves the existing hotel workflows, safely continues approved work during connectivity loss, synchronizes without duplicate or lost transactions, and provides dependable, testable device and printer support.
