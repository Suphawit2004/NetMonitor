# NetMonitor Frontend Client

Modern, responsive web interface for NetMonitor built with **React 19**, **TypeScript**, **Vite**, and **Lucide React**.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm

### Installation & Run
```bash
# Install dependencies
npm install

# Start development server (Port 5173)
npm run dev
```
Open `http://localhost:5173` in your browser.

### Build for Production
```bash
npm run build
```

---

## 🧪 Testing

### Playwright End-to-End (E2E) Test Suite
The frontend includes 10 comprehensive E2E test scenarios verifying critical flows across all pages:
```bash
# Run headless E2E tests
npm run test:e2e

# Run with interactive UI Dashboard
npm run test:e2e:ui
```

---

## 📂 Key Directory Layout

```text
src/
├── components/
│   ├── detail/          # DeviceInfoModal, TrafficChart, MetricCard
│   ├── discovery/       # NetworkScanModal (Scan & inline name editing)
│   ├── floor/           # FloorCanvas (2D), FloorMapOverlay (Satellite Map), DevicePin
│   ├── layout/          # Navbar, NavbarSearch (Ctrl+K Command Palette)
│   └── ui/              # Modal, ConfirmDialog, Toast
├── context/             # NetworkContext, SimulationContext, SettingsContext
├── pages/
│   ├── FloorPlanPage.tsx   # 2D Floor Plan & Satellite Map with floor selector
│   ├── DeviceListPage.tsx  # Device table with search, filter, and quick actions
│   ├── DeviceDetailPage.tsx# Full device spec, interfaces, VLANs, and telemetry
│   └── ReportsPage.tsx     # Network health overview, alerts, and acknowledge flow
├── services/            # api.ts, mapGeo.ts, detailFactory.ts, traffic.ts, roomStore.ts
└── types/               # TypeScript models and interfaces
```
