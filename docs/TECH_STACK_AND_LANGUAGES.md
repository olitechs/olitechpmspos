# OliTechs — Languages, Frameworks and Tooling

This document tells developers and AI coding agents which languages are used, where they belong and how to make changes consistent with the repository. The package manifest is the source of truth for installed dependencies; always inspect the current `package.json` before adding or upgrading packages.

## 1. Languages used in the repository

| Language / format | Where it is used | Guidance |
|---|---|---|
| JavaScript (ES modules) | Main application logic, services, utilities, scripts and Print Agent | Primary implementation language today. Follow existing module conventions. |
| JSX | React components and screens under `src/` | Keep components focused; move data access into services/hooks. |
| TypeScript | Compiler configuration, type declarations and any typed modules | TypeScript is available; migrate incrementally. Do not convert whole directories without approval. |
| SQL (PostgreSQL) | `supabase/migrations/`, database functions, RLS policies and tests | Critical for transactional rules, tenant security and data integrity. Review migration history before editing. |
| CSS | `src/index.css`, component styles and styling configuration | Use approved design tokens and responsive/accessibility rules. |
| HTML | `index.html`, templates and generated print/document markup | Keep semantic and accessible markup. |
| JSON | `package.json`, lockfile, manifest, configuration and structured data | Validate syntax; do not commit secrets. |
| Markdown | Product, architecture, design, agent and operational documentation | Update relevant docs when behavior changes. |
| SVG / XML | Brand marks, icons and vector assets | Preserve source artwork and accessible labels. |
| PowerShell | Windows Print Agent install/run/uninstall scripts | Keep scripts safe, explicit and aligned with documented agent port/origin controls. |
| Mermaid | Architecture and workflow diagrams inside Markdown | Keep diagrams synchronized with actual code and label future-state systems clearly. |
| YAML | CI/workflow/config files when present | Inspect existing workflow before editing; do not invent deployment secrets. |
| Shell / Bash | Local developer commands and automation where present | Keep instructions cross-platform where possible. |

## 2. Runtime and framework stack

| Layer | Current technology | Purpose |
|---|---|---|
| Build/dev server | Vite 6 | Local development and production bundling |
| UI runtime | React 18 | Component rendering |
| Routing | React Router 6 | Public, property workspace and platform-admin routes |
| Styling | Tailwind CSS 3, CSS variables | Responsive UI and theme tokens |
| Accessible primitives | Radix UI | Dialogs, menus, controls and interaction primitives |
| Icons | Lucide React | Consistent application icons |
| Animation | Framer Motion | UI motion |
| Forms | React Hook Form + Zod + resolver | Form state and schema validation |
| Server-state cache | TanStack React Query 5 | Fetching, caching and mutations; adoption remains incremental |
| Client/UI state | React Context currently; Zustand installed | Transitional global state and future UI-only state |
| Backend client | Supabase JS | Auth, database access, Realtime and RPC calls |
| Database | PostgreSQL through Supabase | Authoritative operational data, RLS and transactions |
| Charts | Recharts | Reporting and dashboard visualizations |
| Documents | jsPDF, html2canvas, xlsx, papaparse | Document, spreadsheet and CSV export/import |
| Maps | React Leaflet | Map-based interfaces where used |
| Printing | Browser APIs + local Node.js Print Agent | Device and network printer transport |
| Hosting | Vercel deployment target | Frontend hosting and build deployment |

The list describes the inspected package manifest and repository documentation. It is not a guarantee every dependency is used by every module.

## 3. Backend and database technologies

- **Supabase Auth:** authenticated user identity and session lifecycle.
- **PostgreSQL:** persisted property, guest, reservation, POS, inventory and financial data.
- **Row Level Security:** property/tenant-scoped access control.
- **SQL functions/RPC:** atomic business operations, permission checks and concurrency-sensitive workflows.
- **Realtime:** selected live updates, including PMS/POS operational state.
- **Node.js:** tooling and local Print Agent runtime.

Do not move authoritative business rules into browser-only JavaScript when they require concurrency, cross-user security or transactional guarantees.

## 4. State management rules

- Supabase/PostgreSQL is authoritative for committed operational records.
- TanStack Query is the intended server-state cache and mutation layer as domains migrate.
- Existing `PmsStore.jsx` and `AppStore.jsx` remain compatibility/orchestration layers until approved, tested replacements exist.
- Zustand is appropriate for transient UI state such as open panels, selected tabs and local interaction state.
- IndexedDB/Dexie is the intended local structured store for offline operation once implemented and approved.
- localStorage is for small preferences such as theme selection, not reservations, folios, payments, stock or authorization.

## 5. Coding conventions

### JavaScript / JSX
- Use ES module imports/exports.
- Follow the existing alias convention such as `@/services/...`.
- Avoid adding new Supabase calls inside presentational components.
- Keep domain logic in service modules and database functions.
- Preserve component contracts while migrating data ownership.

### TypeScript
- Use explicit interfaces/types at new service boundaries.
- Avoid `any` in new or modified TypeScript.
- Do not force a large JS-to-TS conversion as part of an unrelated feature.

### SQL
- Use additive, forward-only migrations unless an approved plan says otherwise.
- Scope tenant data by server-verified membership.
- Add grants and RLS intentionally; test both allowed and denied cases.
- Use transactions/constraints/RPCs for concurrent reservation, stock and financial operations.
- Never casually rename/reorder existing migration files.

### CSS / design
- Canonical theme tokens are in `src/index.css` and documented by `Design.md`.
- Read `design-system/olitechs-pms-pos/MASTER.md` and the relevant page specification.
- Do not invent arbitrary brand colors, gradients or a competing theme.
- Maintain keyboard focus, readable contrast, responsive layouts and touch-friendly POS controls.

### PowerShell / Print Agent
- Keep the documented local agent port `8631` consistent across code, scripts and setup documentation.
- Preserve loopback binding and trusted-origin protections.
- Do not expose service-role credentials in browser code or public configuration.
- Verify behavior with the local health endpoint and real test hardware.

## 6. Environment and secrets

The browser app uses:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Only public client configuration belongs in Vite-exposed variables. Never put `SUPABASE_SERVICE_ROLE_KEY`, database passwords, provider secrets or private tokens in `VITE_*` variables or committed files.

Use `.env.example` as a template, but inspect it carefully and never copy real secrets into issues, logs or documentation. Keep local secrets in an ignored local environment file.

## 7. Developer commands

Check current scripts in `package.json`. The inspected manifest includes:

```bash
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test:architecture
npm run check:contrast
npm run print-agent
```

## 8. Before adding a dependency

1. Check if the capability already exists in package.json.
2. Check if the repo already has a service/helper for it.
3. Check bundle size, license, maintenance and security implications.
4. Explain why the dependency is needed.
5. Add it only within the approved task scope and update lockfile/docs.
