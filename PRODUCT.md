# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Network Administrators & Operations Engineers (NOC / Campus IT)**
  - Situation: Active desktop monitoring consoles and troubleshooting sessions during campus network congestion, link flaps, or hardware outages across building floors.
  - Job: Rapidly scan topology status across building floors, detect offline/warning devices, inspect live interface throughput, evaluate device-to-device cascading outage impact before maintenance, and diagnose connection health.

## Product Purpose

NetMonitor is a real-time network topology, SNMP bandwidth monitoring, and device failure impact simulation web application designed for network engineers and IT administrators to visualize, inspect, and manage active network hardware (`switch`, `router`, `ap`, `server`) across campus floors. Success means operators can identify root-cause outages, trace hop-by-hop downstream dependencies, and read live interface health in seconds without visual clutter or synthetic noise.

## Positioning

Combines dual-mode spatial topology visualization (2D Floor Plan Canvas aligned with WGS84 Satellite Map overlays via bilinear affine projection), authentic 64-bit SNMP `ifHCInOctets`/`ifHCOutOctets` interface telemetry, and an interactive What-If Device-to-Device Failure Impact Simulator (Multi-Source BFS with hop-by-hop causal chain tracing and SPOF ranking) in a zero-config campus console.

## Operating Context

- **Architecture:** React 19 + TypeScript + Vite frontend (`netmonitor/`) paired with an asynchronous FastAPI + `asyncpg` backend (`backend/`) and PostgreSQL 17 database (`docker-compose.yml`), with automatic `localStorage` fallback when the backend is offline.
- **Core Workflows:**
  - Dual-view floorplan monitoring (`FloorPlanPage`: 2D Blueprint Canvas and Leaflet Satellite/Carto Map Overlay across Floor 1 and Floor 2).
  - Subnet auto-discovery (`NetworkScanModal`: ARP/ICMP/SNMP probe, OUI & RFC 1213 classification, smart room placement, and deduplicated import).
  - Deep device diagnostics (`DeviceDetailPage` & `DeviceInfoModal`: live SNMP traffic charts, interface port utilization, VLAN groupings, neighbors, and per-device blast radius preview).
  - Non-destructive What-If Outage Simulation (`ImpactDrawer` & `ReportsPage`: simulate device/link failures, inspect `root_down` / `unreachable` / `degraded` states and `A ➔ B ➔ C` dependency chains, rank SPOFs, and optionally commit simulated faults to PostgreSQL with `credential_ref = 'simulated'`).

## Capabilities and Constraints

- **Real Physical SNMP Telemetry:** Polls 64-bit HC counters, `sysUpTime`, `sysDescr`, CPU, memory, and temperature OIDs; never fabricates random CPU/memory numbers when a real device does not support an OID (displays `—` / `Not Supported`).
- **Topology Links (`topology_links`):** Supports automatic hierarchy inference (`Router ➔ Core Switch ➔ Distribution/Access Switch ➔ AP/Server` plus `interfaces.description` peer parsing) and manual link creation/deletion (`wan`, `uplink`, `trunk`, `access`, `redundancy`).
- **Bilingual Localization:** Complete Thai (`th`) and English (`en`) UI copy via `i18next`.
- **UI Scaling:** Supports `100%`, `125%`, and `150%` root scaling for NOC wall/desktop monitors.

## Brand Commitments

- **Product Name:** NetMonitor (`v1.3`).
- **Voice & Tone:** Precise, operational, and objective network engineering terminology (bilingual Thai and English).
- **Surface Mode Commitment:** `Operate` mode — prioritize scanability, high-contrast status semantics, and restraint over decorative chrome.

## Evidence on Hand

- Database schema and seed topology in `init/001_schema.sql` and `seed_mock_data.sql`.
- Backend SNMP poller, discovery classifier, and BFS blast-radius engine in `backend/app/collector.py`, `backend/app/discovery.py`, and `backend/app/topology.py`.
- Playwright E2E suites in `netmonitor/e2e/netmonitor.spec.ts` and `netmonitor/e2e/fault-simulation.spec.ts`, plus backend unit/API tests in `backend/tests/`.
- No customer testimonials, external press quotes, or third-party SLA certifications exist; future work must not fabricate them.

## Product Principles

1. **Telemetry Honesty Over Synthetic Filler:** Display genuine SNMP and ICMP measurements for real devices; clearly distinguish unavailable sensors (`—`) from zero values.
2. **Sandbox-First Safety:** All failure impact and blast-radius simulations run non-destructively in a client-side What-If Sandbox by default, mutating PostgreSQL state only upon explicit user confirmation.
3. **Sub-Second NOC Scanability:** Keep status hierarchy (`online`, `warning`/`degraded`, `offline`/`unreachable`) and hop-by-hop causal chains (`A ➔ B ➔ C`) legible at a glance without overlapping badges or duplicated counters.
4. **Zero-Config Campus Onboarding:** Automatically discover, classify, place, and link network devices across floors while allowing manual pin locking and link editing when needed.

## Accessibility & Inclusion

- **Contrast & Theme Parity:** Maintain WCAG AA contrast (minimum 4.5:1 for body text, 3:1 for large text and status indicators) across both Dark Theme (`#0b0f19` canvas) and Soft Slate Anti-Glare Light Theme (`#e8edf2` canvas).
- **Typography Floor:** Minimum `12px` font size across all badges, labels, and tables, with `font-variant-numeric: tabular-nums` on all live counters, bandwidth rates, and IP addresses.
