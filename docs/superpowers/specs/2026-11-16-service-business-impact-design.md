# Service & Business Impact Design Specification (NetMonitor)

**Date:** 2026-11-16  
**Approach:** Approach A — PostgreSQL `services` JSONB column on `devices` + Auto-Default Service Inference + Zone Aggregation + Room Highlighting  
**Target Worktree/Repo:** `system` -> `main` (`C:\work\snmp_font_end`)

---

## 1. Goal & Scope

Extend NetMonitor's Device-to-Device Failure Simulation and Topology Engine so outages automatically translate from hardware failures (`root_down`, `unreachable`, `degraded`) into **human-readable Business/Operational Impacts**:
- **Affected Zones / Rooms** (`affected_zones`): which building rooms or floors lose connectivity completely (`outage`) vs partially/on backup paths (`degraded`).
- **Affected Services** (`affected_services`): which network and application services (e.g., `Internet Gateway`, `Wi-Fi`, `LAN / PoE`, `DHCP`, `DNS`, `Database`, custom tags) go offline or degrade.
- **Visual Room Highlights:** Highlight affected room polygons subtly on the 2D Blueprint (`FloorCanvas`) and Satellite Map (`FloorMapOverlay`) during active simulations.
- **Persistent Service Tagging:** Store explicit per-device tags in PostgreSQL (`devices.services JSONB`) with zero-setup auto-inferred defaults when untagged.

Out of scope for this iteration:
- Multi-hop application-to-application service dependency trees (`App -> DB`) independent of hardware links.
- Bandwidth oversubscription calculation on failover links.
- LLDP/CDP SNMP neighbor MIB parsing.

---

## 2. Database & Backend Architecture

### 2.1 Database Schema (`backend/app/database.py`, `init/001_schema.sql`)
- Add `services JSONB NOT NULL DEFAULT '[]'::jsonb` to `devices` CREATE TABLE and idempotent startup migration (`ALTER TABLE devices ADD COLUMN IF NOT EXISTS services JSONB NOT NULL DEFAULT '[]'::jsonb;`).

### 2.2 Pydantic Models & Validation (`backend/app/models.py`)
- Add shared normalizer validator on `services` lists:
  - Trim whitespace, drop blanks, deduplicate case-insensitively while preserving order.
  - Enforce at most `12` tags per device and at most `40` characters per tag (reject >40 chars or >12 tags cleanly via Pydantic HTTP `422` validation).
- Update models:
  - `DeviceBase`: `services: list[str] = Field(default_factory=list)`
  - `DeviceOut`: `services: list[str] = Field(default_factory=list)`
  - `DeviceUpdate`: `services: Optional[list[str]] = None`
  - New `ZoneImpactOut`:
    - `zone: str`
    - `floor: int`
    - `impact_state: Literal['outage', 'degraded']`
    - `down_count: int`
    - `total_count: int`
    - `affected_devices: list[str]`
    - `impacted_services: list[str]`
  - New `ServiceImpactOut`:
    - `service: str`
    - `impact_state: Literal['outage', 'degraded']`
    - `source_devices: list[str]`
    - `zones: list[str]`
  - Update `SimulationImpactResponse`:
    - Add `affected_zones: list[ZoneImpactOut] = Field(default_factory=list)`
    - Add `affected_services: list[ServiceImpactOut] = Field(default_factory=list)`

### 2.3 Repository & API (`backend/app/repository.py`, `backend/app/main.py`)
- `fetch_devices_with_telemetry` & `insert_device`: read and return `d.services`; parse JSON string if driver returns `str` (`json.loads`), else `list(val or [])`.
- `POST /api/v1/devices` and `PATCH /api/v1/devices/{device_id}`: serialize `services` to JSON (`json.dumps(...)` for `$N::jsonb`) and return normalized `services` in `DeviceOut`.
- `POST /api/v1/discovery/import`: pass `services=[]` cleanly on new imports.
- `_dev_with_status` & `/api/v1/simulate/impact`: pass `location` and `services` from DB into `compute_blast_radius`.

---

## 3. Domain Logic Parity (`backend/app/topology.py` & `netmonitor/src/services/topologyEngine.ts`)

Both engines compute identical results using matching helpers:

### 3.1 `resolveDeviceServices` / `resolve_device_services(device)`
- If `device.services` is non-empty, return normalized tags (`is_auto = False`).
- Otherwise (`[]`), infer deterministic defaults from `dtype` and `name`:
  - `router` -> `['Internet Gateway']`
  - `switch` -> `['Core Switching']` if `core` in lowercase name or `id == '1'`, else `['LAN / PoE']`
  - `ap` -> `['Wi-Fi']`
  - `server` -> inspect lowercase `name`:
    - `dhcp` -> `DHCP`
    - `dns` -> `DNS`
    - `db` / `sql` / `postgres` / `mysql` -> `Database`
    - `erp` / `hr` / `acc` -> `Internal ERP`
    - `web` / `http` / `app` -> `Web Service`
    - `cctv` / `nvr` / `cam` -> `CCTV / NVR`
    - `air` / `sensor` / `iot` -> `IoT Monitoring`
    - fallback if none matched -> `['Internal Server']`

### 3.2 `resolveDeviceZone` / `_resolve_device_zone(device)`
- Frontend: match `(device.x, device.y)` inside `getStoredRooms(device.floor)` room bounding box first (`room.label`); fallback to trimmed `device.target_room`, else `Floor {device.floor}`.
- Backend: extract zone suffix from `device.location` (split on `'–'` / `' - '` stripping `"Floor N"` prefix) or `device.target_room`, fallback `Floor {floor}`.

### 3.3 Zone & Service Aggregation in `computeBlastRadius`
- Group all devices by `(zone, floor)`:
  - Count `total_count` in that zone, `failed_count` (`root_down` + `unreachable`), `degraded_count` (`degraded`).
  - Only emit zone entries where `failed_count + degraded_count > 0`.
  - Zone `impact_state`: `'outage'` if `failed_count === total_count` (all devices in the room failed), otherwise `'degraded'`.
  - Collect `affected_devices` and union of resolved `impacted_services` across impacted devices in that zone.
  - Sort zones by severity (`outage` first), then `-down_count`, `floor`, `zone`.
- Group all impacted (`root_down`, `unreachable`, `degraded`) devices' resolved services by service name:
  - Service `impact_state`: `'outage'` if any source device running it is `root_down` or `unreachable`; otherwise `'degraded'`.
  - Collect unique `source_devices` and `zones`.
  - Sort services by severity (`outage` first), then `-source_devices.length`, `service`.

---

## 4. Frontend Types, State & UI Components

### 4.1 Types & API (`netmonitor/src/types/index.ts`, `netmonitor/src/services/api.ts`)
- Add `services?: string[]` to `Device` and `RawDevice`.
- Add `ZoneImpactDetail` and `ServiceImpactDetail` and fields `affected_zones`, `affected_services` to `BlastRadiusReport`.
- Normalize `services: Array.isArray(d.services) ? d.services : []` in `api.ts` `fetchDevices` fallback and mock persistence.

### 4.2 Service Tag Editor (`netmonitor/src/components/detail/ServiceTagsEditor.tsx`, `ServiceTagsEditor.module.css`)
- Reusable compact component placed inside:
  - `DeviceDetailPage.tsx` (editable right under `.infoGrid`): displays active tags (with `"Auto"` badge when empty/inferred), preset toggle chips (`Internet Gateway`, `Wi-Fi`, `LAN / PoE`, `DHCP`, `DNS`, `Database`, `Internal ERP`, `CCTV / NVR`), and custom input + `"Add"` button; persists immediately via `useNetwork().updateDevice(device.id, { services })` + toast feedback.
  - `DeviceInfoModal.tsx` (read-only chip row or compact preview).
- Guard rails: disable/prevent empty or duplicate case-insensitive tag, enforce max 12 tags / 40 chars, show error toast if save fails.

### 4.3 Floor Room Highlight (`FloorCanvas.tsx`, `FloorCanvas.module.css`, `FloorMapOverlay.tsx`)
- Compute `zoneImpactMap` by `(floor, zoneLabel)` when `isSimMode && (downDeviceIds.size > 0 || downLinkIds.size > 0)`.
- `FloorCanvas.tsx` (`RoomsLayer`): pass `zoneImpactMap` and apply `.roomOutage` (soft crimson border `#ef4444` & fill `rgba(239, 68, 68, 0.16)`) or `.roomDegraded` (amber border `#f59e0b` & fill `rgba(245, 158, 11, 0.14)`).
- `FloorMapOverlay.tsx`: style affected Leaflet room polygons cleanly with matching red/amber stroke & translucent fill during simulation (`useEffect` dependency includes `faultSim.impactReport` & `isSimMode`).

### 4.4 Impact Summary Surfaces (`ImpactDrawer.tsx`, `ReportsPage.tsx`)
- **`ImpactDrawer.tsx`**: When `hasFaults && (affected_zones.length > 0 || affected_services.length > 0)`, render a concise compact strip below `.summaryStrip` showing:
  - Affected zones pills (`outage` crimson vs `degraded` amber, e.g. `SERVER ROOM · 8/8`)
  - Affected services pills (`Internet Gateway`, `Wi-Fi`, `Database`, ...)
- **`ReportsPage.tsx`**: Inside `reports-outage-section` left card (below `outageMiniKpis`), show compact zone & service summary chips computed from `effectiveReport` (covers both live offline devices and active simulations).

### 4.5 Bilingual i18n (`th.ts` & `en.ts`)
- Add keys under `sim.*` / `services.*` cleanly in both Thai and English.

---

## 5. Verification Strategy

1. **Backend (`pytest`):**
   - Test `resolve_device_services` defaults & overrides.
   - Test `affected_zones` (`outage` when full room down, `degraded` when partial) & `affected_services` in `compute_blast_radius`.
   - Test `PATCH /api/v1/devices/{id}` saving/returning normalized `services` and rejecting invalid lengths cleanly.
2. **Design & Build Verification:**
   - `impeccable detect --json` -> `[]` (0 findings).
   - `npm run build` (`tsc -b && vite build`) + `npm run lint` (`0` errors).
3. **End-to-End (`Playwright`):**
   - New `TC-SIM-06`: Navigate to a Switch/Server detail page -> add a custom service tag (`ERP`) -> verify persistence after reload (`PATCH` to PostgreSQL) -> switch to Floor Plan `2D` -> open Outage Simulator -> fail `Switch-Core` -> assert room highlight (`.roomOutage` / `.roomDegraded`), `ImpactDrawer` zone/service pills (`ERP` visible), and `ReportsPage` service/zone summary -> cleanup test tag back to `[]` in `finally`.
