# OliTechs — Visual Architecture

These Mermaid diagrams are source-controlled architecture visuals. GitHub renders them in this Markdown file. They describe the current architecture and the intended evolution separately; planned components are marked as targets and must not be mistaken for deployed functionality.

## 1. System context

```mermaid
flowchart LR
  Guest[Hotel guest]
  Staff[Hotel staff]
  Owner[Property owner]
  Platform[Platform operator]
  Browser[OliTechs web app]
  Supabase[Supabase Auth + API]
  DB[(PostgreSQL)]
  PrintAgent[Local Print Agent]
  Printer[Receipt / kitchen printer]
  Guest --> Staff
  Staff --> Browser
  Owner --> Browser
  Platform --> Browser
  Browser --> Supabase
  Supabase --> DB
  Browser --> PrintAgent
  PrintAgent --> Printer
```

## 2. Runtime and application layers

```mermaid
flowchart TB
  subgraph Client["Browser — Vite + React 18"]
    Routes[React Router / route guards]
    Pages[Workspace pages]
    Components[Feature components]
    Context[AuthContext + PMS/POS compatibility stores]
    Query[TanStack Query cache]
    Zustand[Zustand — transient UI state as adopted]
    Services[Domain service modules]
    Routes --> Pages --> Components
    Components --> Context
    Components --> Query
    Components --> Zustand
    Context --> Services
    Query --> Services
  end
  Services --> Auth[Supabase Auth]
  Services --> API[Supabase client]
  API --> RLS[PostgreSQL RLS / grants]
  API --> RPC[PostgreSQL RPC / transactions]
  RLS --> Tables[(Property and operational tables)]
  RPC --> Tables
  Realtime[Supabase Realtime] --> Context
  Realtime --> Query
  Services --> Agent[Local Print Agent]
  Agent --> Hardware[LAN / USB / Bluetooth / serial / OS printers]
```

**Current-state note:** QueryClient and service modules exist, but the app remains hybrid. TanStack Query is not yet the exclusive server-state path; the context stores remain important compatibility layers.

## 3. Authentication and workspace entry

```mermaid
flowchart TD
  Start([Open OliTechs]) --> Public{Public route?}
  Public -->|Yes| PublicPage[Landing / sign-in / registration]
  Public -->|No| AuthCheck[Restore Supabase Auth session]
  PublicPage --> SignIn[Sign in or create account]
  SignIn --> SupabaseAuth[Supabase Auth]
  AuthCheck --> SupabaseAuth
  SupabaseAuth --> Identity[Load profile and property membership]
  Identity --> Owner{Platform owner?}
  Owner -->|Yes| Admin[Platform admin routes]
  Owner -->|No| Property{Property active and package assigned?}
  Property -->|No| Pending[Pending approval / setup state]
  Property -->|Yes| Role[Resolve staff role and app entitlement]
  Role --> Allowed{Allowed workspace?}
  Allowed -->|No| Denied[Redirect to permitted workspace / deny]
  Allowed -->|Yes| Workspace[Back Office / Front Office / POS / Stores]
  Admin --> ServerGuard[Server-side authorization still required]
  Workspace --> ServerGuard
```

Client route guards improve navigation and user experience. They do not replace RLS or server-side authorization.

## 4. Reservation to departure lifecycle

```mermaid
flowchart TD
  Enquiry[Guest enquiry / booking source] --> Search[Search dates, occupancy and room type]
  Search --> Availability[Read availability]
  Availability --> Create[Create reservation through service]
  Create --> DBGuard[Database transaction validates overlap and tenant]
  DBGuard -->|Rejected| Conflict[Show conflict / refresh availability]
  DBGuard -->|Accepted| Confirm[Reservation confirmed]
  Confirm --> Arrival[Arrival list / pre-arrival checks]
  Arrival --> CheckIn[Check in through authorized operation]
  CheckIn --> InHouse[In-house stay and assigned room]
  InHouse --> Charges[Room, POS and service charges]
  Charges --> Folio[Folio review and reconciliation]
  Folio --> Balance{Balance settled / approved?}
  Balance -->|No| Resolve[Collect or reconcile payment]
  Resolve --> Folio
  Balance -->|Yes| Checkout[Check out]
  Checkout --> RoomStatus[Update room occupancy / housekeeping state]
  RoomStatus --> Clean[Clean / inspect / release room]
  Clean --> Reports[Operational and financial reporting]
```

The database is the final protection against concurrent room assignment. The UI's availability display is advisory.

## 5. Restaurant POS to kitchen to folio

```mermaid
flowchart TD
  Table[Select outlet / zone / table] --> Session[Open table session]
  Session --> Order[Add menu items, quantities and modifiers]
  Order --> Persist[Persist order/session]
  Persist --> Ticket[Create / update kitchen ticket]
  Ticket --> KDS[Kitchen Display System]
  KDS --> Prep[Accept / prepare / complete]
  Prep --> Serve[Serve items]
  Serve --> More{More items?}
  More -->|Yes| Order
  More -->|No| Bill[Request bill]
  Bill --> Settle{Settlement method}
  Settle -->|Cash / card / mobile payment| Payment[Record and confirm payment]
  Settle -->|Room charge| Folio[Post traceable charge to guest folio]
  Payment --> Receipt[Create receipt / close session]
  Folio --> Receipt
  Receipt --> Stock[Apply configured inventory movements]
  Stock --> Reports[Cashier and sales reports]
```

Payment-provider acknowledgement, inventory deductions and room-charge posting must be verified in their actual implementation before changing the flow. Printing is a side effect; a printer outage must not create a duplicate sale.

## 6. Inventory lifecycle

```mermaid
flowchart TD
  Catalogue[Product / unit / category setup] --> Supplier[Supplier and store setup]
  Supplier --> PO[Create purchase order]
  PO --> Delivery[Receive delivery]
  Delivery --> Verify[Verify received quantities]
  Verify --> Movement[Record stock movement]
  Movement --> Balance[(Store / location balance)]
  POS[POS sale] --> Consume[Configured ingredient / stock consumption]
  Recipe[Recipe / production] --> Consume
  Consume --> Movement
  Count[Stock count / adjustment / transfer] --> Movement
  Balance --> Valuation[Stock valuation and reporting]
  Movement --> Audit[Movement history / audit]
```

Stock changes should be represented as auditable movements and validated by trusted backend authorization. Do not replace a ledger with client-side quantity edits.

## 7. Property tenant security boundary

```mermaid
flowchart TB
  User[Authenticated user] --> Auth[Supabase Auth identity]
  Auth --> Membership[Property membership / staff role]
  Membership --> Request[Request with resource identifier]
  Request --> Policy[RLS policy + grants]
  Request --> RPC[RPC permission and property checks]
  Policy --> Data[(Tenant-scoped data)]
  RPC --> Data
  PlatformOwner[Platform owner identity] --> OwnerCheck[Server-verified platform authority]
  OwnerCheck --> AdminOps[Platform-only administration RPCs]
  AdminOps --> PlatformData[(Platform administration data)]
  Untrusted[localStorage / sessionStorage / client property_id] -. not authority .-> Policy
```

Never trust a client-supplied property ID, role string, hidden button or browser storage flag as authorization evidence.

## 8. Current hybrid state to target offline-first architecture

```mermaid
flowchart TB
  subgraph Current["Current hybrid application"]
    UI[React screens]
    Stores[PMS / POS React context stores]
    Services[Existing domain services]
    Cloud[(Supabase PostgreSQL)]
    UI --> Stores --> Services --> Cloud
  end
  subgraph Target["Target offline-first design — planned"]
    PWA[Installable PWA shell]
    LocalDB[(IndexedDB / Dexie)]
    Repo[Local-first repositories]
    Outbox[Durable mutation outbox]
    Sync[Sync worker / retry / idempotency]
    Cloud2[(Supabase authoritative database)]
    PWA --> Repo --> LocalDB
    Repo --> Outbox --> Sync --> Cloud2
    Cloud2 --> Sync
    Sync --> LocalDB
  end
  Current -. incremental migration .-> Target
  LAN[Optional property LAN Edge Server — future] -. shared multi-terminal offline .-> Cloud2
```

**Important:** browser IndexedDB belongs to one browser profile/device. It does not synchronize reception, restaurant and kitchen computers with one another while the internet is down. Shared property-wide offline operation requires a separately designed LAN Edge Server and reconciliation protocol.

## 9. Delivery pipeline

```mermaid
flowchart LR
  Task[Approved task] --> Inspect[Read docs / inspect source / baseline]
  Inspect --> Plan[Scope / risks / acceptance tests]
  Plan --> Code[Small implementation]
  Code --> Lint[Lint + typecheck]
  Lint --> Tests[Unit / contract / security tests]
  Tests --> Build[Production build]
  Build --> Review[Diff and regression review]
  Review --> Commit[Focused commit / PR]
  Commit --> Deploy[Approved deployment]
  Deploy --> Smoke[Production smoke tests]
  Smoke --> Monitor[Observe / document / next task]
```

## 10. Diagram maintenance

When code changes alter a workflow:
1. Update the relevant diagram and the workflow catalogue in the same change.
2. Label planned capabilities as planned.
3. Do not depict an external provider integration as live without verified credentials, callbacks and tests.
4. Keep diagrams consistent with `Architecture.md`, `Rules.md` and `Phases.md`.
