# NetMonitor (Web-based Network Topology & SNMP Monitoring)

[![Version](https://img.shields.io/badge/version-1.3.5-blue.svg)](./HANDOVER.md)
[![E2E Tests](https://img.shields.io/badge/playwright%20e2e-18%20passed-brightgreen.svg)](./netmonitor/e2e/)
[![Backend Tests](https://img.shields.io/badge/pytest-41%20passed-brightgreen.svg)](./backend/tests/)
[![React](https://img.shields.io/badge/React-19.3-61dafb.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17%20Alpine-336791.svg)](https://www.postgresql.org/)

ระบบติดตามสถานะอุปกรณ์เครือข่ายและผังโทโพโลยีบนเว็บ (Web-based Network Topology & SNMP Monitoring) สำหรับห้องปฏิบัติการและทีม NOC แสดงผลผังอาคาร 2 มิติควบคู่กับแผนที่ดาวเทียม รองรับการสแกนค้นหาอุปกรณ์ การเก็บข้อมูลทราฟฟิกพอร์ตจริงผ่าน SNMP การวิเคราะห์ผลกระทบลูกโซ่เมื่ออุปกรณ์หรือสายเชื่อมขัดข้อง และระบบจำลองสถานการณ์ความผิดปกติ

---

## ฟีเจอร์หลัก (Core Features)

1. **Dual-Mode Visualization & Layout Sync**
   - **2D Floor Plan Canvas:** ผังอาคาร 2 มิติแสดงห้อง โซนทำงาน และตำแหน่งอุปกรณ์ รองรับการซูม/เลื่อน (Pan & Zoom) ลากจัดวาง และล็อคตำแหน่งอุปกรณ์
   - **Satellite Map Overlay:** ทาบผังห้องลงบนแผนที่ฐาน Leaflet (Carto / OpenStreetMap / ภาพดาวเทียม) ด้วยการแปลงพิกัดแบบ Bilinear Affine Transformation
   - **Canonical Floor Layouts:** บันทึกและซิงค์ผังห้องรายชั้นผ่าน `GET /api/v1/layout` และ `PUT /api/v1/layout/{floor}` ในตาราง `floor_layouts` ของ PostgreSQL ร่วมกับ cache ใน `localStorage`
2. **Network Discovery & Device Classification**
   - สแกนอุปกรณ์ในวงแลนผ่าน ARP cache, ICMP Ping-first, Reverse DNS, MAC OUI lookup และ SNMP (`sysName`, `sysDescr`, `sysServices`, `ipForwarding`) รองรับทั้ง Windows และ Linux (`ip neigh`, `ip route`)
   - จำแนกประเภทอุปกรณ์ (`router`, `switch`, `ap`, `server`), คำนวณตำแหน่งวางลงห้อง (`placement.py`), แก้ไขชื่อก่อนนำเข้า และป้องกันข้อมูลซ้ำซ้อนทาง IP และชื่อ
3. **SNMP Telemetry & Alert-Aware Device Status**
   - Background Poller (ทำงานทุก 30 วินาทีตามค่าเริ่มต้น `SNMP_POLL_INTERVAL_S = 30`) เก็บ Counter 64-bit (`ifHCInOctets`/`ifHCOutOctets`), CPU, Memory, อุณหภูมิ, Ping RTT และ `sys_uptime` ลง PostgreSQL
   - สถานะอุปกรณ์ (`online`, `warning`, `offline`) คำนวณจากสถานะ `enabled`, unacknowledged active alerts (`crit` -> `offline`, `warn` -> `warning`) และผล poll ล่าสุดใน `poll_runs`
   - ปุ่มรับทราบปัญหา (Acknowledge) และแสดงกราฟ Inbound/Outbound ตามช่วงเวลา (รวมถึงทราฟฟิกรวมทุกพอร์ตแบบผลรวม)
4. **Topology Inference & Blast-Radius Simulation**
   - เชื่อมโยงโทโพโลยีอัตโนมัติ (`backend/app/topology.py`) และสร้าง/ลบสายเชื่อมด้วยตนเอง (`Link Edit Mode`, `/api/v1/topology/links`)
   - วิเคราะห์ผลกระทบลูกโซ่ (Root Down, Unreachable, Degraded Path), คะแนน SPOF, ห้อง/โซนที่ได้รับผลกระทบ และบริการที่หยุดชะงักผ่าน `/api/v1/simulate/impact` พร้อม `ServiceTagsEditor` สำหรับกำหนดแท็กบริการรายเครื่อง
   - แยกสถานะจำลองด้วยคอลัมน์ `devices.is_simulated` โดยไม่เขียนทับ `credential_ref`
5. **Search, Themes & Bilingual UI**
   - หน้าต่างค้นหาอุปกรณ์ (`Ctrl + K` / Command Palette) ค้นหาจากชื่อ, IP, ประเภท หรือห้อง
   - รองรับ Dark Theme และ Balanced Warm Tan / Almond-Beige Light Theme (`--bg-canvas: #ddd0be`, `--bg-surface: #ede1cf`)
   - UI Scale 3 ระดับ (`100%`, `125%`, `150%` ใน `SettingsProvider`, ค่าเริ่มต้น `100%`) และรองรับ 2 ภาษา (`th` / `en` ผ่าน `i18next`)

---

## สถาปัตยกรรมระบบ (Architecture)

```text
+-------------------------------------------------------------------------------+
|                       Frontend Client (React 19 + TypeScript)                 |
|  - Vite Dev Server (Port 5173) / Static Dist + Reverse Proxy (/api -> :8000)  |
|  - 2D FloorCanvas & TopologyLinksLayer | Leaflet Map Overlay                  |
|  - ImpactDrawer & BusinessImpactSummary | TrafficChart & ServiceTagsEditor    |
|  - Contexts: NetworkProvider, FaultSimProvider, SettingsProvider, Simulation  |
+---------------------------------------+---------------------------------------+
                                        |
                 [HTTP / REST API (/api/v1/*) + X-API-Key Header]
                 [Offline Fallback: localStorage + client topologyEngine]
                                        |
+---------------------------------------v---------------------------------------+
|                    Backend API & Poller (FastAPI + Uvicorn)                   |
|  - API Controllers (`app/main.py`) + API Key Auth (`require_api_key`)         |
|  - Repository Layer (`app/repository.py`) | Schemas (`app/models.py`)         |
|  - Topology & Blast-Radius Engine (`app/topology.py`)                         |
|  - Discovery & Placement (`app/discovery.py`, `classifier.py`, `placement.py`)|
|  - Background SNMP Poller & Retention (`app/collector.py`, Advisory Lock)     |
+---------------------------------------+---------------------------------------+
                                        |
                     [asyncpg Connection Pool (min 2, max 10)]
                                        |
+---------------------------------------v---------------------------------------+
|                       Database Layer (PostgreSQL 17 Alpine)                   |
|  - Docker Container: `docker-db-1` (Port 5432 / DB: `netmon`)                 |
|  - Tables: devices, interfaces, poll_runs, interface_samples,                 |
|            device_metric_samples, alerts, topology_links, floor_layouts       |
+-------------------------------------------------------------------------------+
```

---

## เริ่มต้นใช้งาน (Quick Start)

รายละเอียดการตั้งค่าทั้งหมดและตัวแปรสภาพแวดล้อมดูได้ที่ [HANDOVER.md](./HANDOVER.md), [backend/README.md](./backend/README.md) และ [netmonitor/README.md](./netmonitor/README.md)

### วิธีที่ 1: Windows One-Click Launch
รันสคริปต์ [`start_all.bat`](./start_all.bat) ที่ Root ของโปรเจกต์เพื่อเปิด PostgreSQL (`5432`), FastAPI (`8000`) และ Vite (`5173`) พร้อมกัน

### วิธีที่ 2: รันแยกส่วน (Manual Setup)

1. **เตรียม Environment & PostgreSQL (Docker):**
   คัดลอก [`.env.example`](./.env.example), [`backend/.env.example`](./backend/.env.example) และ [`netmonitor/.env.example`](./netmonitor/.env.example) เป็น `.env` (ตั้งค่า `DB_PASSWORD`, `API_KEY`, `VITE_API_KEY`, `ALLOWED_ORIGINS`) แล้วรัน:
   ```bash
   docker compose up -d
   ```
2. **Backend (FastAPI):** ดูขั้นตอนใน [backend/README.md](./backend/README.md)
3. **Frontend (React + Vite):** ดูขั้นตอนใน [netmonitor/README.md](./netmonitor/README.md)

---

## การทดสอบระบบ (Automated Test Suites)

```bash
# 1. Backend Unit & Integration Tests (Pytest — 41 test cases)
cd backend
.\venv\Scripts\python.exe -m pytest test_classifier.py tests/ -v

# 2. Frontend Playwright E2E Suite (18 scenarios — ต้องรัน DB, Backend และ Frontend อยู่)
cd ../netmonitor
npm run test:e2e
npm run test:e2e:ui

# 3. โหลดและ Fault Simulation (ดูรายละเอียดเงื่อนไขใน HANDOVER.md)
cd ../backend
.\venv\Scripts\python.exe simulate_faults.py
k6 run ../load_test.js
k6 run ../stress_limit_test.js
```

---

## เอกสารเพิ่มเติม (Documentation)

- [HANDOVER.md](./HANDOVER.md) — เอกสารส่งมอบระบบฉบับสมบูรณ์ (ปัญหาที่แก้ไข, ทางเลือกสถาปัตยกรรม, ความเสี่ยงและความปลอดภัย, คู่มือติดตั้งและปฏิบัติการ)
- [backend/README.md](./backend/README.md) — รายละเอียดโมดูล Backend, ตัวแปร config และคำสั่งทดสอบ Python
- [netmonitor/README.md](./netmonitor/README.md) — รายละเอียดโครงสร้าง Frontend, i18n, Build และ Playwright E2E
