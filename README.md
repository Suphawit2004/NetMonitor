# NetMonitor (Web-based Network Topology & Monitoring System)

[![Version](https://img.shields.io/badge/version-1.3.5-blue.svg)](HANDOVER.md)
[![E2E Tests](https://img.shields.io/badge/playwright%20e2e-10%2F10%20passed-brightgreen.svg)](netmonitor/e2e/netmonitor.spec.ts)
[![Backend Tests](https://img.shields.io/badge/pytest-24%20passed%2C%202%20skipped-brightgreen.svg)](backend/tests/)
[![React](https://img.shields.io/badge/React-19.3-61dafb.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17%20Alpine-336791.svg)](https://www.postgresql.org/)

ระบบบริหารจัดการและติดตามสถานะอุปกรณ์เครือข่ายอัจฉริยะ (Web-based Network Topology & SNMP Monitoring) สำหรับห้องปฏิบัติการและศูนย์เฝ้าระวังเครือข่าย (NOC) แสดงผลผังอาคาร 2 มิติควบคู่กับภาพถ่ายดาวเทียมจริง รองรับการตรวจจับอุปกรณ์อัตโนมัติ การวิเคราะห์ทราฟฟิกพอร์ตจริง และระบบจำลองสถานการณ์ความผิดปกติครบวงจร

---

## 🌟 ฟีเจอร์หลัก (Core Features)

1. **Dual-Mode Visualization (การแสดงผล 2 รูปแบบคู่ขนาน):**
   * **2D Floor Plan Canvas:** ผังอาคาร 2 มิติ แสดงห้อง, โซนทำงาน, และตำแหน่งอุปกรณ์ รองรับการซูม/เลื่อน (Pan & Zoom) ลากจัดวาง และล็อคตำแหน่งอุปกรณ์แบบป้องกันการเลื่อนโดยไม่ตั้งใจ
   * **Satellite Map Overlay:** ทาบผังห้องลงบนภาพถ่ายดาวเทียมจริงตามพิกัดสากล WGS84 GPS ด้วยระบบแปลงพิกัดสองทาง (Bilinear Affine Transformation) ทำให้ตำแหน่งบนผัง 2D และดาวเทียมตรงกันเสมอ
2. **Zero-Config Network Discovery (ระบบค้นหาอุปกรณ์อัตโนมัติ):**
   * สแกนค้นหาอุปกรณ์ในวงเครือข่าย (< 3 วินาที) ผ่าน Dynamic ARP Caching และ ICMP Ping-first
   * ระบบสืบค้นชื่อจริง (Smart Naming) ดึงจาก SNMP `sysName`, Local Reverse DNS (mDNS/DHCP) และฐานข้อมูล MAC OUI
   * ระบบจำแนกประเภทอุปกรณ์อัจฉริยะ (Smart Classifier) รองรับ Router, Switch, Access Point, และ Server ผ่าน RFC 1213 IP Forwarding OID, Default Gateway Suffix, และ sysServices
   * แก้ไขชื่ออุปกรณ์ได้ทันที (Inline Editing) ก่อนนำเข้า และมีระบบป้องกันข้อมูลซ้ำซ้อน (Deduplication)
3. **Deep Diagnostics & Real SNMP Telemetry:**
   * ตรวจวัดสุขภาพอุปกรณ์ครบมิติ (Uptime, CPU Load, Memory Usage, อุณหภูมิ, Packet Loss)
   * ดึงข้อมูล Inbound/Outbound จากพอร์ตสวิตช์จริงผ่าน SNMP IF-MIB 64-bit HC Octets (`ifHCInOctets`/`ifHCOutOctets`)
   * กราฟ Bandwidth Real-Time (Traffic Chart) สไตล์ MRTG/Grafana พร้อม Interactive Crosshair และ Tooltip แสดงหน่วย Mbps แม่นยำ
   * แถบวิเคราะห์ปัญหาอัตโนมัติ (Diagnostic Suggestion Banner) แนะนำแนวทางแก้ไขเมื่ออุปกรณ์มีสถานะเตือนหรือออฟไลน์
4. **Alert-Aware Telemetry & Life-Cycle Management:**
   * สถานะอุปกรณ์ผูกโยงกับ Unacknowledged Active Alerts (Critical $\rightarrow$ Offline, Warning $\rightarrow$ Warning)
   * ปุ่มรับทราบปัญหา (Acknowledge) พร้อมระบบ Optimistic UI ปรับสถานะเป็น "รับทราบแล้ว" ทันทีและกู้คืนสถานะอุปกรณ์
5. **One-Click Fault Simulation & Reset UI:**
   * ปุ่มจำลองปัญหาเครือข่ายเสมือนจริง 6 กรณี และปุ่มรีเซ็ตระบบ บนหน้า **Floor Plan** และ **Device List** พร้อม Confirm Dialog และ Toast แจ้งเตือน
   * ระบบป้องกัน Background Poller ทับซ้อนข้อมูลจำลองด้วย `credential_ref = 'simulated'`
6. **Global Search & Modern NOC Ergonomics:**
   * หน้าต่างค้นหาอุปกรณ์สากล (`Ctrl + K` / Command Palette) ค้นหาจากชื่อ, IP, ชนิด หรือห้อง
   * รองรับทั้ง Dark Theme และ Soft Slate Light Theme (Anti-Glare ถนอมสายตา)
   * ตัวเลือกปรับขนาด UI 150% Scale สำหรับจอ NOC และสลับได้ทันที (100% / 125% / 150%)
   * รองรับสองภาษา (ไทย 🇹🇭 / English 🇺🇸) ครบถ้วน 100% ด้วย Lucide Vector Icons ทั่วทั้งระบบ

---

## 🏗️ สถาปัตยกรรมระบบ (Architecture)

```text
+-------------------------------------------------------------------------------+
|                       ชั้นส่วนติดต่อผู้ใช้ (Frontend Client)                   |
|  - React 19 + TypeScript + Vite (Port 5173)                                   |
|  - 2D Canvas Engine (Pan/Zoom/Drag) | Leaflet Map Overlay (Satellite/Carto)   |
|  - Modular Layout (NavbarSearch, FloorCanvas, DevicePin, TrafficChart)        |
|  - NetworkContext & State Store     | Lucide React Icons | i18next            |
+---------------------------------------+---------------------------------------+
                                        |
                 [HTTP / REST API Proxy: /api -> :8000]
                 [Offline Fallback: LocalStorage Engine]
                                        |
+---------------------------------------v---------------------------------------+
|                    ชั้นบริการเซิร์ฟเวอร์ (FastAPI Backend Engine)             |
|  - FastAPI Framework + Uvicorn Asynchronous Server (Port 8000)                |
|  - Clean Architecture: Thin Controllers (`app/main.py`)                       |
|  - Decoupled Repository Pattern: Data Access Layer (`app/repository.py`)      |
|  - Smart Placement & Geofence Engine (Bilinear Affine Transformation)         |
|  - Network Discovery Worker (ARP Cache + Reverse DNS + Semaphore Pool)        |
|  - SNMP Poller Engine (PostgreSQL Advisory Lock ป้องกัน Worker แย่ง Poll)    |
+---------------------------------------+---------------------------------------+
                                        |
                     [asyncpg Connection Pool (Max Size: 10)]
                                        |
+---------------------------------------v---------------------------------------+
|                       ชั้นฐานข้อมูล (Database Layer)                          |
|  - Docker Container: 'docker-db-1' (PostgreSQL 17 Alpine)                     |
|  - Port: 5432 / Database: netmon                                              |
|  - ตาราง: devices, alerts, poll_runs, interfaces, interface_samples,          |
|          device_metric_samples                                                |
+-------------------------------------------------------------------------------+
```

---

## 🚀 เริ่มต้นใช้งาน (Quick Start Guide)

### วิธีที่ 1: One-Click Launch (แนะนำสำหรับ Windows)
ดับเบิลคลิกไฟล์:
```text
start_all.bat
```
สคริปต์จะเริ่มทำงานอัตโนมัติ:
1. เปิด Docker Database (`docker-db-1` พอร์ต 5432)
2. เริ่ม FastAPI Backend Service (`http://127.0.0.1:8000`)
3. เริ่ม Vite Frontend Web App (`http://localhost:5173`)

---

### วิธีที่ 2: รันแยกส่วนทีละ Service (Manual Setup)

#### 1. โคลนและเตรียม Environment
```bash
git clone https://github.com/Suphawit2004/NetMonitor.git
cd NetMonitor
```

#### 2. เริ่มต้นฐานข้อมูล PostgreSQL (Docker)
```bash
docker compose up -d
```
* **พอร์ต:** `127.0.0.1:5432` | **Database:** `netmon` | **User:** `netmon`

#### 3. รัน FastAPI Backend
```bash
cd backend
python -m venv venv

# บน Windows:
.\venv\Scripts\activate
# บน Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
* **Interactive Swagger UI:** `http://127.0.0.1:8000/docs`

#### 4. รัน Frontend (React 19 + Vite)
```bash
cd netmonitor
npm install
npm run dev
```
* **Web Application:** `http://localhost:5173`

---

## 🧪 การทดสอบระบบ (Automated Test Suites)

```bash
# 1. รัน Playwright End-to-End Suite (10/10 ผ่าน 100%):
cd netmonitor
npm run test:e2e
# หรือรันแบบเปิด UI Dashboard:
npm run test:e2e:ui

# 2. รัน Pytest Backend Unit & Integration Tests (24 passed, 2 skipped):
cd ../backend
pytest -v

# 3. รันสคริปต์จำลองเหตุการณ์ปัญหาเสมือนจริง:
python simulate_faults.py

# 4. ทดสอบโหลดความทนทาน 500 VUs ด้วย k6:
k6 run ../load_test.js
```

---

## 📁 โครงสร้างโปรเจกต์ (Key Directories)

```text
snmp_font_end/
├── start_all.bat                # สคริปต์เปิดทั้งระบบในคลิกเดียว (Windows)
├── docker-compose.yml           # Docker Service (PostgreSQL 17 Alpine)
├── load_test.js                 # สคริปต์ k6 สำหรับทดสอบความทนทาน
├── HANDOVER.md                  # เอกสารส่งมอบระบบฉบับสมบูรณ์ (Version 1.3.5)
│
├── backend/                     # Backend API (FastAPI)
│   ├── app/
│   │   ├── main.py              # API Endpoints & Request Orchestration
│   │   ├── repository.py        # Data Access Layer & Decoupled SQL Queries
│   │   ├── database.py          # asyncpg Connection Pool & Auto-Migration
│   │   ├── models.py            # Pydantic Schemas & DTO
│   │   ├── collector.py         # SNMP Poller & Bandwidth Calculation
│   │   ├── discovery.py         # Network Discovery & ARP Scanner
│   │   └── classifier.py        # Smart Device Classification Engine
│   ├── tests/                   # ชุดทดสอบ Pytest
│   └── simulate_faults.py       # สคริปต์จำลอง Faults, Interfaces, และ Telemetry
│
└── netmonitor/                  # Frontend Web App (React 19 + TypeScript)
    ├── e2e/                     # ชุดทดสอบ Playwright E2E (10 Scenarios)
    ├── src/
    │   ├── components/
    │   │   ├── floor/           # FloorCanvas, FloorMapOverlay, DevicePin
    │   │   ├── detail/          # DeviceInfoModal, TrafficChart
    │   │   └── layout/          # Navbar, NavbarSearch (Ctrl+K)
    │   ├── pages/               # FloorPlan, DeviceList, DeviceDetail, Reports
    │   └── context/             # NetworkContext, State Store
    └── vite.config.ts           # การตั้งค่า Vite & Proxy /api
```

---

## 📄 เอกสารเพิ่มเติม (Documentation)
* [HANDOVER.md](HANDOVER.md) — เอกสารส่งมอบระบบฉบับสมบูรณ์ (Architecture, Benchmarks, Detailed Changelog)
* [DESIGN.md](DESIGN.md) — คู่มือและมาตรฐานการออกแบบ UI/UX Design System
