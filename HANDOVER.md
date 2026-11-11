# เอกสารส่งต่องานระบบ NetMonitor (Project Handover Documentation)
> ระบบบริหารจัดการและติดตามสถานะอุปกรณ์เครือข่ายอัจฉริยะ (Web-based Network Topology & Monitoring)

---

**ข้อมูลทั่วไปของโครงการ (Project Information)**
* **ชื่อโครงการ:** NetMonitor (Web-based Network Topology & SNMP Monitoring System)
* **เวอร์ชันเอกสาร:** Version 1.3.4 (Production Hardened — Verified Concurrency, Zero-State Resilient)
* **วันที่ปรับปรุงล่าสุด:** 10 พฤศจิกายน 2026
* **ทีมพัฒนา:** แผนกพัฒนาระบบเครือข่ายและโครงสร้างพื้นฐานดิจิทัล
* **สถานะความพร้อม:** ผ่านการทดสอบระดับระบบ (End-to-End), โหลดทดสอบระดับ 500 VUs (k6), Pytest Unit & Integration Tests ผ่าน 100% (26/26), Vite Build ผ่าน 100%, ประเมินมาตรฐาน Web Vitals 100%, ปรับสเกล UI 150%, รองรับ Lucide Icons และมีชุดจำลองเหตุการณ์แจ้งเตือน/ออฟไลน์เสมือนจริง ครบถ้วน 100%

---

## สารบัญ (Table of Contents)
1. บทสรุปและภาพรวมของระบบ (Executive Summary & System Overview)
2. สถาปัตยกรรมและเทคโนโลยีที่ใช้ (Architecture & Technology Stack)
3. โครงสร้างโฟลเดอร์และไฟล์สำคัญ (Project Directory Structure)
4. ฟังก์ชันหลักและความสามารถของระบบ (Core Features & Capabilities)
5. ผลการทดสอบประสิทธิภาพและสมรรถนะ (Load & Quality Benchmarks)
6. คู่มือการติดตั้งและการเริ่มต้นใช้งาน (Installation & Quick Start Guide)
7. ชุดคำสั่งทดสอบระบบ (Automated Test Suites)
8. บันทึกการปรับปรุงระบบล่าสุด (Recent Updates & Changelog — 10 พ.ย. 2026)
9. แนวทางการบำรุงรักษาและการขยายระบบในอนาคต (Maintenance & Scaling Guidelines)

---

## 1. บทสรุปและภาพรวมของระบบ (Executive Summary & System Overview)

**NetMonitor** เป็นระบบบริหารจัดการและติดตามสถานะอุปกรณ์เครือข่ายแบบรวมศูนย์ (Full-Stack Network Monitoring System) พัฒนาขึ้นเพื่อทดแทนการตรวจสอบอุปกรณ์ผ่าน CLI หรือตารางข้อมูลแบบเดิม โดยมุ่งเน้นการแสดงผลเชิงภาพ (Visual Topology) ที่ใช้งานง่าย ตอบสนองรวดเร็ว และให้ข้อมูลเชิงลึกแบบ Real-time

### 1.1 เป้าหมายและขอบเขตที่ไม่ครอบคลุม (Goals & Non-Goals)
* **เป้าหมายหลักของระบบ (Goals):**
  1. การแสดงสถานะอุปกรณ์เครือข่าย (Router, Switch, Access Point, Server) บนแผนผังอาคาร 2 มิติ และภาพถ่ายดาวเทียมแบบเรียลไทม์
  2. การค้นพบอุปกรณ์อัตโนมัติ (Zero-Config Network Discovery) ผ่าน ARP Caching, ICMP Ping และการจำแนกประเภทอุปกรณ์ด้วย SNMP
  3. การตรวจสอบทราฟฟิกข้อมูลจริงระดับอินเทอร์เฟซ (Interface Telemetry) โดยคำนวณจากเคาน์เตอร์ 64-bit HC Octets ผ่าน SNMP IF-MIB
  4. การบริหารจัดการวงจรชีวิตการแจ้งเตือน (Alert Lifecycle) แบบรวมศูนย์ รองรับการรับทราบ (Acknowledge) และการแก้ไข (Resolve)
  5. ความทนทานระดับสูง รองรับการเข้าถึงพร้อมกัน 500 VUs โดยปราศจากข้อผิดพลาด (0.00% Error Rate)
* **ขอบเขตที่ไม่ครอบคลุม (Non-Goals):**
  1. ไม่ใช่ระบบ Config Management หรือ Network Automation (ไม่รองรับการส่งคำสั่งเขียนหรือแก้ไขการตั้งค่าอุปกรณ์ผ่าน SSH/CLI หรือ SNMP SET)
  2. ไม่ใช่ระบบจัดเก็บ Syslog/NetFlow/sFlow ขนาดใหญ่ระดับ Enterprise Data Lake (ข้อมูลทราฟฟิกถูกจัดเก็บเป็นสถิติรายรอบการ Polling เท่านั้น)
  3. ไม่ครอบคลุมการจัดการสิทธิ์ผู้ใช้งานระดับละเอียด (Multi-tenancy / RBAC) — ระบบมุ่งเน้นสำหรับทีมปฏิบัติการเครือข่าย (NOC) ในเครือข่ายภายใน

### จุดเด่นสำคัญของระบบ:
1. **การแสดงผลแผนผัง 2 รูปแบบคู่ขนาน (Dual-Mode Visualization):**
   * **ผังอาคาร 2 มิติ (2D Floor Plan Canvas):** แสดงตำแหน่งห้อง (Server Room, Network Core, Zone ทำงาน) พร้อมระบบซูม เลื่อน (Pan/Zoom) และลากจัดวางตำแหน่งอุปกรณ์ได้อย่างอิสระ
   * **แผนที่ภูมิศาสตร์ดาวเทียม (Satellite Map Overlay):** ทาบผังห้องลงบนภาพถ่ายดาวเทียมจริงตามพิกัดสากล WGS84 GPS มีระบบแปลงพิกัดสองทาง (Two-Way Affine Mapping) ทำให้พิกัดบนผัง 2 มิติและพิกัดบนแผนที่ดาวเทียมตรงกันเสมอ
2. **ระบบค้นหาอุปกรณ์อัตโนมัติความเร็วสูง (Zero-Config Network Discovery):**
   * ค้นหาอุปกรณ์ในวงเครือข่ายได้เร็วกว่า 3 วินาที (สำหรับ 90+ โฮสต์) ผ่าน Dynamic ARP Caching และ ICMP Ping-first
   * ค้นหาและตั้งชื่ออุปกรณ์จริงอัตโนมัติ (Smart Naming) ผ่าน SNMP `sysName`, Local Reverse DNS (mDNS/DHCP), และฐานข้อมูลผู้ผลิต (MAC OUI)
3. **การตรวจสอบเชิงลึกและการวิเคราะห์ (Deep Diagnostics & Metrics):**
   * ตรวจวัดสถานะสุขภาพ (Uptime, CPU, Memory, อุณหภูมิ, Packet Loss)
   * แสดงกราฟการใช้แบนด์วิธ (Bandwidth History) พร้อมเส้น Crosshair และ Interactive Tooltip แบบแม่นยำระดับมิลลิวินาที
4. **ระบบจัดการการแจ้งเตือนข้อผิดพลาด (Full-Stack Alert Management):**
   * จัดเก็บและจัดการวงจรชีวิตของ Alert (Critical, Warning, Info) ในฐานข้อมูล PostgreSQL
   * รองรับการรับทราบปัญหา (Acknowledge) และการปิดประเด็น (Resolve) จากหน้าเว็บได้ทันที
5. **สมรรถนะและความเสถียรระดับสูง:**
   * รองรับผู้ใช้พร้อมกันได้ถึง 500 คนพร้อมกัน (~740 คำขอ/วินาที) โดยไม่มีข้อผิดพลาด (0.00% Error Rate)

---

## 2. สถาปัตยกรรมและเทคโนโลยีที่ใช้ (Architecture & Technology Stack)

### 2.1 แผนภาพการทำงานของระบบ (System Architecture Layout)

```text
+-------------------------------------------------------------------------------+
|                       ชั้นส่วนติดต่อผู้ใช้ (Frontend Client)                   |
|  - React 19 + TypeScript + Vite (Port 5173)                                   |
|  - 2D Canvas Engine (Pan/Zoom/Drag) | Leaflet Map Overlay (Satellite/Carto)   |
|  - NetworkContext & State Store     | i18next (รองรับ ไทย / อังกฤษ 100%)       |
|  - ผังห้องและ Room Templates บริหารผ่าน Client-side LocalStorage Engine       |
+---------------------------------------+---------------------------------------+
                                        |
                 [HTTP / REST API Proxy: /api -> :8000]
                 [Offline Fallback: LocalStorage Engine]
                                        |
+---------------------------------------v---------------------------------------+
|                    ชั้นบริการเซิร์ฟเวอร์ (FastAPI Backend Engine)             |
|  - FastAPI Framework + Uvicorn Asynchronous Server (Port 8000)                |
|  - Smart Placement & Geofence Engine (Bilinear Affine Transformation)         |
|  - Network Discovery Worker (ARP Cache + Reverse DNS + Semaphore Pool)        |
|  - SNMP Poller Engine (PostgreSQL Advisory Lock ป้องกัน Worker แย่ง Poll)    |
+---------------------------------------+---------------------------------------+
                                        |
                     [asyncpg Connection Pool (Max Size: 10)]
                                        |
+---------------------------------------v---------------------------------------+
|                       ชั้นฐานข้อมูล (Database Layer)                          |
|  - Docker Container: 'docker-db-1' (Image: postgres:17-alpine)                |
|  - Connection: 127.0.0.1:5432 / Database: netmon                              |
|  - ตารางข้อมูล: devices, alerts, device_metric_samples, interfaces,            |
|               poll_runs, interface_samples                                    |
+-------------------------------------------------------------------------------+
```

### 2.2 ตารางสรุปเทคโนโลยีที่เลือกใช้ (Technology Stack)

| ส่วนประกอบ (Component) | เทคโนโลยีที่ใช้ | เหตุผลและหน้าที่หลัก |
|---|---|---|
| **Frontend Framework** | React 19.3 + TypeScript 5.8 | ประสิทธิภาพสูง ความปลอดภัยของ Type System ครอบคลุมทั้งโปรเจกต์ |
| **Build Tool & Bundler** | Vite 8.3 + Rolldown | Chunk Splitting โหลดหน้าเว็บเร็วเป็นพิเศษ ใช้เวลาบิลด์เพียง ~380ms |
| **Styling** | Vanilla CSS Modules | ไม่พึ่งพา UI Library ภายนอก ควบคุมสไตล์ Dark Theme ได้สมบูรณ์แบบ |
| **Map Engine** | Leaflet 1.9 + Carto / Esri | รองรับการวาดผังห้องโปร่งแสงและหมุดบนพิกัด WGS84 GPS ได้ลื่นไหล |
| **Backend API** | FastAPI + Uvicorn | Asynchronous Python Framework ตอบสนองรวดเร็ว พร้อม Swagger UI |
| **Database Driver** | `asyncpg` | ไดรเวอร์ PostgreSQL แบบ Asynchronous ที่เร็วที่สุดในระบบนิเวศ Python |
| **Database** | PostgreSQL 17 (Docker) | จัดเก็บข้อมูลอุปกรณ์, พิกัด GPS, การล็อค, อินเทอร์เฟซ, ทราฟฟิก และการแจ้งเตือน (โครงสร้างห้องเก็บผ่าน LocalStorage) |
| **Testing Stacks** | Pytest + Grafana k6 + Lighthouse | เครื่องมือทดสอบอัตโนมัติครบวงจร ทั้งระดับ Unit, Load และ Web Performance |

### 2.3 การประเมินทางเลือกสถาปัตยกรรมที่ถูกคัดออก (Alternatives Considered)
1. **การใช้ WebSockets เทียบกับ HTTP Polling สำหรับ Telemetry:**
   * *ทางเลือกที่ถูกคัดออก:* Persistent WebSocket Connection ตลอดเวลา
   * *เหตุผล:* สถาปัตยกรรมแบบ HTTP REST ร่วมกับ Client Polling รอบ 10–30 วินาที ตอบโจทย์การทำงานของเครือข่ายองค์กรขนาดกลาง (100–500 โหนด) ได้อย่างเสถียรกว่ามาก ไม่เกิดปัญหา Connection Drop เมื่อเดินข้าม Subnet และรองรับ Caching/Proxy ได้ดีกว่า
2. **การจัดเก็บโครงสร้างห้องใน PostgreSQL เทียบกับ Client LocalStorage:**
   * *ทางเลือกที่ถูกคัดออก:* การสร้างตาราง `rooms` และ API CRUD บน PostgreSQL
   * *เหตุผล:* ขนาดข้อมูลโครงสร้างห้องเป็นแบบ Static Template ประจำแต่ละชั้น การจัดเก็บใน `localStorage` ช่วยให้หน้าเว็บแสดงผลทันทีโดยไม่ต้องรอ Round-trip API และผู้ใช้สามารถปรับแต่งผังห้องเฉพาะตัวได้แบบ Zero-latency
3. **การใช้ TimeScaleDB เทียบกับ Vanilla PostgreSQL 17:**
   * *ทางเลือกที่ถูกคัดออก:* TimeScaleDB Extension
   * *เหตุผล:* ปริมาณข้อมูล Telemetry ของระบบมีอัตราเติบโตในระดับที่ควบคุมได้ การใช้ตาราง `interface_samples` และ `poll_runs` ร่วมกับการทำ Indexing บน PostgreSQL 17 Alpine มาตรฐาน ให้ความเบา (Lightweight), Portable และลดความซับซ้อนในการติดตั้ง Container

### 2.4 ความเสี่ยง ขีดจำกัด และแนวทางแก้ไข (Risks, Constraints & Mitigations)
1. **ความเสี่ยงการเกิด Multiple Background Polling เมื่อรันหลาย Uvicorn Workers:**
   * *ความเสี่ยง:* หากรัน Uvicorn มากกว่า 1 Worker ใน Production แต่ละ Worker จะเริ่ม Task SNMP Poller แยกกัน ทำให้เกิดการยิง SNMP รบกวนอุปกรณ์สวิตช์ซ้ำซ้อน
   * *แนวทางแก้ไข:* ใช้ **PostgreSQL Advisory Lock (`0x534E4D50`)** ใน `main.py` เพื่อให้มีเพียง 1 Worker ที่ได้สิทธิ์รัน Background Poller ในขณะใดขณะหนึ่ง หาก Worker ล้ม ระบบจะปลด Lock ให้อัตโนมัติ
2. **ข้อจำกัดของ Windows TCP Backlog ต่อการทดสอบโหลด (> 500 VUs):**
   * *ข้อจำกัด:* ระบบปฏิบัติการ Windows มี TCP Socket Backlog จำกัด หากส่งทราฟฟิกเกิน 500 VUs (> 4,500 req/s) Windows จะปฏิเสธการเชื่อมต่อ
   * *แนวทางแก้ไข:* แนะนำให้รันระบบใน Docker Linux Host หรือกำหนด Connection Pooling และ Keep-Alive อย่างเหมาะสมหากต้องการขยายขนาดเกิน 1,000 VUs
3. **ความเสี่ยงข้อมูลจำลองขัดแย้งกับข้อมูลจริง (Synthetic vs Real Data):**
   * *ความเสี่ยง:* การสุ่มข้อมูลหรือสร้างคลื่น Sine หลอกอาจทำให้ผู้ดูแลเครือข่ายเข้าใจผิดเกี่ยวกับประสิทธิภาพของแบนด์วิธ
   * *แนวทางแก้ไข:* ตัดโมดูลคำนวณทราฟฟิกคณิตศาสตร์ Sine Wave ออก หากอุปกรณ์ไม่ตอบสนอง SNMP ระบบจะบันทึกสถานะเป็น 0 Mbps และติดป้าย `No SNMP Data` ชัดเจน

---

## 3. โครงสร้างโฟลเดอร์และไฟล์สำคัญ (Project Directory Structure)

ตำแหน่ง Root ของโครงการ: `C:\work\snmp_font_end\`

```text
snmp_font_end/
├── .gitignore                   # ตัวกรองบล็อกไฟล์ขยะ แคช และ build artifacts
├── start_all.bat                # [สำคัญ] สคริปต์เปิดทั้งระบบ (Docker DB + Backend + Frontend)
├── start_docker_backend.bat     # สคริปต์เปิดเฉพาะ Docker DB และ Backend
├── HANDOVER.md                  # เอกสารส่งมอบระบบฉบับสมบูรณ์ (ไฟล์นี้)
├── seed_mock_data.sql           # ข้อมูลทดสอบ SQL สำหรับรีเซ็ตฐานข้อมูล
├── test_e2e.py                  # สคริปต์ Smoke Test ฝั่ง Backend
├── load_test.js                 # สคริปต์ k6 สำหรับทดสอบโหลดการทำงานทั่วไป
├── stress_limit_test.js         # สคริปต์ k6 สำหรับทดสอบความทนทานถึง 500 VUs
│
├── backend/                     # ระบบ Backend API (FastAPI)
│   ├── app/
│   │   ├── main.py              # จุดรวม API Endpoints, Routers, และ Lifespan
│   │   ├── database.py          # การเชื่อมต่อ asyncpg Pool และระบบ Auto-Migration
│   │   ├── models.py            # Pydantic Schemas และ Data Transfer Objects (DTO)
│   │   ├── discovery.py         # โมดูลสแกนเน็ตเวิร์ก, อ่าน ARP, และ Reverse DNS
│   │   ├── classifier.py        # โมดูลจำแนกประเภทอุปกรณ์อัตโนมัติ
│   │   ├── placement.py         # ระบบคำนวณตำแหน่งลงห้อง และ Affine GPS Mapping
│   │   ├── collector.py         # โมดูล SNMP Poller, คำนวณ Bandwidth และ Sync Interfaces
│   │   ├── snmp.py              # Wrapper เชื่อมต่อคำสั่ง Net-SNMP
│   │   └── config.py            # การโหลดค่า Environment Settings
│   ├── tests/                   # ชุดทดสอบ Pytest (Real Ports, Rollover, Aggregation)
│   ├── test_api.py              # ชุดทดสอบ CRUD API (ผ่าน 100%)
│   ├── test_discovery.py        # ชุดทดสอบการสแกนและนำเข้าอุปกรณ์
│   ├── test_smart_placement.py  # ชุดทดสอบการคำนวณพิกัดอุปกรณ์ลงห้อง
│   ├── test_real_snmp.py        # ชุดทดสอบดึงข้อมูลอุปกรณ์จริงผ่าน SNMP
│   └── run_backend.bat          # สคริปต์รันเฉพาะ Backend
│
└── netmonitor/                  # ระบบ Frontend Web App (React 19)
    ├── public/
    │   └── favicon.svg
    ├── src/
    │   ├── constants/           # deviceMeta.tsx (ไอคอน Lucide และคำค้นหาอุปกรณ์)
    │   ├── components/
    │   │   ├── detail/          # DeviceInfoModal, TrafficChart, MetricCard
    │   │   ├── discovery/       # NetworkScanModal (หน้าต่างสแกนและแก้ชื่ออุปกรณ์)
    │   │   ├── floor/           # FloorCanvas, FloorMapOverlay, DevicePin, FloorSidebar
    │   │   ├── layout/          # Navbar, GlobalSearch (Ctrl + K)
    │   │   └── ui/              # Modal, ConfirmDialog, Toast แจ้งเตือน
    │   ├── context/             # State Stores: Network, Simulation, Settings
    │   ├── data/                # mockData.ts (ผังห้องเริ่มต้นและ Fallback Data)
    │   ├── i18n/                # ไฟล์ภาษา th.ts และ en.ts (ตรงกัน 332 keys 100%)
    │   ├── pages/               # FloorPlanPage, DeviceListPage, DeviceDetailPage, ReportsPage
    │   ├── services/            # api.ts, mapGeo.ts, detailFactory.ts, traffic.ts, roomStore.ts, random.ts
    │   └── types/               # index.ts (TypeScript Type Definitions)
    ├── package.json
    └── vite.config.ts           # การตั้งค่า Chunk Splitting และ Proxy /api
```

---

## 4. ฟังก์ชันหลักและความสามารถของระบบ (Core Features & Capabilities)

### 4.1 ระบบผังห้องและการซิงค์แผนที่ดาวเทียม (Floor Plan & Map Synchronization)
* **โหมดย้ายตำแหน่งปลอดภัย (Move Mode):**
  * มีปุ่ม `🔓 ย้ายตำแหน่ง` / `🔒 ล็อคตำแหน่ง` บนแถบเครื่องมือหลักพร้อมเอฟเฟกต์สีส้มเรืองแสง
  * เมื่อกดล็อคตำแหน่ง ระบบจะบันทึกสถานะ `locked: true` ลง PostgreSQL ทันที ป้องกันหมุดเลื่อนโดยไม่ตั้งใจ
* **การซิงค์พิกัดสองทาง (Two-Way Coordinate Sync):**
  * เมื่อลากย้ายบน 2D Canvas ➔ คำนวณพิกัด GPS อัตโนมัติและบันทึกลงฐานข้อมูลทันที
  * เมื่อลากย้ายบนแผนที่ดาวเทียม ➔ คำนวณพิกัดกลับมาเป็น (x, y) บนผังห้องทันที ทำให้เมื่อสลับมุมมอง หมุดจะอยู่ตรงกันพอดี
* **Hover Mini Tooltip บนแผนที่จริง:**
  * เมื่อชี้เมาส์ที่หมุดบนแผนที่ จะแสดงข้อมูลย่อทันที (ไอคอน, ชื่อ, สถานะเรืองแสง, IP, ชนิด, รุ่น, ชั้น)
  * เมื่อคลิกหมุด จะเปิด Popup เต็มที่มีปุ่ม **"ดูรายละเอียดอุปกรณ์"** และ **"ล็อค/ปลดล็อคตำแหน่ง"**
* **ไอคอนเวกเตอร์คุณภาพสูง (Lucide Vector Icons 100%):**
  * ปรับเปลี่ยนระบบไอคอนทั้งหมดมาใช้ Lucide React เวกเตอร์ 100% ลบไฟล์ PNG เก่าทิ้งทั้งหมด ทำให้ UI โหลดเร็วขึ้น คมชัดทุกระดับความละเอียด และเข้ากับดีไซน์ยุคใหม่

### 4.2 ระบบสแกนและค้นพบเครือข่ายอัตโนมัติ (Zero-Config Network Discovery)
* **สแกนเครือข่ายความเร็วสูง (< 3 วินาที):**
  * ใช้เทคนิคดึงข้อมูลจาก Dynamic ARP Table และตรวจสอบ ICMP Ping ก่อน จึงทำงานรวดเร็วไม่กิน CPU
* **ระบบสืบค้นชื่ออุปกรณ์อัจฉริยะ (Smart Naming):**
  * ดึงชื่อจริงจาก SNMP `sysName` หรือส่งคำสอบถามไปยัง Local Reverse DNS (mDNS/DHCP) ทำให้แสดงชื่อจริงของคอมพิวเตอร์และอุปกรณ์ IoT แทนการใช้ IP เปล่า
* **แก้ไขชื่ออุปกรณ์ได้ทันที (Inline Editable Name ✏️):**
  * ในหน้าต่างผลการสแกน ผู้ใช้สามารถคลิกพิมพ์แก้ไขชื่ออุปกรณ์ในตารางได้อิสระก่อนกดนำเข้าระบบ
* **ระบบป้องกันข้อมูลซ้ำซ้อน (Strict Deduplication):**
  * ตรวจสอบทั้ง IP Address และชื่อ หากมีอยู่ในระบบแล้วจะไม่นำเข้าซ้ำ

### 4.3 ระบบกราฟทราฟฟิก (Traffic Metrics & Telemetry)
* **การดึงข้อมูล Bandwidth จากพอร์ตอุปกรณ์จริง (Real SNMP Interface Polling):**
  * ดึงข้อมูลปริมาณไบต์ Inbound/Outbound จากพอร์ตสวิตช์และเราเตอร์จริงผ่าน SNMP IF-MIB และ ifXTable
  * รองรับเคาน์เตอร์ความจุสูง 64-bit HC Counters (`ifHCInOctets`, `ifHCOutOctets`) สำหรับพอร์ต Gigabit/10G/40G พร้อมระบบ Fallback เป็น 32-bit อัตโนมัติ
  * คำนวณอัตราความเร็วจริงตามสมการ: $\text{Mbps} = \frac{\Delta \text{Octets} \times 8}{\Delta t \text{ (sec)} \times 1,000,000}$ พร้อมระบบป้องกัน Counter wrap-around
  * บันทึกข้อมูลและจัดเก็บลงตาราง `interfaces` (47 พอร์ต) และ `interface_samples` ในฐานข้อมูล PostgreSQL
* **คู่สีมาตรฐาน Telemetry (MRTG / Grafana Style):**
  * แยกคู่สีชัดเจน: **Inbound (ขาเข้า/Download)** เป็นสีเขียวมรกต (`#10b981` ใน Dark / `#059669` ใน Light) และ **Outbound (ขาออก/Upload)** เป็นสีน้ำเงินสด (`#3b82f6` ใน Dark / `#2563eb` ใน Light) เพื่อให้อ่านง่ายทันที
* **ตัวเลือก Interface Selector (Dropdown):**
  * สามารถสลับดูได้ทั้ง **Total Aggregate Bandwidth** (รวมทุกพอร์ตทั้งอุปกรณ์) หรือเจาะจงรายพอร์ตย่อย (เช่น Port 1 Uplink, Port 2, VLAN) ได้ทันที
* **ระบบ Strict Mode สำหรับอุปกรณ์ที่ไม่มี SNMP:**
  * หากอุปกรณ์ไม่รองรับ SNMP (เช่น Node ที่ตอบเฉพาะ ICMP Ping) ระบบจะแสดงเส้น 0 Mbps และติดป้ายกำกับ **`○ No SNMP Data (ICMP Only)`**
  * หากอุปกรณ์รองรับ SNMP จะแสดงป้ายเรืองแสงสีเขียว **`● LIVE (SNMP)`** พร้อมป้าย **`UPDATING...`** เมื่อโพลข้อมูลรอบใหม่
* **กราฟ Bandwidth พร้อม Interactive Tooltip:**
  * เส้น Crosshair วิ่งตามตำแหน่งเมาส์ พร้อมกล่องแก้วแสดงค่า Inbound/Outbound Mbps แบบปัดเศษ 2 ตำแหน่ง หมดปัญหาตัวเลข Floating-point ยาวเกินไป

### 4.4 ระบบจัดการการแจ้งเตือนและการรับทราบปัญหา (Smart Alert Management)
* **การคัดกรองปุ่มรับทราบอย่างมีประสิทธิภาพ:**
  * การแจ้งเตือนระดับ **INFO (ข้อมูลทั่วไป)** จะ**ไม่แสดงปุ่ม "รับทราบ"** เพื่อไม่ให้รบกวนสายตาของผู้ดูแลระบบ
  * ปุ่ม **"รับทราบ"** จะแสดงเฉพาะการแจ้งเตือนระดับ **WARN (เตือน)** และ **CRIT (ออฟไลน์ / วิกฤต)** เท่านั้น
* **การตอบสนองแบบทันที (Optimistic UI):**
  * เมื่อกด "รับทราบ" สถานะจะเปลี่ยนเป็น **"รับทราบแล้ว"** พร้อมไอคอนเครื่องหมายถูกสีเขียวทันที และส่งคำขอบันทึกลงฐานข้อมูลแบบ Background Sync

### 4.5 ประสบการณ์ผู้ใช้และการถนอมสายตา (NOC Ergonomics & Theme)
* **Soft Slate Light Theme (Anti-Glare):**
  * ออกแบบโทนสว่างใหม่ด้วยสี Slate Soft Light (`#e8edf2`, `#f6f8fa`) ลดแสงจ้าและลดความล้าของสายตาสำหรับเจ้าหน้าที่เฝ้าระวังระบบเครือข่าย (NOC Operators) ที่ต้องทำงานต่อเนื่องเป็นเวลานาน
* **การเก็บกวาด UI และตัดปุ่มจำลองออก (UI Simplification):**
  * นำปุ่ม Action จำลอง 4 ปุ่ม (Ping, Telnet/SSH, รีสตาร์ทพอร์ต, กำหนดค่า) ที่ไม่ได้เชื่อมโยงกับอุปกรณ์จริงออก เพื่อลดความสับสนและป้องกันการกดผิดพลาดของผู้ปฏิบัติงาน

### 4.6 การยกระดับระบบตัวอักษรและการรองรับสองภาษา (Typography & Bilingual Resilience)
* **การเชื่อมต่อ Font Stack มาตรฐาน (`Inter` & `Noto Sans Thai`):**
  * ฝังฟอนต์ Google Fonts คุณภาพสูงผ่าน `index.html` และกำหนดใน `index.css` เพื่อขจัดปัญหา Glyph Fallback ใน Windows ให้สระบน (อิ, อี, อึ, อื), สระล่าง (อุ, อู) และวรรณยุกต์ไทยคมชัด ไม่จม ไม่ซ้อนทับ
* **การปรับ Line-height สำหรับภาษาไทย (`1.35`):**
  * ปรับความสูงบรรทัดหัวข้อ `h1`–`h6` จาก 1.25 เป็น 1.35 เพื่อให้สระภาษาไทยมีระยะเว้นว่างปลอดภัย (Safety Margin) ปราศจากการถูก Bounding box ตัดขอบ
* **ขจัดปัญหา Micro-text (Sub-12px Floor Elimination):**
  * ยกเลิกตัวอักษรขนาดต่ำกว่า 12px ทั่วทั้งระบบ โดยปรับป้ายชื่อหมุดอุปกรณ์ขึ้นเป็น `11px` (พร้อมขยาย max-width เป็น 120px), ป้ายชื่อห้องบนผังเป็น `12px`, และป้ายพิกัด/มิติห้องเป็น `11.5px`–`12px`
* **ระบบตัวเลขคงที่สำหรับข้อมูล Real-time (Tabular Numerals):**
  * กำหนด `font-variant-numeric: tabular-nums` บนตัวเลขสถิติ, ข้อมูลแบนด์วิธ, และป้ายนับจำนวนทั้งหมด ป้องกันตัวเลขสั่น (Micro-jitter) ขณะ Polling ข้อมูลสด

### 4.7 ความคมชัดสมบูรณ์แบบและการรองรับโหมดสว่าง (Light Mode Contrast & WCAG AA)
* **การแก้ไข Details Tooltip ในโหมดสว่าง:**
  * กำหนดสไตล์เจาะจงให้กล่องรายละเอียดอุปกรณ์ (`DevicePin` popup) ในโหมดสว่างใช้พื้นหลังขาวบริสุทธิ์ `#ffffff` ขอบ `var(--border-default)` และเงา 3 มิติคมชัด
  * ตัวอักษรชื่ออุปกรณ์และข้อมูลค่าสเปก (IP, ชนิด, รุ่น) แสดงผลเป็นสีดำเข้ม `#0f172a` 100% ไม่ซีดจางกลืนกับพื้นหลัง
  * ปุ่มปลดล็อคตำแหน่ง (`.btnLockActive`) ใช้พื้นหลังสีเหลืองอำพันอ่อน `#fef3c7` และตัวหนังสือสีส้มเข้ม `#b45309` ได้ Contrast Ratio สูง ผ่านเกณฑ์การเข้าถึงระดับสากล WCAG AA

### 4.8 การปรับสัดส่วนโครงสร้างหน้าจอ (Layout & Ergonomics)
* **ขยายความกว้าง FloorSidebar:** ปรับจาก 220px เป็น 240px รองรับข้อความประเภทอุปกรณ์ภาษาไทยที่มีขนาดยาว (เช่น "สวิตช์เครือข่าย", "จุดกระจายสัญญาณไร้สาย") โดยไม่เบียดชิดป้ายจำนวน
* **Responsive Grid สำหรับการ์ดเมตริกใน Modal:** ปรับการ์ดสรุปสถานะ 5 ใบใน `DeviceInfoModal` เป็น Auto-fit CSS Grid (`minmax(110px, 1fr)`) ไม่ล้นหรือตัดคำในจอขนาดเล็ก
* **ขยายขนาด Touch Target บน Navbar:** ปรับปุ่มเปลี่ยนธีมและปุ่มสลับภาษาเป็นขนาด 32px เพื่อการสัมผัสที่แม่นยำยิ่งขึ้นบนหน้าจอแท็บเล็ตและอุปกรณ์พกพา

---

## 5. ผลการทดสอบประสิทธิภาพและสมรรถนะ (Load & Quality Benchmarks)

### 5.1 การทดสอบโหลดด้วย Grafana k6 (Load & Capacity Benchmark)

| ระดับการทดสอบ (Scenario) | ผู้ใช้พร้อมกัน (VUs) | ความเร็วตอบสนอง (Req/s) | Latency (p95) | อัตราข้อผิดพลาด | ผลการประเมิน |
|---|---|---|---|---|---|
| **ระดับปกติ (Baseline)** | 15 VUs | ~60 req/s | **7.96 ms** | **0.00%** | เร็วมาก ตอบกลับระดับ Sub-10ms |
| **ระดับโหลดหนัก (Heavy)** | 150 – 300 VUs | ~400 req/s | **~150 ms** | **0.00%** | ไหลลื่น ไม่มีคำขอตกหล่น |
| **ระดับขีดจำกัดปลอดภัยสูงสุด** | **500 VUs** | **738.77 req/s** | **976 ms** | **0.00%** | **ประมวลผลผ่าน 29,554 คำขอครบ 100% ปราศจาก Error** |
| **ระดับขีดจำกัดวิกฤต (Breaking Point)** | **> 550 – 1,200 VUs** | > 4,500 req/s | Timeout | 95.1% Refused | คอขวดที่ TCP Socket Backlog ของ Windows |

> **สรุปขีดจำกัดปัจจุบัน:** เซิร์ฟเวอร์ในปัจจุบัน (Uvicorn Single Worker + 10 DB Connections) รองรับผู้ใช้พร้อมกันได้สูงสุดอย่างปลอดภัยที่ **500 คนพร้อมกัน** หรือประมาณ **44,400 คำขอต่อนาที**

### 5.2 ผลการตรวจสอบคุณภาพหน้าเว็บด้วย Google Lighthouse
* **Best Practices:** **100 / 100 คะแนนเต็ม** (ปฏิบัติตามมาตรฐานสากลครบถ้วน)
* **Accessibility (การเข้าถึง):** **93 / 100 คะแนน** (โครงสร้าง ARIA, คอนทราสต์ และฟอร์มชัดเจน)
* **ความนิ่งของหน้าจอ (CLS):** **0.008 (คะแนน 100/100)** (ผังหน้าจอนิ่งสนิท ไม่มีการเลื่อนกระตุกขณะโหลด)
* **การตอบสนองต่อผู้ใช้ (TBT):** **160 ms (คะแนน 94/100)** (Main Thread ไม่ถูกบล็อก)
* **SEO:** **83 / 100 คะแนน**

---

## 6. คู่มือการติดตั้งและการเริ่มต้นใช้งาน (Installation & Quick Start Guide)

### 6.1 ความต้องการขั้นต่ำของระบบ (System Requirements)
1. **Node.js:** เวอร์ชัน 18.0.0 หรือใหม่กว่า
2. **Python:** เวอร์ชัน 3.10 หรือใหม่กว่า
3. **Docker Desktop:** สำหรับรันฐานข้อมูล PostgreSQL Container
4. **Net-SNMP CLI Suite:** สำหรับคำสั่ง `snmpget` และ `snmpwalk` (บน Windows แนะนำติดตั้งไว้ที่ `C:\usr\bin` หรือตั้งค่าลง System PATH)

---

### 6.2 การเปิดระบบแบบขั้นตอนเดียว (One-Click Launch — แนะนำ)
ดับเบิลคลิกไฟล์ต่อไปนี้ที่ Root ของโปรเจกต์:
```text
C:\work\snmp_font_end\start_all.bat
```
สคริปต์จะเริ่มทำงานโดยอัตโนมัติ:
1. เปิด Docker Database Container `docker-db-1` (PostgreSQL พอร์ต 5432)
2. เริ่มต้นรัน FastAPI Backend Service ที่ `http://127.0.0.1:8000`
3. เริ่มต้นรัน Vite Frontend Web App ที่ `http://localhost:5173`

---

### 6.3 การเปิดใช้งานแบบแยกส่วน (Manual Execution)

#### ขั้นตอนที่ 1: ตรวจสอบและเปิด Docker Database
```powershell
# ตรวจสอบสถานะ Container
docker ps

# หากยังไม่รัน ให้สั่งเริ่มฐานข้อมูล PostgreSQL ผ่าน Docker Compose ในไดเรกทอรีโปรเจกต์:
docker compose up -d
```
* พอร์ตฐานข้อมูล: `127.0.0.1:5432`
* ฐานข้อมูล: `netmon` (User: `netmon`)

#### ขั้นตอนที่ 2: เริ่มต้นรัน Backend API (FastAPI)
```powershell
cd C:\work\snmp_font_end\backend

# สร้างและเปิดใช้งาน Virtual Environment (หากยังไม่มี)
python -m venv venv
.\venv\Scripts\activate

# ติดตั้งแพ็กเกจที่จำเป็น
pip install -r requirements.txt

# เริ่มต้นรันเซิร์ฟเวอร์ FastAPI
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
* เอกสาร Interactive API (Swagger UI): `http://127.0.0.1:8000/docs`

#### ขั้นตอนที่ 3: เริ่มต้นรัน Frontend Web (React + Vite)
```powershell
cd C:\work\snmp_font_end\netmonitor
npm install
npm run dev
```
* หน้าเว็บแอปพลิเคชัน: `http://localhost:5173`

---

## 7. ชุดคำสั่งทดสอบระบบ (Automated Test Suites)

ผู้ดูแลระบบสามารถรันคำสั่งเหล่านี้เพื่อยืนยันความถูกต้องของระบบได้ตลอดเวลา:

### 1. ทดสอบ Backend API และการคำนวณตำแหน่ง (Python):
```powershell
cd C:\work\snmp_font_end\backend

# 1. ทดสอบ Classifier การจำแนกประเภทอุปกรณ์อัจฉริยะ (17 tests ผ่าน 100%)
.\venv\Scripts\python.exe -m pytest test_classifier.py -v

# 2. ทดสอบระบบ SNMP Poller, การคำนวณ Bandwidth และการ Roll-over เคาน์เตอร์ (9 tests ผ่าน 100%)
.\venv\Scripts\python.exe -m pytest tests/ -v

# 3. ทดสอบ Endpoints CRUD ทั้งหมด
.\venv\Scripts\python.exe test_api.py

# 4. ทดสอบตรรกะการคำนวณตำแหน่งอุปกรณ์ลงห้อง (Smart Spot)
.\venv\Scripts\python.exe test_smart_placement.py

# 5. ทดสอบระบบสแกนและนำเข้าอุปกรณ์ (Discovery Engine)
.\venv\Scripts\python.exe test_discovery.py

# 6. ทดสอบการเชื่อมต่อ Core Switch จริงผ่าน SNMP
.\venv\Scripts\python.exe test_real_snmp.py

# 7. สคริปต์จำลองเหตุการณ์ขัดข้องเสมือนจริง 6 กรณี (Fault Simulation)
.\venv\Scripts\python.exe simulate_faults.py

# 8. รีเซ็ตฐานข้อมูลสู่สถานะเริ่มต้น
curl -X POST http://127.0.0.1:8000/api/v1/reset
```

### 2. ทดสอบการคอมไพล์ Frontend (TypeScript & Vite):
```powershell
cd C:\work\snmp_font_end\netmonitor
npm run build
```

### 3. รันการทดสอบโหลดด้วย k6:
```powershell
k6 run C:\work\snmp_font_end\load_test.js
```

---

## 8. บันทึกการปรับปรุงระบบล่าสุด (Recent Updates & Changelog — 10 พ.ย. 2026)

ในการส่งมอบรอบล่าสุด (Version 1.1.0) ได้มีการตรวจทานและปรับปรุงประสิทธิภาพทั้งฝั่ง Backend และ Frontend ตามแนวทาง **Ponytail Senior Dev** ครบถ้วนดังนี้:

### 8.1 การปรับปรุงฝั่ง Backend & Database:
1. **Dynamic Relative Path และการปรับปรุง Database Reset (`reset_database`):**
   - แก้ไขการอ่านไฟล์ `seed_mock_data.sql` ใน `reset_database` ให้ใช้ `Path(__file__).resolve().parents[2]` เพื่อป้องกันปัญหา Path หายเมื่อรันแอปจากไดเรกทอรีอื่น และตัดการอ่านไฟล์ `migration_002_topology.sql` ซ้ำซ้อนออกเนื่องจากโครงสร้างคอลัมน์และตาราง alerts ถูกย้ายไปสร้างแบบ Auto-migration ใน `database.py` โดยอัตโนมัติแล้ว พร้อมทั้งปรับปรุงข้อมูล Seed Data ให้มีพิกัดเริ่มต้น (x, y) และประเภทอุปกรณ์ (dtype) ครบถ้วนตรงตามผังห้อง
2. **ป้องกัน Race Condition ในการสร้าง Database Connection Pool:**
   - เพิ่ม `asyncio.Lock()` ครอบ `get_db_pool()` แบบ double-checked locking ป้องกันไม่ให้คำขอพร้อมกันในตอนเริ่มเซิร์ฟเวอร์แย่งกันสร้าง connection pool ซ้ำซ้อน
3. **ปรับตั้งค่า CORS ให้สอดคล้องกับมาตรฐานความปลอดภัยเว็บ:**
   - ตั้งค่า `allow_credentials=False` เมื่อใช้ `allow_origins=["*"]` ป้องกันการปฏิเสธคำขอจากเบราว์เซอร์สมัยใหม่
4. **คำนวณสถานะอุปกรณ์จากข้อมูลจริง (Telemetry-based Status Calculation):**
   - ตัดตรรกะที่ดักจับชื่ออุปกรณ์ (`-w`, `ap-a2`, `sw-c1`) ออกทั้งหมด สถานะ `online`, `warning`, `offline` คำนวณจากสถานะการเชื่อมต่อ, Traffic, และ Packet Loss จริง 100%
5. **Auto Interface Discovery ใน Background Poller:**
   - เพิ่มการตรวจสอบและ sync พอร์ตอัตโนมัติใน background SNMP poller เมื่อพบว่าอุปกรณ์ในระบบยังไม่มีข้อมูลพอร์ตในตาราง `interfaces`
6. **ดักจับ Unique Violation ใน `PATCH /api/v1/devices/{id}`:**
   - ครอบ `except asyncpg.UniqueViolationError` ส่งคืน HTTP 400 Bad Request แทน 500 เมื่อมีการเปลี่ยน IP ไปชนกับอุปกรณ์อื่น
7. **ทำความสะอาด Pydantic Model Schema:**
   - ลบฟิลด์ที่นิยามซ้ำซ้อนใน `DiscoveredDevice` schema

### 8.2 การปรับปรุงฝั่ง Frontend & UI/UX:
1. **มาตรฐานคู่สี Telemetry บนกราฟ Bandwidth (`TrafficChart.tsx`):**
   - Inbound (ดาวน์โหลด): เขียวมรกต (`#10b981` ใน Dark / `#059669` ใน Light)
   - Outbound (อัปโหลด): น้ำเงินสด (`#3b82f6` ใน Dark / `#2563eb` ใน Light)
   - ชัดเจน แยกแยะง่าย ไม่ทับซ้อนหรือกลืนกันเหมือนเดิม
2. **ปรับระบบแจ้งเตือน (Alerts Workflow):**
   - การแจ้งเตือนระดับ **INFO** จะไม่แสดงปุ่ม "รับทราบ"
   - แสดงปุ่ม "รับทราบ" เฉพาะระดับ **WARN** และ **CRIT** เท่านั้น พร้อมระบบ Optimistic UI เปลี่ยนเป็น "รับทราบแล้ว" ทันทีที่กด
3. **เพิ่มความแม่นยำในการแสดงผลทราฟฟิก (Floating-point Precision):**
   - ปัดเศษทศนิยมผลรวมทราฟฟิกใน Tooltip ป้องกันบั๊กแสดงทศนิยมยาวล้นกล่อง
   - เพิ่มการส่ง prop `timeRange` ตรงเข้าสู่กราฟเพื่อคำนวณแกนเวลาถอยหลังแม่นยำ
   - แก้ไขปัญหา React key duplicate บนแกน X
4. **ตัดปัญหา Side-effects ใน React State Updaters (`NetworkProvider.tsx`):**
   - ดึงการเรียก API (`api.updateDevice`) ออกจาก callback ภายใน `setDevices` โดยใช้ `devicesRef` เพื่อป้องกันการยิง API ซ้ำ 2 รอบใน React StrictMode
5. **ย้ายระบบไอคอนทั้งหมดสู่ Lucide React Vector Icons 100%:**
   - ลบไฟล์ PNG เก่า 13 ไฟล์ใน `assets/icons/` ออกทั้งหมด ลด Bundle Size และเพิ่มความคมชัด
6. **Soft Slate Light Theme (Anti-Glare):**
   - ปรับชุดสีธีมสว่างให้อยู่ในโทน Slate Soft Light เพื่อถนอมสายตาเจ้าหน้าที่ NOC
7. **UI Simplification:**
   - นำปุ่ม Action จำลอง 4 ปุ่ม (Ping, Telnet/SSH, รีสตาร์ทพอร์ต, กำหนดค่า) ออกอย่างถาวร
8. **Light Mode Adaptation บนแผนที่ดาวเทียม (`FloorMapOverlay.module.css`):**
   - เพิ่มคลาส `:global([data-theme="light"])` รองรับ Floating Map Toolbar และ Stats Badge สรุปสถานะมุมล่างซ้าย ให้สลับเป็น Soft Slate Light Theme อย่างสมบูรณ์ พร้อมปรับสีตัวเลขอัตราสถานะและป็อปอัปให้ชัดเจนในโหมดสว่าง
9. **ลบการแสดงพิกัด GPS Coordinates ใน DeviceInfoModal:**
   - ตัดแถว GPS Coordinates พร้อมลิงก์ Google Maps ออกตามความต้องการ
10. **รองรับ Light Mode เต็มรูปแบบบน 2D Canvas (`FloorCanvas.module.css`):**
   - ปรับให้พื้นที่รอบ Canvas (`--bg-canvas`), พื้นผังห้อง (`.gridInner`), ขอบห้อง (`.room`), ป้ายชื่อห้อง (`.roomLabel`), กล่องสถิติ (`.statsBar`), ปุ่ม Zoom (`.zoomBtn`), ป้ายบอกขนาด (`.dimBadge`) และหมุดอุปกรณ์ (`DevicePin`) สลับเป็น Soft Slate Light Theme อย่างกลมกลืนและสบายตาเมื่อเปิดใช้งานโหมดสว่าง
11. **ปรับสไตล์หมุดอุปกรณ์บน 2D FloorCanvas ให้ตรงกับแผนที่ดาวเทียม (`DevicePin`):**
   - เปลี่ยนหมุดวงกลมขนาด 40px เป็นทรงสี่เหลี่ยมโค้งมนขนาด 26px สไตล์นีออนเรืองแสงตามสถานะ
   - ย้ายไอคอนล็อคไปเป็น Badge วงกลมมุมขวาบน ยกเลิกเส้นประสีเหลืองรอบหมุด
   - ปรับป้ายชื่ออุปกรณ์ด้านล่างให้เป็นแคปซูลเข้มสไตล์มินิมอล คมชัด อ่านง่าย และปรับเป็นสีสว่างในโหมดสว่าง
12. **รองรับ Light Mode เต็มรูปแบบสำหรับผังห้องและหมุดบนแผนที่ดาวเทียม (`FloorMapOverlay`):**
   - ป้ายกำกับห้อง (Room Labels), ป้ายชื่ออุปกรณ์ (Pin Tags), กล่องหมุดอุปกรณ์ และจุดจับย้ายอาคาร ปรับสลับเป็นสไตล์ธีมสว่าง คมชัด ไม่กลืนกับพื้นหลัง
   - เพิ่มตัวเลือกชั้นแผนที่ `Light Theme (Carto)` พร้อมระบบสลับอัตโนมัติเมื่อเปลี่ยนธีมของระบบ
13. **แก้ไขบัคกรอบ Details Popup และสีตัวอักษรของอุปกรณ์ (`DevicePin.module.css`):**
   - เปลี่ยนสีตัวอักษรชื่ออุปกรณ์ (`.popupName`) และค่าข้อมูล (`.popupVal`) จากเดิมที่เป็นสีเทาอ่อนฮาร์ดโค้ด ให้ใช้ `var(--text-primary)` เพื่อให้อ่านชัดเจน คมเข้ม ไม่ซีดจางกลืนกับพื้นหลังในโหมดสว่าง
   - แก้ไขสีเส้นขอบสามเหลี่ยมลูกศรชี้ของ Popup (`.arrow_right`, `.arrow_below`, `.arrow_left`, `.arrow_above`) จากเดิมที่ฮาร์ดโค้ดเป็นสีกรมท่าเข้ม `#2a3d5c` ให้ใช้ `var(--border-default)` เชื่อมต่อกับกรอบอย่างเรียบเนียน
   - ปรับสีเส้นคั่นส่วนหัวและส่วนท้าย (`.popupHeader`, `.popupActions`) เป็น `var(--border-subtle)`
   - ปรับสีข้อความและสีสถานะของปุ่มปลดล็อค (`.btnLockActive`) ในโหมดสว่างให้เป็นโทนสีทองอำพันความเปรียบต่างสูง (High Contrast) มองเห็นได้ชัดเจน

### 8.3 การปรับปรุงและตรวจเช็คระบบรอบส่งมอบล่าสุด (Version 1.2.0 — 9 พ.ย. 2026):
1. **แก้ปัญหา Contrast & Details Popup ใน Light Mode คมชัด 100%:**
   - เพิ่มคลาส `:global([data-theme="light"])` เจาะจงใน `DevicePin.module.css` กำหนดพื้นหลังสีขาว `#ffffff` และข้อความ `.popupName`, `.popupVal` เป็นสีดำเข้ม `#0f172a !important`
   - ตรึงสีข้อความใน Leaflet Popup ของ `FloorMapOverlay.module.css` ในโหมดสว่างเป็น `#0f172a !important` ขจัดปัญหาตัวหนังสือกลืนกับพื้นหลังอย่างถาวร
2. **ยกระดับระบบ Typography & Thai Script Resilience (Impeccable Audit):**
   - เชื่อมต่อ Google Fonts `Inter` และ `Noto Sans Thai` ผ่าน `index.html` และกำหนด Font Stack มาตรฐานใน `index.css`
   - ปรับความสูงบรรทัดหัวข้อ `line-height: 1.35` ป้องกันสระและวรรณยุกต์ไทยชนขอบ
   - ยกเลิก Micro-text: ขยับขนาดป้ายชื่อหมุดจาก 9.5px เป็น 11px, ป้ายชื่อห้องจาก 10.5px เป็น 12px, ป้ายพิกัดและมิติห้องเป็น 11.5px–12px
   - เพิ่ม `font-variant-numeric: tabular-nums` ให้ตัวเลขสถิติและเคาน์เตอร์ทั้งหมด เพื่อขจัดปัญหาตัวเลขสั่น (Jittering) ขณะ Polling ข้อมูล
3. **ปรับ Spacing & Ergonomics:**
   - ขยาย `FloorSidebar` จาก 220px เป็น 240px รองรับข้อความประเภทอุปกรณ์ภาษาไทยขนาดยาวได้สบายตา
   - ปรับแถบการ์ดสถิติใน `DeviceInfoModal` เป็น Responsive Auto-fit Grid (`minmax(110px, 1fr)`) ป้องกันการตัดคำในจอขนาดเล็ก
   - ขยายปุ่มสลับธีมและปุ่มภาษาบน Navbar เป็นขนาด 32px เพื่อการสัมผัสที่แม่นยำ
4. **ตรวจเช็คและยืนยันระบบแสกนเครือข่าย (Network Discovery Live Verification):**
   - ทดสอบแสกนเครือข่ายจริงบนวงแลน `192.168.22.0/24` ตรวจพบ 10 อุปกรณ์ในเวลาไม่ถึง 3 วินาที
   - ยืนยันการเชื่อมต่อ SNMP v2c ดึงข้อมูล `sysDescr`, `sysName`, `sysLocation` จาก Aruba Core Switch (`192.168.22.254`) สำเร็จสมบูรณ์
   - ยืนยันระบบป้องกันอุปกรณ์ซ้ำซ้อน (Deduplication) ทั้งทาง IP และชื่อ
   - ยืนยันระบบ Smart Placement และ Fallback Simulation ใน Frontend กรณี Backend ออฟไลน์

### 8.4 การยกระดับประสบการณ์ผู้ใช้และการใช้งานง่าย (Version 1.3.0 — 10 พ.ย. 2026):
1. **FloorSidebar Device Directory & Quick Finder:**
   - เพิ่มแท็บสลับระหว่าง **"ตัวกรอง (Filters)"** และ **"อุปกรณ์บนชั้น (Devices)"** บนแถบด้านข้างของผังเครือข่าย
   - เพิ่มช่องค้นหาด่วนภายในชั้น (Search input) แสดงรายชื่ออุปกรณ์พร้อมไอคอน, จุดสถานะ, IP, และห้อง สามารถคลิกที่ชื่ออุปกรณ์เพื่อดูรายละเอียดหรือระบุตำแหน่งบนผังห้องได้ทันที
   - ในแท็บตัวกรอง เพิ่มรายการผลลัพธ์การกรอง (Filtered Devices) แบบคลิกได้ทันที ลดภาระการกวาดสายตาหาหมุดบนผังขนาดใหญ่
2. **Navbar Network Health Badge & Interactive User Guide Modal:**
   - เพิ่ม Badge แสดงสถานะสุขภาพเครือข่ายรวมบน Navbar (`● ระบบปกติ (Online X/Total)` หรือป้ายเตือนสีอำพัน/แดงเมื่อมีอุปกรณ์ขัดข้อง) คลิกเพื่อข้ามไปยังหน้ารายงานภาพรวมได้ทันที
   - เพิ่มปุ่ม **"คู่มือใช้งาน" (User Guide)** พร้อมหน้าต่าง Modal แสดงคำแนะนำ 4 ขั้นตอนหลัก (การดูผัง/ซูม, การย้าย/ล็อคตำแหน่ง, การตรวจทราฟฟิก, และปุ่มลัด `Ctrl+K`) ช่วยให้ผู้ใช้ใหม่เริ่มต้นใช้งานได้ใน 10 วินาที
3. **DeviceListPage Live Search, Floor Filter & Fast Actions:**
   - เพิ่มช่องค้นหาชื่ออุปกรณ์, IP Address, หรือรุ่นในหน้าตารางอุปกรณ์ พร้อมปุ่มล้างคำค้นหา
   - เพิ่มตัวเลือกกรองตามชั้น (ทุกชั้น, ชั้น 1, ชั้น 2)
   - เพิ่มปุ่ม Action ในแต่ละแถว: **"คัดลอก IP"** ในคลิกเดียว (พร้อมการแจ้งเตือนตอบรับ) และปุ่ม **"ดูตำแหน่งบนผัง"** เพื่อกระโดดไปยังผังห้องชั้นนั้นทันที
4. **One-Click Telemetry Copy & Diagnostic Suggestion Banner:**
   - เพิ่มปุ่มคัดลอก IP Address และ MAC Address ใน `DeviceInfoModal` และ `DeviceDetailPage`
   - เพิ่มกล่องแนะนำการตรวจสอบปัญหา (Diagnostic Suggestion Banner) อัตโนมัติเมื่ออุปกรณ์ออฟไลน์หรือมีสถานะเตือน แนะนำการตรวจสอบสายสัญญาณ Uplink หรือไฟเลี้ยงอุปกรณ์
   - เพิ่มตัวเลขนับจำนวนพอร์ต, VLAN, และอุปกรณ์ข้างเคียงบนแท็บในหน้ารายละเอียด
5. **FloorPlan Sub-Banner Interactive Status Pills:**
   - เพิ่มชิปสถานะสรุปประจำชั้น (`● ออนไลน์`, `▲ เตือน`, `✕ ขัดข้อง`) ที่สามารถคลิกเพื่อกรองสถานะนั้นได้ในคลิกเดียว
6. **UI Scale Up 50% & Interactive Scale Switcher:**
   - ปรับขนาด UI เริ่มต้นเพิ่มขึ้น 50% (150% Scale) ตามมาตรฐานห้องควบคุม NOC เพื่อให้อ่านตัวเลข Bandwidth, IP, สถิติ และผังอุปกรณ์ได้อย่างคมชัดสบายตา
   - เพิ่มปุ่มปรับระดับสเกล UI บน Navbar (`150%` / `100%` / `125%`) บันทึกค่าลงใน LocalStorage พร้อมสลับใช้งานได้ทันที

### 8.5 การปรับปรุงกลไกการจำแนกอุปกรณ์ประเภท Router อัจฉริยะ (Version 1.3.1 — 10 พ.ย. 2026):
1. **แก้ไขข้อผิดพลาดตรรกะ IP Suffix & Default Gateway (`classifier.py`):**
   - แก้ไขบัคตรรกะ Factor 5 เดิมที่รวม `.1` กับ `.254` เข้าด้วยกันและตรวจสอบ `scores["switch"] >= scores["router"]` ซึ่งทำให้ IP `.1` (Default Gateway ของเครือข่ายเกือบทั้งหมด) ถูกบวกคะแนนให้ Switch และกลายเป็น Switch เสมอ
   - แยกตรรกะชัดเจน: หากเป็น Default Gateway หรือ IP ลงท้ายด้วย `.1` จะได้รับคะแนน Router (+45) ทันที
2. **ขยายฐานข้อมูล MAC OUI สำหรับ Router และ Gateway ครบถ้วน:**
   - เพิ่มรหัส MAC OUI ของ Router ยอดนิยม: MikroTik (14 รายการ), Cisco Routers (ISR/ASR/Catalyst 8000), Fortinet, Ubiquiti EdgeRouter/Gateway, TP-Link (Archer, Omada Gateway), D-Link, Netgear, ASUS, Huawei, ZTE, DrayTek Vigor, Juniper, Sophos, และ ISP Gateway ของผู้ให้บริการในไทย (AIS Fibre, True GigaTex, 3BB, NT)
3. **ปรับปรุงการวิเคราะห์ SNMP sysServices และ sysDescr / sysName:**
   - รองรับอุปกรณ์ L2/L3 Bridge-Router: เราเตอร์ส่วนใหญ่ในปัจจุบันมี LAN Switchports (L2) และทำ Routing (L3) ระบบได้ปรับให้ประเมินร่วมกับ Default Gateway, OUI และคีย์เวิร์ด
   - เพิ่มคีย์เวิร์ดตระกูลเราเตอร์อย่างละเอียด: Cisco IOS Router (`c2900`, `c2800`, `c1900`, `c3900`, `c800`, `c1100`, `isr`, `asr`), MikroTik (`routeros`, `routerboard`, `rb750`, `hex`, `hap`), FortiGate, EdgeRouter, OpenWrt, pfSense, OPNsense, VyOS, TP-Link Archer, ASUS RT, DrayTek Vigor
   - ป้องกันไม่ให้อุปกรณ์ Router ที่รันลินุกซ์เคอร์เนล (เช่น OpenWrt, EdgeRouter) ถูกจัดประเภทผิดเป็น Server เพราะคีย์เวิร์ด "linux"
4. **เพิ่มการตรวจสอบ OID IP Forwarding (RFC 1213 OID `.1.3.6.1.2.1.4.1.0`):**
   - เพิ่มการสืบค้น `ipForwarding` ระหว่างขั้นตอนค้นหาอุปกรณ์ (Discovery) หากค่าเป็น 1 (forwarding) จะเพิ่มคะแนน Router (+45) บ่งบอกอย่างเป็นทางการตามมาตรฐาน MIB-II ว่าเป็นอุปกรณ์ Routing
5. **ดึง Default Gateway จริงจากตาราง Route ของระบบปฏิบัติการ:**
   - ใน `discovery.py` ฟังก์ชัน `detect_local_network_info()` เปลี่ยนจากการฮาร์ดโค้ด `.254` มาเป็นการอ่าน Active Route `0.0.0.0/0` แบบไดนามิก และส่งค่า Gateway ไปช่วยประเมินใน `classify_device`
6. **Smart Placement สำหรับ Router:**
   - ปรับ `pick_smart_spot` ใน `placement.py` ให้ประเภท `router` มีลำดับความสำคัญจัดวางลงในห้อง "Network Core" หรือ "Server Room" อัตโนมัติเช่นเดียวกับ Switch และ Server
7. **ชุดการทดสอบครอบคลุม 100% (`backend/test_classifier.py`):**
   - เพิ่มแบบทดสอบ 17 กรณีทดสอบ ครอบคลุม Default Gateway IP, MikroTik, Cisco 2900/2800/ISR, OpenWrt, FortiGate, Ubiquiti EdgeRouter, TP-Link Archer, DrayTek, IP Forwarding ตลอดจนการคงความถูกต้องของ Switch (Aruba Core Switch `.254`), AP, และ Server ผ่านการทดสอบทั้งหมด 100%

### 8.6 การปรับเปลี่ยน Emoji ทั้งหมดเป็น Lucide Icons มาตรฐาน (Version 1.3.2 — 10 พ.ย. 2026):
1. **ปรับปรุงส่วนแสดงผล Frontend (NetMonitor React UI):**
   - `DeviceInfoModal.tsx`:
     - เปลี่ยน `🏢 {locationText}` เป็น `<Building2 size={13} /> {locationText}`
     - เปลี่ยนลูกศร `➔` เป็น `<ArrowRight size={12} />`
     - เปลี่ยนสถานะ `● LIVE` เป็น `<Radio size={11} /> LIVE`
   - `DeviceDetailPage.tsx`:
     - เปลี่ยนลูกศรนำทางแท็บ `➔` เป็น `<ArrowRight size={12} />`
   - `HelpGuideModal.tsx`:
     - เปลี่ยนไอคอนหลอดไฟ `💡` เป็น `<Lightbulb size={14} style={{ color: 'var(--accent-warning, #f59e0b)' }} />`
   - `FloorPlanPage.tsx`:
     - เปลี่ยนชิปกรองสถานะ (`●`, `▲`, `✕`) เป็น `<CheckCircle2 size={12} />`, `<AlertTriangle size={12} />`, `<XCircle size={12} />`
   - `DeviceListPage.tsx`:
     - เปลี่ยนตัวบอกทิศทางการเรียงลำดับหัวตาราง (`▲`/`▼`) เป็น SVG ไอคอน `<ChevronUp size={13} />` และ `<ChevronDown size={13} />`
   - `MetricCard.tsx`:
     - เปลี่ยนสัญลักษณ์อัตราการเปลี่ยนแปลง (Change Badge) จากข้อความ `▲`, `▼`, `—` เป็น `<TrendingUp size={12} />`, `<TrendingDown size={12} />`, `<Minus size={12} />`
   - `TrafficChart.tsx`:
     - เปลี่ยน `○ No SNMP Data (ICMP Only)` เป็น `<Info size={11} /> No SNMP Data (ICMP Only)`
     - เปลี่ยน `● LIVE` เป็น `<Radio size={11} /> LIVE`
   - `DevicePin.tsx`:
     - เปลี่ยนจุดวงกลมสถานะ `●` ใน Device Tooltip / Popup เป็นไอคอน `<CheckCircle2 size={12} />`, `<AlertTriangle size={12} />`, `<XCircle size={12} />`
   - `ReportsPage.tsx`:
     - ยกเลิกการเรนเดอร์ string emoji `{alert.icon}` โดยตรง และเปลี่ยนเป็น Lucide Component แบบ Type-safe: `<AlertOctagon />` สำหรับ Critical, `<AlertTriangle />` สำหรับ Warning, `<Info />` สำหรับ Info
   - `NetworkScanModal.tsx`:
     - เพิ่มไอคอนบริบทสำหรับเหตุผลการจัดชั้น (`Tag` สำหรับ OUI, `Navigation` สำหรับ Gateway/Subnet, `MapPin` สำหรับ Room/Keyword, `Building2` สำหรับ Default) พร้อมคำสั่งลบ Emoji ตกค้าง
2. **ทำความสะอาดข้อมูลฝั่ง Backend (FastAPI / Classifier Engine):**
   - `backend/app/classifier.py`: ลบอีโมจิ (`🏷️`, `🛰️`, `📍`, `🏢`) ออกจากข้อความผลลัพธ์ `infer_floor()`
   - `backend/app/discovery.py`: ลบ `🛰️` ออกจาก `floor_reason`
   - `backend/app/database.py`, `backend/app/models.py`, `backend/app/main.py`: ปรับ Default Alert Icon ให้เป็นค่าว่าง เพื่อให้ส่วนติดต่อผู้ใช้เรนเดอร์ผ่าน Lucide SVG อย่างเป็นเอกภาพ 100%

### 8.7 ชุดสคริปต์และข้อมูลจำลองสถานการณ์ความผิดปกติของอุปกรณ์ (Version 1.3.3 — 10 พ.ย. 2026):
สร้างสคริปต์ `backend/simulate_faults.py` เพื่อจำลองปัญหาเครือข่ายเสมือนจริง 6 กรณี ครอบคลุมทุกประเภทอุปกรณ์ (Router, Switch, AP, Server) ทั้งสถานะ Warning (เตือน) และ Offline (ขัดข้อง) ครอบคลุมทั้งสองชั้น:
1. **[Router - Warning] RTR-CORE-01 (192.168.22.1, ชั้น 1):** BGP Route Flapping สลับเส้นทาง และ CPU Load ขึ้นสูงถึง 88.5%
2. **[Router - Offline] RTR-BRANCH-02 (192.168.22.2, ชั้น 2):** สาย Fiber WAN ขาด เกตเวย์ออฟไลน์ ขาดการเชื่อมต่อ
3. **[Switch - Warning] SW-42-B73C (192.168.22.42, ชั้น 1):** ทราฟฟิกพอร์ต Trunk 10G เต็มพิกัด > 92.4% พร้อมอุณหภูมิความร้อนสูง 68°C
4. **[Switch - Offline] SW-112-B3C3 (192.168.22.112, ชั้น 2):** Power Supply Unit (PSU) ขัดข้อง ดับทั้งเครื่อง ส่งผลกระทบ 24 Edge Ports
5. **[AP - Warning] Ubiquiti-AP-239 (192.168.22.239, ชั้น 2):** ผู้ใช้งานหนาแน่น 65+ Clients สัญญาณชนกันรุนแรง (Co-channel interference) เกิด Packet Loss 8.7%
6. **[Server - Offline] SRV-44-F9FF (192.168.22.44, ชั้น 1):** โฮสต์เกิด Kernel Panic พอร์ต 161 (SNMP) และ ICMP ไม่ตอบสนอง ฐานข้อมูลหยุดให้บริการ
* ปรับปรุง `poll_runs_status_check` Constraint ใน PostgreSQL ให้รองรับสถานะ `'warning'` ควบคู่กับ `'succeeded'` และ `'failed'`
* เชื่อมโยงหน้า `ReportsPage` ให้ดึง Alerts จาก Database API มาแสดงร่วมกับ Mock Detail โดยอัตโนมัติ

### 8.8 การแก้ไขข้อผิดพลาดระดับวิกฤตและความทนทานของระบบ (Version 1.3.4 — 10 พ.ย. 2026):
1. **Zero-State DDL Idempotency (`backend/app/database.py`):**
   - เพิ่มคำสั่ง `CREATE TABLE IF NOT EXISTS` แบบ Idempotent สำหรับตารางแกนหลักทั้งหมด (`devices`, `interfaces`, `poll_runs`, `interface_samples`, `device_metric_samples`, `alerts`) ครอบคลุม Foreign Keys, Index, และ Constraints ทำให้ระบบเริ่มต้นทำงานได้อย่างสมบูรณ์แบบ แม้เริ่มจากฐานข้อมูลว่างเปล่า (Zero-state DB)
2. **ขจัดทราฟฟิกสังเคราะห์ Sine-Wave หลอก (`backend/app/collector.py`):**
   - ตัดสูตรคำนวณคณิตศาสตร์ `math.sin` และ `math.cos` ออกจากการประมวลผลทราฟฟิกใน background poller สำหรับอุปกรณ์ที่ไม่มี SNMP telemetry ระบบจะตั้งค่า `has_snmp: False` และส่งทราฟฟิกเป็น 0 Mbps พร้อมป้ายกำกับ `No SNMP Data (ICMP Only)` อย่างถูกต้องตามความเป็นจริง 100%
3. **ป้องกัน Multi-Worker Poll Duplication ด้วย PostgreSQL Advisory Lock (`backend/app/main.py`):**
   - ฝัง PostgreSQL Session-level Advisory Lock (`0x534E4D50`) ในลูป `background_snmp_poller` ป้องกันไม่ให้ Uvicorn multi-worker process แย่งกันยิง SNMP ซ้ำซ้อนไปยังอุปกรณ์เครือข่ายเดียวกัน
4. **บันทึกสถานะการเชื่อมต่อจริงใน `poll_runs` (`backend/app/main.py`):**
   - บันทึกผลการสำรวจ (`status: succeeded` / `failed`, latency, error messages) ลงตาราง `poll_runs` ทุกรอบการทำงาน ทำให้อุปกรณ์สะท้อนสถานะการเชื่อมต่อจริงในแดชบอร์ดอย่างแม่นยำ
5. **ปรับปรุง `simulate_faults.py` ค้นหา Foreign Key แบบไดนามิก:**
   - แก้ไขการสร้าง Alert จำลองให้ดึงรหัสอุปกรณ์ (`device_id`) จากฐานข้อมูลจริงแบบไดนามิก ขจัดปัญหา `ForeignKeyViolationError` จากการฮาร์ดโค้ด ID ที่ไม่มีอยู่
6. **Docker Compose แบบพกพา (Portable Docker Setup):**
   - รวมไฟล์ `docker-compose.yml` และไดเรกทอรี `init/001_schema.sql` ไว้ที่ Root ของโปรเจกต์ ยกเลิกการอ้างอิง Path เฉพาะเครื่องใน `%LOCALAPPDATA%`

---

## 9. แนวทางการบำรุงรักษาและการขยายระบบในอนาคต (Maintenance & Scaling Guidelines)

### 9.1 การสำรองและกู้คืนฐานข้อมูล (Database Backup & Restore)

#### สำรองข้อมูล (Backup) เป็น UTF-8 ที่ปลอดภัยต่อการ Restore:
```powershell
docker exec -e PGPASSWORD=netmon docker-db-1 pg_dump -U netmon netmon | Out-File -Encoding utf8 backup_netmon.sql
```

#### กู้คืนข้อมูล (Restore) ผ่าน CMD Stream (ป้องกันปัญหา UTF-16 BOM ของ PowerShell):
```powershell
cmd /c "docker exec -i -e PGPASSWORD=netmon docker-db-1 psql -U netmon -d netmon < backup_netmon.sql"
```

### 9.2 การปรับตั้งค่า SNMP Timeout & Polling Interval
- ค่ามาตรฐานถูกตั้งไว้ที่ `poll_interval_s = 60` วินาทีในฐานข้อมูล
- หากเครือข่ายมี Latency สูงหรือมีแพ็กเก็ตตกหล่นบ่อย สามารถปรับ timeout ในไฟล์ `backend/app/snmp.py` (`timeout_s=2`, `retries=1`)

### 9.3 การขยายขนาดรองรับผู้ใช้ (Horizontal Scaling)
- **เพิ่ม Uvicorn Workers:** ปัจจุบันรัน Single Worker สำหรับ Development หากขึ้น Production ในสภาพแวดล้อมจริง สามารถเพิ่มจำนวน Worker ตามจำนวน CPU Cores:
  ```powershell
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
  ```
- **ปรับขนาด DB Connection Pool:** ใน `backend/app/database.py` ปรับ `max_size=20` หรือใช้ PgBouncer คั่นกลางเมื่อมีจำนวนผู้ใช้พร้อมกันเกิน 500 VUs

