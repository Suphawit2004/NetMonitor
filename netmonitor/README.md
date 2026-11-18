# NetMonitor Frontend Client

Web interface for NetMonitor built with **React 19**, **TypeScript**, **Vite**, **Leaflet**, **i18next**, and **Lucide React**.

## Getting Started

### Prerequisites
- Node.js 18+
- npm
- `.env` configured from [`.env.example`](./.env.example) (`VITE_API_KEY` matching backend `API_KEY`, optional `VITE_MAP_API_KEY`)

### Installation & Run
```bash
# Install dependencies
npm install

# Start development server (Port 5173, proxies /api -> http://127.0.0.1:8000)
npm run dev
```
Open `http://localhost:5173` in your browser.

### Build & Lint
```bash
npm run lint
npm run build
```
`npm run build` outputs static assets to `dist/`, which should be served behind a reverse proxy (e.g., Nginx or Caddy) that forwards `/api/*` requests to the FastAPI backend on port `8000`.

---

## Testing

### Playwright End-to-End (E2E) Test Suite
First-time browser setup:
```bash
npx playwright install chromium
```
The frontend includes **18 E2E scenarios** across two specs (requires PostgreSQL, FastAPI backend `:8000`, and Vite dev server `:5173` — or Playwright's configured dev server):
- `e2e/netmonitor.spec.ts` (10 scenarios: navigation tabs, `Ctrl+K` search, TH/EN & theme switching, floor switching, 2D/Map toggle, Move mode, device list KPI/search filters, detail metrics/charts, reports severity counters)
- `e2e/fault-simulation.spec.ts` (8 scenarios: blast-radius drawer, Link Edit SVG rendering, downstream chip flow, manual link CRUD + duplicate rejection, animated outage path on 2D/Map, persistent custom service tags, light theme room outage highlights, live background outage sync)

```bash
# Run headless E2E tests
npm run test:e2e

# Run with Playwright interactive UI
npm run test:e2e:ui
```

---

## Key Directory Layout

```text
src/
├── components/
│   ├── detail/          # AddDeviceModal, AlertList, DeviceInfoModal, MetricCard, ServiceTagsEditor, TrafficChart
│   ├── discovery/       # NetworkScanModal (ARP/SNMP scan & inline editing)
│   ├── floor/           # FloorCanvas, FloorMapOverlay, FloorSidebar, DevicePin, TopologyLinksLayer
│   ├── layout/          # Navbar, NavbarSearch (Ctrl+K Command Palette), HelpGuideModal
│   ├── simulation/      # ImpactDrawer, BusinessImpactSummary
│   └── ui/              # Modal, ConfirmDialog, Toast
├── context/             # NetworkProvider, FaultSimProvider, SettingsProvider, SimulationProvider
├── hooks/               # useDeviceDetail
├── i18n/                # th.ts / en.ts (543 lines / 510 entries each) & format.ts
├── pages/               # FloorPlanPage, DeviceListPage, DeviceDetailPage, ReportsPage
├── services/            # api.ts (X-API-Key, HTTP error propagation, layout/impact APIs, offline fallback), detailFactory.ts, mapGeo.ts, roomStore.ts, topologyEngine.ts (offline fallback), traffic.ts
└── types/               # TypeScript models and interfaces
```
