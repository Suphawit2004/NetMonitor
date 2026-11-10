# Network Discovery Scan Diagnostic & Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve why network scan found no devices in the browser UI, accelerate discovery from ~58s to <2s using ARP-first fast scanning, fix multi-adapter subnet auto-detection for real LAN (192.168.22.0/24), provide backend connectivity feedback, and ensure backend runs persistently.

**Architecture:** 
1. **Multi-Adapter Local Network Detection:** Enhance `discovery.py` to inspect Windows routing and ARP table interfaces so it accurately binds to the physical LAN interface (`192.168.22.60`) even when WSL/Docker interfaces exist or external internet (8.8.8.8) is inaccessible.
2. **Fast ARP-First Scan (<2s) with SNMP Enricher:** Implement a 2-tier scan mode:
   - **Quick Fast Scan (Default):** Probes active dynamic ARP neighbors + default gateway + `.1` & `.254` concurrently with 200ms timeout. Discovers active LAN devices (like Aruba 2930F `192.168.22.254`) in under 2 seconds.
   - **Full Range Scan (Deep):** Probes the entire `/24` subnet with optimized parallel batching (concurrency 64, ping timeout 200ms).
3. **Frontend Backend Status & Error Visibility:** In `netmonitor`, add backend connectivity check in the header/scan modal so users immediately see if FastAPI port 8000 is online. If unreachable, display an explicit banner/toast instead of silently failing to an empty/mock state.
4. **Daemonized Runner:** Provide a Windows batch script (`start_all.bat`) and start FastAPI backend + Vite dev server as persistent background services.

**Tech Stack:** Python 3.12/3.14 (FastAPI, asyncio, Net-SNMP CLI `snmpget`), React 19, TypeScript, Vite, Tailwind/CSS modules.

---

### File Structure & Changes

- **Modify:** `backend/app/discovery.py`
  - Enhance `detect_local_network_info()` to parse interfaces from `arp -a` and route tables to prioritize the physical LAN adapter with the most active dynamic entries.
  - Implement `scan_network_fast()` (probes ARP cache + core addresses in <2s) and optimize `scan_network_cidr()` (200ms ping timeout, concurrency 64).
  - Add `scan_mode` parameter (`quick` vs `full`).
- **Modify:** `backend/app/models.py`
  - Add `scan_mode: Optional[str] = "quick"` to `ScanRequest`.
  - Add `total_scanned: int` and `duration_ms: float` to discovery response info.
- **Modify:** `backend/app/main.py`
  - Support `scan_mode` in `/api/v1/discovery/scan`.
  - Add `/api/v1/health` endpoint for frontend backend-connectivity ping.
- **Modify:** `netmonitor/src/services/api.ts`
  - Add `checkBackendHealth(): Promise<boolean>`.
  - Pass `scan_mode` to `/api/v1/discovery/scan`.
  - Throw clear error toast when backend API is offline instead of silent failure.
- **Modify:** `netmonitor/src/components/discovery/NetworkScanModal.tsx`
  - Display scan mode selector (⚡ สแกนด่วนจากอุปกรณ์ที่กำลังเชื่อมต่อ / 🌐 สแกนละเอียดทั้งวง /24).
  - Show scan duration and progress indicator.
  - Show clear error warning if backend is offline.
- **Create:** `start_all.bat`
  - 1-click script to start both Backend (FastAPI :8000) and Frontend (Vite :5173).

---

### Task 1: Fix Network Subnet Auto-Detection in `discovery.py`

**Files:**
- Modify: `backend/app/discovery.py:30-73`
- Test: `backend/test_discovery.py`

- [ ] **Step 1: Write test to verify multi-adapter network detection**

```python
# backend/test_discovery.py
import pytest
from app.discovery import detect_local_network_info

def test_detect_local_network_info_finds_real_lan():
    info = detect_local_network_info()
    assert info["local_ip"] != "127.0.0.1"
    assert info["detected_subnet"].endswith("/24")
    assert len(info["arp_ips"]) > 0
    # Should detect 192.168.22.x on this host
    assert "192.168.22." in info["detected_subnet"]
```

- [ ] **Step 2: Run test to check current behavior**

Run: `backend\venv\Scripts\python.exe -m pytest backend/test_discovery.py -v`

- [ ] **Step 3: Update `detect_local_network_info()` with robust ARP interface parsing**

In `backend/app/discovery.py`, parse the ARP table per interface. If `8.8.8.8` probe fails or selects a virtual adapter (e.g., `172.21.x.x`), choose the interface with the highest number of dynamic neighbor entries (which is the real LAN `192.168.22.60`).

```python
def detect_local_network_info() -> Dict[str, Any]:
    import subprocess
    interfaces_arp: Dict[str, List[str]] = {}
    current_iface = None

    try:
        out = subprocess.check_output(["arp", "-a"], text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            iface_match = re.search(r"Interface:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", line)
            if iface_match:
                current_iface = iface_match.group(1)
                interfaces_arp[current_iface] = []
                continue
            
            if current_iface:
                m = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F-]+)\s+dynamic", line)
                if m:
                    ip = m.group(1)
                    if not ip.startswith(("224.", "239.", "255.", "127.")):
                        interfaces_arp[current_iface].append(ip)
    except Exception as e:
        logger.warning(f"Failed to read arp table: {e}")

    # Pick the interface with the most active dynamic entries (excluding loopback)
    best_iface = "192.168.22.60" if "192.168.22.60" in interfaces_arp else "127.0.0.1"
    max_entries = -1
    for iface, ips in interfaces_arp.items():
        if not iface.startswith(("127.", "169.254.")) and len(ips) > max_entries:
            max_entries = len(ips)
            best_iface = iface

    parts = best_iface.split(".")
    subnet = f"{parts[0]}.{parts[1]}.{parts[2]}.0/24" if len(parts) == 4 else "192.168.22.0/24"
    gateway = f"{parts[0]}.{parts[1]}.{parts[2]}.254" if len(parts) == 4 else "192.168.22.254"
    arp_ips = interfaces_arp.get(best_iface, [])

    return {
        "local_ip": best_iface,
        "detected_subnet": subnet,
        "gateway": gateway,
        "arp_ips": arp_ips,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend\venv\Scripts\python.exe -m pytest backend/test_discovery.py -v`

---

### Task 2: Implement Fast ARP-First Discovery (<2s) & Optimize Full Scan

**Files:**
- Modify: `backend/app/discovery.py:74-189`
- Modify: `backend/app/models.py`
- Modify: `backend/app/main.py:478-492`
- Test: `backend/test_real_snmp.py`

- [ ] **Step 1: Update `ScanRequest` in `models.py`**

Add `scan_mode: str = "quick"` to `ScanRequest`:
```python
class ScanRequest(BaseModel):
    cidr: Optional[str] = "auto"
    community: Optional[str] = "public"
    snmp_port: Optional[int] = 161
    scan_mode: Optional[str] = "quick" # "quick" (ARP + core IPs in <2s) or "full" (all 254 IPs)
```

- [ ] **Step 2: Optimize ping & probe logic in `discovery.py`**

- Reduce ping timeout to `200ms` for local LAN probing.
- Increase parallel semaphore from 40 to 64.
- In `"quick"` mode: probe only known ARP dynamic neighbors + `.1` + `.254` + `.2` + `.253` + host IP. This finishes in ~1.5 seconds and finds every communicating device on the network!
- In `"full"` mode: probe all 254 IPs, prioritizing ARP neighbors first.

```python
async def scan_network_cidr(
    cidr: Optional[str] = "auto",
    community: str = "public",
    snmp_port: int = 161,
    scan_mode: str = "quick",
    max_hosts: int = 256,
) -> List[Dict[str, Any]]:
...
```

- [ ] **Step 3: Test fast scan speed & accuracy**

Run: `backend\venv\Scripts\python.exe backend/test_real_snmp.py`
Expected: Quick scan finishes in under 3 seconds and discovers real devices (including Switch-Core `192.168.22.254`).

---

### Task 3: Add Backend Health Endpoint & Frontend Connection Status

**Files:**
- Modify: `backend/app/main.py`
- Modify: `netmonitor/src/services/api.ts`
- Modify: `netmonitor/src/components/discovery/NetworkScanModal.tsx`
- Modify: `netmonitor/src/i18n/th.ts` & `en.ts`

- [ ] **Step 1: Add `/api/v1/health` in `main.py`**

```python
@app.get("/api/v1/health")
async def health_check():
    return {"status": "ok", "service": "netmonitor-backend", "version": "1.0.0"}
```

- [ ] **Step 2: Add `checkBackendHealth` and error handling in `api.ts`**

If backend is down, do NOT silently pretend it succeeded with empty data: notify the caller with an explicit status.

```typescript
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Update `NetworkScanModal.tsx` UI**

- Add Backend Online indicator: `🟢 Backend Online` or `🔴 Backend Offline (กรุณาสตาร์ท run_backend.bat)`.
- Add Quick Scan (⚡ สแกนด่วน 1-2 วินาที) vs Full Scan (🌐 สแกนละเอียดทั้งวง 254 IP).
- Display exact scan duration (e.g. `สแกนเสร็จสิ้นใน 1.2 วินาที พบ 58 อุปกรณ์`).
- Disable scan button if backend is offline, with clear help banner.

- [ ] **Step 4: Verify frontend build**

Run: `cd netmonitor && npm run build`
Expected: 0 errors, 0 warnings.

---

### Task 4: Persistent Service Startup & End-to-End Verification

**Files:**
- Create: `start_all.bat`
- Verify: Full browser live test

- [ ] **Step 1: Create `start_all.bat`**

Create a clean launcher that runs PostgreSQL container check, starts uvicorn on `http://127.0.0.1:8000`, and starts Vite on `http://localhost:5173`.

- [ ] **Step 2: Start background backend service**

Start `uvicorn app.main:app --host 127.0.0.1 --port 8000` as a background task.

- [ ] **Step 3: Verify live endpoint with curl/powershell**

Probe `http://127.0.0.1:8000/api/v1/discovery/local-info` and `http://127.0.0.1:8000/api/v1/discovery/scan`.
Expected: HTTP 200 with real devices listed.

- [ ] **Step 4: Commit changes**

```bash
git add backend/ netmonitor/ start_all.bat docs/
git commit -m "fix(discovery): fix subnet auto-detection, add fast ARP scan mode, and display backend health status"
```

