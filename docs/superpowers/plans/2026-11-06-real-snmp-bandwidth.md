# Real SNMP Bandwidth Monitoring & Traffic Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement real SNMP port bandwidth polling, interface rate calculations, database storage, and frontend TrafficChart integration with interface selection and strict ICMP fallback.

**Architecture:** A high-performance asynchronous SNMP collector in FastAPI (`backend/app/collector.py`) walks IF-MIB / ifXTable counters (64-bit HC counters with 32-bit fallback), calculates delta throughput in Mbps, and persists metrics into PostgreSQL `interfaces` and `interface_samples` tables. The React frontend fetches real port metrics every 5 seconds, provides an interface dropdown (Total Aggregate or per-port), and displays a `● LIVE (SNMP)` or `○ No SNMP Data (ICMP Only)` badge.

**Tech Stack:** Python 3.14, FastAPI, asyncpg, Net-SNMP CLI (`snmpwalk`/`snmpget`), PostgreSQL (docker-db-1), React 19, TypeScript, Vite.

---

## File Structure

```
backend/
├── app/
│   ├── collector.py           # NEW: SNMP IF-MIB collector & Mbps delta calculation engine
│   ├── models.py              # UPDATE: Add InterfaceTrafficOut, TrafficSeriesOut, PollTrafficResult
│   └── main.py                # UPDATE: Add /interfaces, /poll-traffic, and /traffic endpoints
├── tests/
│   ├── test_snmp_collector.py # NEW: Unit tests for rate calculation, counter wraps, DB queries
│   └── test_real_port_traffic.py # NEW: Live hardware test against Aruba JL261A (192.168.22.254)
netmonitor/
├── src/
│   ├── types/index.ts         # UPDATE: InterfaceInfo, PollTrafficResponse, TrafficSeries with hasSnmp
│   ├── services/api.ts        # UPDATE: fetchDeviceInterfaces, pollDeviceTraffic, fetchDeviceTraffic
│   ├── hooks/useDeviceDetail.ts # UPDATE: 5s polling loop, interface state, real backend series
│   ├── components/detail/TrafficChart.tsx # UPDATE: Interface dropdown selector & strict mode badge
│   └── components/detail/TrafficChart.module.css # UPDATE: Dropdown styling & badge styles
```

---

### Task 1: SNMP Collector & Mbps Delta Calculation Engine

**Files:**
- Create: `backend/app/collector.py`
- Test: `backend/tests/test_snmp_collector.py`

- [ ] **Step 1: Write unit tests for bandwidth delta calculation and counter rollover**

```python
# backend/tests/test_snmp_collector.py
import pytest
from backend.app.collector import calculate_bandwidth_mbps, parse_snmpwalk_output

def test_calculate_bandwidth_normal():
    # 100,000,000 bytes transferred over 5 seconds = 800,000,000 bits / 5s = 160 Mbps
    mbps = calculate_bandwidth_mbps(
        curr_octets=200_000_000,
        prev_octets=100_000_000,
        dt_seconds=5.0,
        is_64bit=True
    )
    assert mbps == pytest.approx(160.0, rel=1e-2)

def test_calculate_bandwidth_32bit_rollover():
    # Previous counter was near 2^32 (4,294,967,295), current rolled over to 10,000,000
    prev = 4_290_000_000
    curr = 10_000_000 # Total delta = (4,294,967,296 - 4,290,000,000) + 10,000,000 = 14,967,296 bytes
    mbps = calculate_bandwidth_mbps(
        curr_octets=curr,
        prev_octets=prev,
        dt_seconds=5.0,
        is_64bit=False
    )
    expected_mbps = (14_967_296 * 8) / (5.0 * 1_000_000)
    assert mbps == pytest.approx(expected_mbps, rel=1e-2)

def test_calculate_bandwidth_zero_or_negative_dt():
    mbps = calculate_bandwidth_mbps(curr_octets=100, prev_octets=50, dt_seconds=0.0)
    assert mbps == 0.0

def test_parse_snmpwalk_lines():
    sample_text = """
IF-MIB::ifDescr.1 = STRING: 1
IF-MIB::ifDescr.2 = STRING: 2
IF-MIB::ifDescr.3 = STRING: VLAN22
"""
    result = parse_snmpwalk_output(sample_text)
    assert result == {1: "1", 2: "2", 3: "VLAN22"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_snmp_collector.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.app.collector'`

- [ ] **Step 3: Implement `backend/app/collector.py` core calculation & parsing logic**

```python
# backend/app/collector.py
import asyncio
import re
import logging
from typing import Optional, Dict, Any, Tuple, List
from datetime import datetime, timezone

logger = logging.getLogger("netmonitor.collector")

def calculate_bandwidth_mbps(
    curr_octets: int,
    prev_octets: int,
    dt_seconds: float,
    is_64bit: bool = True,
    max_speed_bps: Optional[int] = None,
) -> float:
    if dt_seconds <= 0 or curr_octets is None or prev_octets is None:
        return 0.0

    delta = curr_octets - prev_octets
    if delta < 0:
        # Rollover handling
        modulus = 2**64 if is_64bit else 2**32
        delta += modulus

    # bits per second
    bps = (delta * 8) / dt_seconds
    mbps = round(bps / 1_000_000, 2)

    # Sanity guard if max port speed is known
    if max_speed_bps and max_speed_bps > 0:
        max_mbps = (max_speed_bps / 1_000_000) * 1.5
        if mbps > max_mbps:
            logger.warning(f"Spike detected: {mbps} Mbps exceeds max {max_mbps} Mbps")
            return max_mbps

    return max(0.0, mbps)

def parse_snmpwalk_output(text: str) -> Dict[int, str]:
    """
    Parses standard Net-SNMP output like:
    IF-MIB::ifDescr.1 = STRING: 1
    RFC1213-MIB::ifOperStatus.1 = INTEGER: up(1)
    """
    results = {}
    pattern = re.compile(r"\.(\d+)\s*=\s*(?:[A-Za-z0-9\-]+:\s*)?\"?([^\"\r\n]+)\"?")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = pattern.search(line)
        if m:
            idx = int(m.group(1))
            val = m.group(2).strip()
            # Clean enum descriptions like "up(1)" -> "up"
            if "(" in val and val.endswith(")"):
                val = val.split("(")[0].strip()
            results[idx] = val
    return results
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_snmp_collector.py -v`
Expected: PASS (4 passed)

---

### Task 2: SNMP Interface Discovery, Sampling & Database Persistence

**Files:**
- Modify: `backend/app/collector.py`
- Test: `backend/tests/test_snmp_collector.py`

- [ ] **Step 1: Write integration tests for interface discovery & DB storage**

```python
# Append to backend/tests/test_snmp_collector.py
@pytest.mark.asyncio
async def test_db_interface_sync(test_pool):
    # Verify interfaces sync into PostgreSQL
    from backend.app.collector import sync_device_interfaces, save_interface_sample
    dev_id = 1
    mock_ifaces = [
        {"if_index": 1, "name": "Port 1", "description": "GigabitEthernet1", "speed_bps": 1_000_000_000, "oper_status": "up"},
        {"if_index": 2, "name": "Port 2", "description": "GigabitEthernet2", "speed_bps": 1_000_000_000, "oper_status": "down"}
    ]
    await sync_device_interfaces(test_pool, dev_id, mock_ifaces)

    rows = await test_pool.fetch("SELECT * FROM interfaces WHERE device_id = $1 ORDER BY if_index", dev_id)
    assert len(rows) == 2
    assert rows[0]["name"] == "Port 1"
    assert rows[0]["oper_status"] == "up"
```

- [ ] **Step 2: Implement SNMP query execution and database operations in `collector.py`**

```python
# Add to backend/app/collector.py
async def execute_snmpwalk(ip: str, oid: str, community: str = "public", port: int = 161, version: str = "2c", timeout_s: int = 2) -> Dict[int, str]:
    cmd = ["snmpwalk", f"-v{version}", f"-c{community}", f"-t{timeout_s}", f"{ip}:{port}", oid]
    try:
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s + 1.5)
        if proc.returncode == 0:
            return parse_snmpwalk_output(stdout.decode("utf-8", errors="replace"))
    except Exception as e:
        logger.debug(f"snmpwalk failed for {ip} {oid}: {e}")
    return {}

async def collect_device_interfaces(ip: str, community: str = "public", port: int = 161, version: str = "2c") -> List[Dict[str, Any]]:
    # Query ifDescr, ifOperStatus, ifSpeed, ifHCInOctets, ifHCOutOctets
    descr_map = await execute_snmpwalk(ip, ".1.3.6.1.2.1.2.2.1.2", community, port, version)
    if not descr_map:
        return []
    oper_map = await execute_snmpwalk(ip, ".1.3.6.1.2.1.2.2.1.8", community, port, version)
    speed_map = await execute_snmpwalk(ip, ".1.3.6.1.2.1.31.1.1.1.15", community, port, version) # HighSpeed in Mbps
    hc_in = await execute_snmpwalk(ip, ".1.3.6.1.2.1.31.1.1.1.6", community, port, version)
    hc_out = await execute_snmpwalk(ip, ".1.3.6.1.2.1.31.1.1.1.10", community, port, version)

    interfaces = []
    for idx, name in descr_map.items():
        oper = oper_map.get(idx, "unknown").lower()
        high_speed = int(speed_map.get(idx, 0)) if speed_map.get(idx, "").isdigit() else 0
        speed_bps = high_speed * 1_000_000 if high_speed > 0 else 1000_000_000
        in_oct = int(hc_in.get(idx, 0)) if hc_in.get(idx, "").isdigit() else None
        out_oct = int(hc_out.get(idx, 0)) if hc_out.get(idx, "").isdigit() else None

        interfaces.append({
            "if_index": idx,
            "name": name,
            "description": f"Port {name}",
            "speed_bps": speed_bps,
            "oper_status": oper,
            "in_octets": in_oct,
            "out_octets": out_oct,
        })
    return interfaces

async def sync_device_interfaces(pool, device_id: int, interfaces: List[Dict[str, Any]]):
    for iface in interfaces:
        await pool.execute("""
            INSERT INTO interfaces (device_id, if_index, name, description, speed_bps, oper_status)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (device_id, if_index) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                speed_bps = EXCLUDED.speed_bps,
                oper_status = EXCLUDED.oper_status;
        """, device_id, iface["if_index"], iface["name"], iface["description"], iface["speed_bps"], iface["oper_status"])
```

- [ ] **Step 3: Run tests to verify interface sync**

Run: `pytest backend/tests/test_snmp_collector.py -v`
Expected: PASS

---

### Task 3: REST API Endpoints for Interfaces, Poll-Traffic & Historical Series

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Add Pydantic response models to `backend/app/models.py`**

```python
# In backend/app/models.py
class InterfaceTrafficOut(BaseModel):
    id: int
    if_index: int
    name: str
    description: Optional[str] = None
    speed_bps: Optional[int] = None
    oper_status: Optional[str] = None
    in_mbps: float = 0.0
    out_mbps: float = 0.0

class TrafficSeriesOut(BaseModel):
    has_snmp: bool
    interface_id: str
    inbound: list[float]
    outbound: list[float]
    labels: list[str]
    peak: float
    avg: float
    timestamp: str

class PollTrafficResult(BaseModel):
    success: bool
    has_snmp: bool
    interfaces_polled: int
    total_in_mbps: float
    total_out_mbps: float
    timestamp: str
```

- [ ] **Step 2: Add API routes to `backend/app/main.py`**

```python
# In backend/app/main.py:
@app.get("/api/v1/devices/{device_id}/interfaces", response_model=List[InterfaceTrafficOut])
async def get_device_interfaces_endpoint(device_id: int):
    ...

@app.post("/api/v1/devices/{device_id}/poll-traffic", response_model=PollTrafficResult)
async def poll_device_traffic_endpoint(device_id: int):
    ...

@app.get("/api/v1/devices/{device_id}/traffic", response_model=TrafficSeriesOut)
async def get_device_traffic_series_endpoint(device_id: int, interface_id: str = "all", range: str = "15m"):
    ...
```

- [ ] **Step 3: Write tests for API routes in `backend/tests/test_api.py`**

```python
# Append to backend/tests/test_api.py
def test_get_device_interfaces(client):
    res = client.get("/api/v1/devices/1/interfaces")
    assert res.status_code == 200
    assert isinstance(res.json(), list)

def test_get_device_traffic_series(client):
    res = client.get("/api/v1/devices/1/traffic?interface_id=all&range=15m")
    assert res.status_code == 200
    data = res.json()
    assert "has_snmp" in data
    assert "inbound" in data
    assert "outbound" in data
```

- [ ] **Step 4: Run API tests**

Run: `pytest backend/tests/test_api.py -v`
Expected: PASS

---

### Task 4: Live Switch Verification (Aruba JL261A at 192.168.22.254)

**Files:**
- Create: `backend/tests/test_real_port_traffic.py`

- [ ] **Step 1: Write live hardware integration test**

```python
# backend/tests/test_real_port_traffic.py
import pytest
import asyncio
from backend.app.collector import collect_device_interfaces, sync_device_interfaces, save_device_traffic_sample, poll_and_calculate_device_traffic
from backend.app.database import get_db_pool

@pytest.mark.asyncio
async def test_live_aruba_switch_interfaces():
    ip = "192.168.22.254"
    ifaces = await collect_device_interfaces(ip, community="public")
    assert len(ifaces) >= 24, f"Expected at least 24 ports, got {len(ifaces)}"
    assert any(i["oper_status"] == "up" for i in ifaces)

@pytest.mark.asyncio
async def test_live_aruba_traffic_delta():
    pool = await get_db_pool()
    # Poll twice with 2-second delay to measure real delta
    res1 = await poll_and_calculate_device_traffic(pool, device_id=1, ip="192.168.22.254", community="public")
    await asyncio.sleep(2)
    res2 = await poll_and_calculate_device_traffic(pool, device_id=1, ip="192.168.22.254", community="public")
    assert res2["success"] is True
    assert res2["has_snmp"] is True
```

- [ ] **Step 2: Run live hardware verification**

Run: `pytest backend/tests/test_real_port_traffic.py -v`
Expected: PASS (2 passed)

---

### Task 5: Frontend API Client & State Management

**Files:**
- Modify: `netmonitor/src/types/index.ts`
- Modify: `netmonitor/src/services/api.ts`
- Modify: `netmonitor/src/hooks/useDeviceDetail.ts`

- [ ] **Step 1: Update TypeScript types in `netmonitor/src/types/index.ts`**
  - Add `hasSnmp?: boolean` to `TrafficSeries`
  - Add `InterfaceItem` interface with `id, if_index, name, description, speed_bps, oper_status, in_mbps, out_mbps`

- [ ] **Step 2: Add client methods to `netmonitor/src/services/api.ts`**
  - `fetchDeviceInterfaces(deviceId: string)`
  - `pollDeviceTraffic(deviceId: string)`
  - `fetchDeviceTraffic(deviceId: string, interfaceId: string, range: TimeRange)`

- [ ] **Step 3: Update `netmonitor/src/hooks/useDeviceDetail.ts`**
  - Add `selectedInterface` state (`'all'` by default)
  - Add `interfaces` state list
  - Set up 5-second polling interval while component is mounted
  - Retrieve real `TrafficSeries` from backend API; if device has no SNMP (`has_snmp: false`), render flat 0 Mbps line with badge.

---

### Task 6: Frontend UI Components: Interface Selector & Badges

**Files:**
- Modify: `netmonitor/src/components/detail/TrafficChart.tsx`
- Modify: `netmonitor/src/components/detail/TrafficChart.module.css`

- [ ] **Step 1: Add Interface Selector dropdown & Status Badge in `TrafficChart.tsx`**
  - Render dropdown: `All Interfaces (Total)` + individual ports
  - Render Badge:
    - `● LIVE (SNMP)` (green glow) if `series.hasSnmp` is true
    - `○ No SNMP Data (ICMP Only)` (gray / amber) if `series.hasSnmp` is false
  - Show selected interface port speed and operational status (Up/Down)

- [ ] **Step 2: Add styles in `TrafficChart.module.css`**
  - Glassmorphic selector select/button styling
  - Badge styles for `liveSnmp` and `noSnmp`

- [ ] **Step 3: Run TypeScript & Vite build check**

Run: `cd netmonitor && npm run build`
Expected: Build succeeds with 0 errors.

---

### Task 7: Full System End-to-End Verification

- [ ] **Step 1: Run all backend tests**
  Run: `pytest backend/tests/ -v`
  Expected: 100% tests pass.

- [ ] **Step 2: Verify live device polling in UI**
  Open device `192.168.22.254` on `http://localhost:5173/device/1`.
  Verify:
  - Dropdown displays 28 ports (Port 1, 2, ... VLANs).
  - Graph plots real throughput in Mbps.
  - Badge displays `● LIVE (SNMP)`.
  - Open ICMP-only device: verifies `○ No SNMP Data (ICMP Only)` and 0 Mbps.
