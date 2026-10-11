<div align="center">

<img src="docs/assets/banner.svg" alt="Olitech PMS + POS" width="100%"/>

<br/>

**Replace Opera Cloud and the paper ledger with one fast, professional platform.**<br/>
Front Desk · Reservations · Housekeeping · Billing · Restaurant POS — built for Africa, works without internet.

<br/>

[![Live Demo](https://img.shields.io/badge/LIVE%20DEMO-olitechpmspos.vercel.app-FACC15?style=for-the-badge&labelColor=0A0A0A&logo=vercel&logoColor=FACC15)](https://olitechpmspos.vercel.app)

![License](https://img.shields.io/badge/License-MIT-FACC15?style=flat-square&labelColor=0A0A0A)
![Vite](https://img.shields.io/badge/Vite-FACC15?style=flat-square&labelColor=0A0A0A&logo=vite&logoColor=FACC15)
![React](https://img.shields.io/badge/React_18-FACC15?style=flat-square&labelColor=0A0A0A&logo=react&logoColor=FACC15)
![Supabase](https://img.shields.io/badge/Supabase-FACC15?style=flat-square&labelColor=0A0A0A&logo=supabase&logoColor=FACC15)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS-FACC15?style=flat-square&labelColor=0A0A0A&logo=tailwindcss&logoColor=FACC15)
![Offline First](https://img.shields.io/badge/Offline--first-yes-FACC15?style=flat-square&labelColor=0A0A0A)
![KRA ETR](https://img.shields.io/badge/KRA%20%2F%20ETR-compliant-FACC15?style=flat-square&labelColor=0A0A0A)

[**Features**](#-features) · [**Workflows**](#-workflows) · [**Architecture**](#-architecture) · [**Quick Start**](#-quick-start) · [**Brand**](#-brand) · [**Roles**](#-roles--permissions) · [**Roadmap**](#-roadmap)

</div>

---

## ✨ Why Olitech?

| | |
|---|---|
| 🌍 **Built for African operations** | Power cuts and patchy connectivity are the norm, not the exception. Olitech keeps working offline and syncs when the network returns. |
| 🧾 **Kenya-ready compliance** | KRA / ETR compliant invoicing out of the box. |
| 🔗 **One folio, every department** | Restaurant, bar and room charges land on the same guest folio. No re-keying, no end-of-day reconciliation headaches. |
| ⚡ **Two-click front desk** | Check-in and check-out in two clicks. Drag and drop reservations on the rack. |
| 🏢 **Multi-property ready** | Multiple properties and workspaces under one account. |

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center" width="50%"><b>Dashboard</b><br/><sub>Occupancy, arrivals, departures and revenue at a glance</sub></td>
    <td align="center" width="50%"><b>Room Rack</b><br/><sub>Drag-and-drop calendar with colour-coded status</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/dashboard.png" alt="Olitech dashboard"/></td>
    <td><img src="docs/screenshots/rack.png" alt="Olitech room rack"/></td>
  </tr>
  <tr>
    <td align="center"><b>Folio / Billing</b><br/><sub>Split, transfer, void and city ledger</sub></td>
    <td align="center"><b>Restaurant POS</b><br/><sub>Tables, orders, KDS and room charge</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/folio.png" alt="Olitech folio"/></td>
    <td><img src="docs/screenshots/pos.png" alt="Olitech restaurant POS"/></td>
  </tr>
</table>

> Regenerate all screenshots with `npm run screenshots` (see [Capturing screenshots](#-capturing-screenshots)).

<details>
<summary><b>🎨 Room status colour guide</b></summary>
<br/>

| Status | Colour | Meaning |
|---|---|---|
| 🟩 Vacant Clean | Green | Ready to sell |
| 🟧 Vacant Dirty | Amber | Awaiting housekeeping |
| 🟦 Occupied | Blue | Guest in house |
| 🟪 Checking Out Today | Indigo | Departure due |
| ⬜ Out of Order | Grey, diagonal stripe | Not sellable |

</details>

---

## 🧩 Features

### 🏨 PMS: Property Management

| Module | What you get |
|---|---|
| **Room Rack** | Visual calendar with drag-and-drop reservations and room moves |
| **Reservations** | Create, amend and cancel. Check-in and check-out in 2 clicks |
| **Rates & Inventory** | Room types, rate plans, taxes and fees |
| **Guests** | Guest profiles with full stay history |
| **Folio Management** | Split, transfer, void, and post to City Ledger |
| **Housekeeping** | Dirty, Clean, Out of Order and Inspection workflow |
| **Night Audit** | Day closure and end-of-day rollover |
| **Reports** | Occupancy, ADR, RevPAR and Cashier reports |

### 🍽️ POS: Point of Sale

| Module | What you get |
|---|---|
| **Outlets** | Restaurant, Bar and Coffee Shop POS |
| **Floor & Tables** | Table and floor management |
| **KDS** | Kitchen Display System, so orders reach the kitchen instantly |
| **Room Charge** | Post a bill directly to a guest folio |
| **Inventory** | Automatic stock deduction on sale |

### 🛡️ Platform

- **Offline-first**: keeps working without internet
- **Multi-property and multi-workspace**
- **Role-based access**: Admin, Front Desk, Housekeeping, POS, Accountant
- **KRA / ETR compliant invoicing** (Kenya)

---

## 🔄 Workflows

### 1. Guest journey, from booking to settlement

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#FACC15','primaryTextColor':'#0A0A0A','primaryBorderColor':'#0A0A0A','lineColor':'#0A0A0A','secondaryColor':'#FFFFFF','tertiaryColor':'#FEF9C3','noteBkgColor':'#FEF9C3','noteTextColor':'#0A0A0A','actorBkg':'#FACC15','actorBorder':'#0A0A0A','actorTextColor':'#0A0A0A','signalColor':'#0A0A0A','signalTextColor':'#0A0A0A','fontFamily':'Inter, Segoe UI, Arial, sans-serif'}}}%%
flowchart LR
    A([📞 Booking<br/>Walk-in · Phone · OTA]) --> B[Reservation<br/>created]
    B --> C{Arrival day}
    C -->|Room ready| D[✅ Check-in<br/>2 clicks]
    C -->|Room dirty| H[🧹 Housekeeping<br/>cleans & inspects]
    H --> D
    D --> E[(Guest Folio<br/>opens)]
    E --> F[🍽️ POS charges<br/>Room · Bar · Restaurant]
    E --> G[🛏️ Nightly room<br/>& tax postings]
    F --> I
    G --> I[Folio review<br/>Split · Transfer · Void]
    I --> J[💳 Check-out<br/>& payment]
    J --> K[🧾 KRA / ETR<br/>invoice]
    J --> L[🧹 Room → Dirty]
    L --> H
```

### 2. Restaurant order to room charge

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#FACC15','primaryTextColor':'#0A0A0A','primaryBorderColor':'#0A0A0A','lineColor':'#0A0A0A','secondaryColor':'#FFFFFF','tertiaryColor':'#FEF9C3','noteBkgColor':'#FEF9C3','noteTextColor':'#0A0A0A','actorBkg':'#FACC15','actorBorder':'#0A0A0A','actorTextColor':'#0A0A0A','signalColor':'#0A0A0A','signalTextColor':'#0A0A0A','fontFamily':'Inter, Segoe UI, Arial, sans-serif'}}}%%
sequenceDiagram
    autonumber
    actor W as Waiter
    participant POS as POS Terminal
    participant KDS as Kitchen Display
    participant INV as Inventory
    participant F as Guest Folio
    W->>POS: Open table, add items
    POS->>KDS: Send order to kitchen
    KDS-->>POS: Ready
    W->>POS: Close bill
    alt Room charge
        POS->>F: Post charge to folio
    else Cash / Card / M-Pesa
        POS->>POS: Settle at the till
    end
    POS->>INV: Deduct stock
```

### 3. Room status lifecycle

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#FACC15','primaryTextColor':'#0A0A0A','primaryBorderColor':'#0A0A0A','lineColor':'#0A0A0A','secondaryColor':'#FFFFFF','tertiaryColor':'#FEF9C3','noteBkgColor':'#FEF9C3','noteTextColor':'#0A0A0A','actorBkg':'#FACC15','actorBorder':'#0A0A0A','actorTextColor':'#0A0A0A','signalColor':'#0A0A0A','signalTextColor':'#0A0A0A','fontFamily':'Inter, Segoe UI, Arial, sans-serif'}}}%%
stateDiagram-v2
    direction LR
    [*] --> VacantClean
    VacantClean --> Occupied: Check-in
    Occupied --> CheckingOut: Departure day
    CheckingOut --> VacantDirty: Check-out
    VacantDirty --> Inspection: Cleaned
    Inspection --> VacantClean: Approved
    Inspection --> VacantDirty: Failed
    VacantClean --> OutOfOrder: Maintenance
    VacantDirty --> OutOfOrder: Maintenance
    OutOfOrder --> VacantDirty: Repaired
```

### 4. Daily operations cycle

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#FACC15','primaryTextColor':'#0A0A0A','primaryBorderColor':'#0A0A0A','lineColor':'#0A0A0A','secondaryColor':'#FFFFFF','tertiaryColor':'#FEF9C3','noteBkgColor':'#FEF9C3','noteTextColor':'#0A0A0A','actorBkg':'#FACC15','actorBorder':'#0A0A0A','actorTextColor':'#0A0A0A','signalColor':'#0A0A0A','signalTextColor':'#0A0A0A','fontFamily':'Inter, Segoe UI, Arial, sans-serif'}}}%%
flowchart TB
    M[🌅 Morning<br/>Arrivals · Departures · Housekeeping list] --> D[☀️ Day<br/>Front desk · POS · Folio postings]
    D --> N[🌙 Evening<br/>Cashier shift close]
    N --> NA[🔒 Night Audit<br/>Post room & tax · Close day]
    NA --> R[📊 Reports<br/>Occupancy · ADR · RevPAR]
    R --> M
```

---

## 🏗️ Architecture

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#FACC15','primaryTextColor':'#0A0A0A','primaryBorderColor':'#0A0A0A','lineColor':'#0A0A0A','secondaryColor':'#FFFFFF','tertiaryColor':'#FEF9C3','noteBkgColor':'#FEF9C3','noteTextColor':'#0A0A0A','actorBkg':'#FACC15','actorBorder':'#0A0A0A','actorTextColor':'#0A0A0A','signalColor':'#0A0A0A','signalTextColor':'#0A0A0A','fontFamily':'Inter, Segoe UI, Arial, sans-serif'}}}%%
flowchart TB
    subgraph Client["🖥️ Client: Vite + React 18"]
        UI[shadcn/ui + Tailwind]
        ZS[Zustand<br/>UI & local state]
        TQ[TanStack Query<br/>server cache]
        OFF[(Offline queue)]
    end
    subgraph Supabase["☁️ Supabase"]
        AUTH[Auth]
        PG[(Postgres + RLS)]
        RT[Realtime]
    end
    UI --> ZS
    UI --> TQ
    TQ <--> OFF
    OFF <-->|sync when online| PG
    UI --> AUTH
    PG --> RT --> TQ
    subgraph Host["🚀 Vercel"]
        CDN[Static hosting]
    end
    CDN --> Client
```

| Layer | Technology |
|---|---|
| **Frontend** | Vite · React 18 · Tailwind CSS · shadcn/ui |
| **State** | Zustand + TanStack Query *(migrating from `PmsStore.jsx` / `AppStore.jsx`)* |
| **Backend** | Supabase: Postgres, Auth, Row Level Security, Realtime |
| **Auth** | Supabase Auth *(migrating from the `src/services/authService.js` localStorage layer)* |
| **Deployment** | Vercel |

> **🔐 Multi-tenant by design.** Every table is scoped to a business and branch, and access is enforced with Postgres Row Level Security, so one property can never read another's data.

---

## 🎨 Brand

| | Hex | Use |
|---|---|---|
| ⬛ **Black** | `#0A0A0A` | Sidebar, headers, primary text |
| 🟨 **Yellow** | `#FACC15` | Primary actions, highlights, active states |
| ⬜ **White** | `#FFFFFF` | Surfaces and cards |

Room status colours (green, amber, blue, indigo, grey) stay semantic and are not part of the brand palette.

---

## 🚀 Quick Start

**Prerequisites:** Node.js 18+ and a free [Supabase](https://supabase.com) project.

```bash
# 1. Clone
git clone https://github.com/olitechs/olitechpmspos.git
cd olitechpmspos

# 2. Install
npm install

# 3. Configure environment
cp .env.example .env.local
# then add your keys:
#   VITE_SUPABASE_URL=...
#   VITE_SUPABASE_ANON_KEY=...

# 4. Run
npm run dev

# 5. Build for production
npm run build
```

> **First login:** the first account you create becomes the **Admin**.

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build locally |

---

## 📷 Capturing screenshots

Screenshots are produced from the running app with [Playwright](https://playwright.dev), so they always match the current UI.

```bash
npm i -D playwright
npx playwright install chromium
npm run dev            # in one terminal
npm run screenshots    # in another
```

Add this to `package.json`:

```json
"scripts": { "screenshots": "node scripts/capture-screenshots.mjs" }
```

Set `OLITECH_EMAIL` and `OLITECH_PASSWORD` to log in. Edit the `SHOTS` list in `scripts/capture-screenshots.mjs` if your routes differ.

---

## 👥 Roles & Permissions

| Role | Front Desk | Housekeeping | POS | Billing / Folio | Reports | Settings |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Front Desk** | ✅ | 👁️ | 👁️ | ✅ | 👁️ | ❌ |
| **Housekeeping** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **POS** | ❌ | ❌ | ✅ | 🔸 Room charge only | ❌ | ❌ |
| **Accountant** | ❌ | ❌ | 👁️ | ✅ | ✅ | ❌ |

✅ Full access · 👁️ View only · 🔸 Limited · ❌ No access

> The matrix above is the intended default. Adjust it to match your implementation.

---

## 🗂️ Project Structure

```text
olitechpmspos/
├── src/
│   ├── components/      # shadcn/ui and shared components
│   ├── pages/           # Dashboard, Rack, Reservations, Folio, POS ...
│   ├── services/        # Supabase and auth service layer
│   ├── store/           # Zustand stores
│   └── lib/             # Helpers and utilities
├── docs/
│   ├── assets/          # Banner and diagrams
│   └── screenshots/     # README screenshots (generated)
├── scripts/
│   └── capture-screenshots.mjs
├── .env.example
└── package.json
```

> Update folder names to match the actual repo layout.

---

## 🧭 Roadmap

- [x] Room Rack, Reservations, Folio, Housekeeping, Night Audit
- [x] Restaurant / Bar POS with KDS and room charge
- [x] KRA / ETR compliant invoicing
- [ ] Complete migration from localStorage auth to Supabase Auth
- [ ] Complete migration from `PmsStore` / `AppStore` to Zustand + TanStack Query
- [ ] Design-system refresh: unified palette, calmer dashboard
- [ ] Payments and reporting expansion
- [ ] Roles and licensing
- [ ] Hardware support: receipt and kitchen printers, cash drawers
- [ ] Channel manager and OTA integrations

---

## 🤝 Contributing

1. Fork the repo and create a branch: `git checkout -b feature/my-feature`
2. Commit your changes: `git commit -m "feat: add my feature"`
3. Push and open a Pull Request

Please keep PRs focused, and describe the problem and the fix.

---

## 📄 License

Released under the [MIT License](LICENSE).

---

<div align="center">

**Built with ❤️ for the hospitality industry in Africa.**

[Live Demo](https://olitechpmspos.vercel.app) · [Report a Bug](https://github.com/olitechs/olitechpmspos/issues) · [Request a Feature](https://github.com/olitechs/olitechpmspos/issues)

</div>
