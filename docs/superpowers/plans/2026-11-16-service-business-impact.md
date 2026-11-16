# Service & Business Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map device failures (`root_down`, `unreachable`, `degraded`) to human-readable affected building rooms/zones and impacted services (`Internet Gateway`, `Wi-Fi`, `LAN / PoE`, `DHCP`, `DNS`, custom tags), persist per-device tags in PostgreSQL (`devices.services JSONB`), highlight affected rooms on 2D & Map views, and display summaries in `ImpactDrawer`, `DeviceDetailPage`, and `ReportsPage`.

**Architecture:** Full-stack enhancement storing `services JSONB NOT NULL DEFAULT '[]'::jsonb` on `devices` (exposed via `PATCH /api/v1/devices/{id}`), backed by symmetric pure computation in `backend/app/topology.py` and `netmonitor/src/services/topologyEngine.ts` to populate `affected_zones` and `affected_services` in `BlastRadiusReport`, consumed by `FloorCanvas` (`RoomsLayer`), `FloorMapOverlay`, `ImpactDrawer`, `DeviceDetailPage` (`ServiceTagsEditor`), and `ReportsPage`.

**Tech Stack:** FastAPI, asyncpg / PostgreSQL 16+, Pydantic v2, pytest, React 19, TypeScript, Vite, CSS Modules, Playwright E2E.

---

### Task 1: Backend Schema Migration, Pydantic Validation, and Device Service Persistence

**Files:**
- Modify: `init/001_schema.sql`
- Modify: `backend/app/database.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/repository.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_topology_impact.py`

- [ ] **Step 1: Write failing API tests for service normalization, validation, and PATCH persistence**

Add to `backend/tests/test_topology_impact.py`:
```python
def test_device_update_services_normalization_and_validation():
    from pydantic import ValidationError
    from app.models import DeviceUpdate

    valid = DeviceUpdate(services=["  Wi-Fi  ", "wi-fi", "", "DHCP", "DNS"])
    assert valid.services == ["Wi-Fi", "DHCP", "DNS"]

    with pytest.raises(ValidationError):
        DeviceUpdate(services=["x" * 41])

    with pytest.raises(ValidationError):
        DeviceUpdate(services=[f"svc-{i}" for i in range(13)])
```

- [ ] **Step 2: Run pytest to verify it fails**

Run: `cd C:\work\snmp_font_end\backend; .\venv\Scripts\python.exe -m pytest ..\..\..` — actually in worktree `backend`: `pytest tests/test_topology_impact.py::test_device_update_services_normalization_and_validation -v`
Expected: FAIL (`DeviceUpdate` has no `services` attribute / validation).

- [ ] **Step 3: Add `services` DB column, Pydantic models (`ZoneImpactOut`, `ServiceImpactOut`, validated `services`), repository SQL & `main.py` handlers**

1. `init/001_schema.sql` and `backend/app/database.py`: add `services JSONB NOT NULL DEFAULT '[]'::jsonb` in `CREATE TABLE devices` and `ALTER TABLE devices ADD COLUMN IF NOT EXISTS services JSONB NOT NULL DEFAULT '[]'::jsonb;` in `database.py`.
2. `backend/app/models.py`:
   - Add `normalize_services_list(values)` validator: strip, skip empty, reject length > 40 (`ValueError`), dedupe case-insensitively preserving order, reject total > 12 (`ValueError`).
   - Add `services: list[str] = Field(default_factory=list)` to `DeviceBase` & `DeviceOut`; `services: Optional[list[str]] = None` to `DeviceUpdate`.
   - Add `ZoneImpactOut`, `ServiceImpactOut`, and fields `affected_zones: list[ZoneImpactOut] = Field(default_factory=list)`, `affected_services: list[ServiceImpactOut] = Field(default_factory=list)` to `SimulationImpactResponse`.
3. `backend/app/repository.py`:
   - Select `d.services` in `fetch_devices_with_telemetry` and `fetch_device_detail_by_id`.
   - Update `insert_device` signature with optional `services: Optional[list[str]] = None` inserting `$19::jsonb` and returning `services`.
4. `backend/app/main.py`:
   - Add `_parse_services(val: Any) -> list[str]` helper parsing JSON/list safely.
   - Populate `services` in all `DeviceOut` responses + handle `services` serialization (`json.dumps`) in `PATCH /api/v1/devices/{device_id}` (`$idx::jsonb`) and `update_device` `SELECT`.
   - Ensure `_dev_with_status` keeps `location` and parsed `services` for `compute_blast_radius`.

- [ ] **Step 4: Run pytest to verify pass**

Run: `pytest tests/test_topology_impact.py -v`
Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add init/001_schema.sql backend/app/database.py backend/app/models.py backend/app/repository.py backend/app/main.py backend/tests/test_topology_impact.py
git commit -m "feat(backend): persist normalized services JSONB tags on devices"
```

---

### Task 2: Zone & Service Impact Calculation Engine (Backend & Frontend Parity)

**Files:**
- Modify: `backend/app/topology.py`
- Modify: `backend/tests/test_topology_impact.py`
- Modify: `netmonitor/src/types/index.ts`
- Modify: `netmonitor/src/services/topologyEngine.ts`

- [ ] **Step 1: Write failing unit tests in `backend/tests/test_topology_impact.py`**

Add tests:
- `test_zone_and_service_impact_inference_and_full_vs_partial_room`:
  - Core switch down causes full room outage (`impact_state == "outage"`) when all devices in `ZONE-B` are unreachable, and `"degraded"` when `ZONE-MAIN` still has a healthy router while another device failed.
  - Verifies explicit `services: ["DHCP", "ERP"]` overrides auto-inferred defaults, while untagged `router` -> `["Internet Gateway"]`, `ap` -> `["Wi-Fi"]`, `switch` -> `["LAN / PoE"]` (or `["Core Switching"]`), `server` -> `["Database"]` when `"db"` in name.

- [ ] **Step 2: Run pytest to verify failure**

Expected: FAIL (`KeyError: 'affected_zones'`).

- [ ] **Step 3: Implement `resolve_device_services`, `_resolve_device_zone`, `affected_zones`, and `affected_services` in `backend/app/topology.py` and matching TypeScript functions in `netmonitor/src/services/topologyEngine.ts`**

1. In `backend/app/topology.py`:
   - Implement `resolve_device_services(device)` (returns explicit tags if non-empty, else deterministic defaults by `dtype`/`name`).
   - Implement `_resolve_device_zone(device)` parsing `device.get("target_room")` or `device.get("location")` suffix after `'–'`/`'-'` (fallback `f"Floor {floor}"`).
   - Compute `affected_zones` & `affected_services` inside `compute_blast_radius(...)` and include them in returned dict.
2. In `netmonitor/src/types/index.ts`:
   - Add `services?: string[]` to `Device` and `RawDevice`.
   - Add `ZoneImpactDetail`, `ServiceImpactDetail`, and `affected_zones`, `affected_services` on `BlastRadiusReport`.
3. In `netmonitor/src/services/topologyEngine.ts`:
   - Implement `resolveDeviceServices(device)`, `resolveDeviceZone(device, roomsByFloor)` (checking bounding boxes of `getStoredRooms(device.floor)` first, then `target_room`, then `Floor {n}`), and populate `affected_zones` + `affected_services` inside `computeBlastRadius(...)`.

- [ ] **Step 4: Run pytest to verify pass**

Run: `pytest tests/test_topology_impact.py -v`
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add backend/app/topology.py backend/tests/test_topology_impact.py netmonitor/src/types/index.ts netmonitor/src/services/topologyEngine.ts
git commit -m "feat(impact): compute affected zones and services across backend and frontend engines"
```

---

### Task 3: API Normalization & Reusable `ServiceTagsEditor` Component (`DeviceDetailPage` + `DeviceInfoModal`)

**Files:**
- Modify: `netmonitor/src/services/api.ts`
- Create: `netmonitor/src/components/detail/ServiceTagsEditor.tsx`
- Create: `netmonitor/src/components/detail/ServiceTagsEditor.module.css`
- Modify: `netmonitor/src/pages/DeviceDetailPage.tsx`
- Modify: `netmonitor/src/pages/DeviceDetailPage.module.css`
- Modify: `netmonitor/src/components/detail/DeviceInfoModal.tsx`
- Modify: `netmonitor/src/i18n/th.ts`
- Modify: `netmonitor/src/i18n/en.ts`

- [ ] **Step 1: Add `services` normalization in `api.ts` + i18n keys in `th.ts`/`en.ts`**

- Ensure `api.ts` normalizes `services: Array.isArray(d.services) ? d.services : []` in mock/fallback transforms.
- Add bilingual `services.*` and `sim.affectedZonesLabel` / `sim.affectedServicesLabel` / `sim.zoneFullOutage` / `sim.zonePartial` keys in `th.ts` and `en.ts`.

- [ ] **Step 2: Create `ServiceTagsEditor.tsx` + `ServiceTagsEditor.module.css`**

- Shows effective tags (with `"อัตโนมัติ" / "Auto"` indicator when `device.services` is empty).
- Editable mode (`onSave`): preset chips (`Internet Gateway`, `Wi-Fi`, `LAN / PoE`, `DHCP`, `DNS`, `Database`, `Internal ERP`, `CCTV / NVR`) + custom text input (`maxLength={40}`, max `12` tags, case-insensitive dedupe) + remove `×` on custom tags + reset-to-auto button when customized.
- Read-only mode (`editable={false}`): compact tag badges for `DeviceInfoModal`.

- [ ] **Step 3: Wire `ServiceTagsEditor` into `DeviceDetailPage.tsx` (editable via `useNetwork().updateDevice`) and `DeviceInfoModal.tsx` (read-only)**

- Add `<ServiceTagsEditor>` below `.infoGrid` inside `DeviceDetailPage.tsx` calling `updateDevice(device.id, { services })` with success/error toast feedback.
- Show read-only service chips inside `DeviceInfoModal.tsx` `.section`.

- [ ] **Step 4: Verify TypeScript build & lint**

Run: `cd C:\work\snmp_font_end\netmonitor; npm run build; npm run lint` (after merging/testing).

- [ ] **Step 5: Commit Task 3**

```bash
git add netmonitor/src/services/api.ts netmonitor/src/i18n/th.ts netmonitor/src/i18n/en.ts netmonitor/src/components/detail/ServiceTagsEditor.tsx netmonitor/src/components/detail/ServiceTagsEditor.module.css netmonitor/src/pages/DeviceDetailPage.tsx netmonitor/src/pages/DeviceDetailPage.module.css netmonitor/src/components/detail/DeviceInfoModal.tsx
git commit -m "feat(ui): add persistent ServiceTagsEditor on DeviceDetailPage and DeviceInfoModal"
```

---

### Task 4: Room Highlights (`FloorCanvas`, `FloorMapOverlay`) + Impact Summary (`ImpactDrawer`, `ReportsPage`) + E2E Test

**Files:**
- Modify: `netmonitor/src/components/floor/FloorCanvas.tsx`
- Modify: `netmonitor/src/components/floor/FloorCanvas.module.css`
- Modify: `netmonitor/src/components/floor/FloorMapOverlay.tsx`
- Modify: `netmonitor/src/components/simulation/ImpactDrawer.tsx`
- Modify: `netmonitor/src/components/simulation/ImpactDrawer.module.css`
- Modify: `netmonitor/src/pages/ReportsPage.tsx`
- Modify: `netmonitor/src/pages/ReportsPage.module.css`
- Modify: `netmonitor/e2e/fault-simulation.spec.ts`

- [ ] **Step 1: Highlight impacted rooms in `FloorCanvas.tsx` & `FloorMapOverlay.tsx`**

- Build `zoneImpactMap` from `faultSim.impactReport.affected_zones` when `isSimMode && (downDeviceIds.size > 0 || downLinkIds.size > 0)`.
- Pass `zoneImpactMap` into `RoomsLayer` in `FloorCanvas.tsx`: apply `styles.roomOutage` / `styles.roomDegraded` and `data-zone-state="outage" | "degraded"`.
- In `FloorCanvas.module.css`: add subtle `.roomOutage` and `.roomDegraded` classes (`!important` light/dark compatible border + translucent tint so room labels remain readable).
- In `FloorMapOverlay.tsx`: override `color`/`fillColor`/`fillOpacity` cleanly for polygons matching an active affected zone on `currentFloor`.

- [ ] **Step 2: Display `affected_zones` & `affected_services` summary strip in `ImpactDrawer.tsx` and `ReportsPage.tsx`**

- In `ImpactDrawer.tsx`: right below `.summaryStrip`, render compact `.businessImpactBox` (`data-testid="sim-business-impact"`) with affected zone pills + impacted service pills.
- In `ReportsPage.tsx`: inside `reports-outage-section` left card right below `.outageMiniKpis`, render compact `.businessSummaryRow` (`data-testid="reports-business-impact"`) listing affected zones and disrupted services.

- [ ] **Step 3: Add `TC-SIM-06` in `netmonitor/e2e/fault-simulation.spec.ts`**

- Open a device detail page (`Switch-Core` or `SRV-...`), add custom service tag `"ERP"`, reload page to prove Postgres persistence, navigate to Floor Plan `2D`, simulate outage, verify room highlight (`[data-zone-state]`), `sim-business-impact` containing `"ERP"`, and `reports-business-impact` containing `"ERP"`, then clean up the `"ERP"` tag in `finally`.

- [ ] **Step 4: Run full verification after merge into `C:\work\snmp_font_end`**

1. `impeccable detect --json` -> `[]`
2. `pytest tests -v` in `C:\work\snmp_font_end\backend` -> all passing
3. `npm run build` + `npm run lint` -> 0 errors
4. `npx playwright test --reporter=list` -> all passing (16 tests)

- [ ] **Step 5: Commit & Final Sync Verification**

Commit worktree `system`, fast-forward merge `system` into `main` at `C:\work\snmp_font_end`, and verify clean status across both repos.
