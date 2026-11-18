# เอกสารส่งต่องานระบบ NetMonitor (Project Handover Documentation)

**ข้อมูลทั่วไปของโครงการ (Project Information)**

- **ชื่อระบบ:** NetMonitor — Web-based Network Topology & SNMP Monitoring System
- **เวอร์ชัน:** 1.3.5 (ปรับปรุงล่าสุด: 17 พฤศจิกายน 2026)
- **ที่เก็บโค้ด (Repository):** [NetMonitor](https://github.com/Suphawit2004/NetMonitor)
- **เทคโนโลยีหลัก:** React 19, TypeScript, Vite, FastAPI, asyncpg, PostgreSQL 17, Net-SNMP CLI
- **สถานะการตรวจสอบล่าสุดในระบบ:**
  - Backend Pytest (`test_classifier.py` + `tests/`): `41 passed` (`9.88s`, รวม `test_real_port_traffic.py` กับ Switch `192.168.22.254` ซึ่งจะเรียก `pytest.skip()` หาก Switch ไม่ตอบสนอง)
  - Frontend ESLint (`npm run lint`): `0 errors` (`4 warnings` จาก React Hook dependencies เดิม)
  - Frontend Build (`npm run build`): ผ่าน (`tsc -b && vite build`, `1.08s`)
  - Playwright E2E (`npm run test:e2e`): `18 passed` (`38.6s` ครอบคลุม `netmonitor.spec.ts` 10 กรณี และ `fault-simulation.spec.ts` 8 กรณี)

---

## สารบัญ (Table of Contents)

- [1. บทสรุปและภาพรวมของระบบ (Executive Summary & System Overview)](#1-บทสรุปและภาพรวมของระบบ-executive-summary--system-overview)
  - [1.1 ปัญหาที่ระบบแก้ไข (Problem Statement)](#11-ปัญหาที่ระบบแก้ไข-problem-statement)
  - [1.2 เป้าหมายและขอบเขตที่ไม่ครอบคลุม (Goals & Non-Goals)](#12-เป้าหมายและขอบเขตที่ไม่ครอบคลุม-goals--non-goals)
- [2. สถาปัตยกรรมและทางเลือกการออกแบบ (Architecture & Design Trade-offs)](#2-สถาปัตยกรรมและทางเลือกการออกแบบ-architecture--design-trade-offs)
  - [2.1 แผนภาพและขอบเขตการทำงานของระบบ (System Architecture & Boundaries)](#21-แผนภาพและขอบเขตการทำงานของระบบ-system-architecture--boundaries)
  - [2.2 ตารางสรุปเทคโนโลยีที่เลือกใช้ (Technology Stack)](#22-ตารางสรุปเทคโนโลยีที่เลือกใช้-technology-stack)
  - [2.3 ทางเลือกสถาปัตยกรรมที่ถูกพิจารณา (Alternatives Considered)](#23-ทางเลือกสถาปัตยกรรมที่ถูกพิจารณา-alternatives-considered)
  - [2.4 ความเสี่ยง ขีดจำกัด และแนวทางความปลอดภัย (Risks, Limits & Security Mitigations)](#24-ความเสี่ยง-ขีดจำกัด-และแนวทางความปลอดภัย-risks-limits--security-mitigations)
- [3. โครงสร้างโปรเจกต์ (Project Directory Structure)](#3-โครงสร้างโปรเจกต์-project-directory-structure)
- [4. ฟังก์ชันหลักและความสามารถของระบบ (Core Features & Capabilities)](#4-ฟังก์ชันหลักและความสามารถของระบบ-core-features--capabilities)
  - [4.1 ระบบผังห้องและการซิงค์แผนที่ดาวเทียม (Floor Plan, Room Layouts & Map Synchronization)](#41-ระบบผังห้องและการซิงค์แผนที่ดาวเทียม-floor-plan-room-layouts--map-synchronization)
  - [4.2 ระบบสแกน ค้นพบ และจำแนกอุปกรณ์ (Network Discovery & Classification)](#42-ระบบสแกน-ค้นพบ-และจำแนกอุปกรณ์-network-discovery--classification)
  - [4.3 ระบบเก็บทราฟฟิกและสถานะอุปกรณ์ (SNMP Telemetry & Alert-Aware Device Status)](#43-ระบบเก็บทราฟฟิกและสถานะอุปกรณ์-snmp-telemetry--alert-aware-device-status)
  - [4.4 ระบบโทโพโลยีและการจำลองผลกระทบลูกโซ่ (Topology Inference & Blast-Radius Simulation)](#44-ระบบโทโพโลยีและการจำลองผลกระทบลูกโซ่-topology-inference--blast-radius-simulation)
  - [4.5 การค้นหา ธีม และการรองรับสองภาษา (Search, Theme & Localization)](#45-การค้นหา-ธีม-และการรองรับสองภาษา-search-theme--localization)
- [5. ผลการทดสอบสมรรถนะและข้อสังเกต (Performance Benchmarks & Test Scope)](#5-ผลการทดสอบสมรรถนะและข้อสังเกต-performance-benchmarks--test-scope)
  - [5.1 การทดสอบโหลดด้วย Grafana k6 (Load & Stress Benchmarks)](#51-การทดสอบโหลดด้วย-grafana-k6-load--stress-benchmarks)
  - [5.2 การตรวจสอบคุณภาพหน้าเว็บด้วย Google Lighthouse (Lighthouse Web Quality Audit)](#52-การตรวจสอบคุณภาพหน้าเว็บด้วย-google-lighthouse-lighthouse-web-quality-audit)
- [6. คู่มือการติดตั้งและตั้งค่า (Installation & Configuration Guide)](#6-คู่มือการติดตั้งและตั้งค่า-installation--configuration-guide)
  - [6.1 ความต้องการขั้นต่ำของระบบ (System Requirements)](#61-ความต้องการขั้นต่ำของระบบ-system-requirements)
  - [6.2 การเปิดระบบและการรันบน Production (One-Click Dev & Production Hosting)](#62-การเปิดระบบและการรันบน-production-one-click-dev--production-hosting)
  - [6.3 การตั้งค่าสภาพแวดล้อมและเปิดระบบแบบแยกส่วน (Environment Config & Manual Execution)](#63-การตั้งค่าสภาพแวดล้อมและเปิดระบบแบบแยกส่วน-environment-config--manual-execution)
- [7. ชุดคำสั่งทดสอบระบบ (Automated Test Suites)](#7-ชุดคำสั่งทดสอบระบบ-automated-test-suites)
  - [7.1 ทดสอบ Backend (Python & Pytest)](#71-ทดสอบ-backend-python--pytest)
  - [7.2 ทดสอบ Frontend (ESLint, TypeScript & Vite)](#72-ทดสอบ-frontend-eslint-typescript--vite)
  - [7.3 ทดสอบ End-to-End ด้วย Playwright (Playwright E2E Suite)](#73-ทดสอบ-end-to-end-ด้วย-playwright-playwright-e2e-suite)
  - [7.4 ทดสอบโหลดด้วย Grafana k6 (Load & Stress Tests)](#74-ทดสอบโหลดด้วย-grafana-k6-load--stress-tests)
- [8. สรุปพัฒนาการระบบตามเวอร์ชัน (Release History Summary)](#8-สรุปพัฒนาการระบบตามเวอร์ชัน-release-history-summary)
- [9. แนวทางการบำรุงรักษาและขีดจำกัดการขยายระบบ (Maintenance & Operational Guidelines)](#9-แนวทางการบำรุงรักษาและขีดจำกัดการขยายระบบ-maintenance--operational-guidelines)
  - [9.1 การสำรองและกู้คืนฐานข้อมูล (Database Backup & Restore)](#91-การสำรองและกู้คืนฐานข้อมูล-database-backup--restore)
  - [9.2 การปรับตั้งค่า SNMP Polling และ Retention (SNMP Polling & Retention Tuning)](#92-การปรับตั้งค่า-snmp-polling-และ-retention-snmp-polling--retention-tuning)
  - [9.3 แนวทางการรัน Single-Worker สำหรับระบบภายใน (Single-Worker Deployment Profile)](#93-แนวทางการรัน-single-worker-สำหรับระบบภายใน-single-worker-deployment-profile)

---

## 1. บทสรุปและภาพรวมของระบบ (Executive Summary & System Overview)

### 1.1 ปัญหาที่ระบบแก้ไข (Problem Statement)

การเฝ้าระวังเครือข่ายภายในอาคารด้วยตารางรายการ IP หรือคำสั่ง CLI ทำให้ผู้ดูแลระบบต้องเชื่อมโยงข้อมูลหลายส่วนด้วยตนเองเมื่อเกิดเหตุขัดข้อง ได้แก่ ตำแหน่งทางกายภาพของอุปกรณ์บนผังอาคาร พิกัดบนแผนที่ ปริมาณทราฟฟิกย้อนหลัง และผลกระทบลูกโซ่ต่ออุปกรณ์ปลายทางหรือบริการที่พึ่งพากัน

NetMonitor ถูกพัฒนาขึ้นเพื่อรวมงานเหล่านี้ไว้ในหน้าจอเดียวสำหรับทีมปฏิบัติการเครือข่าย (NOC) โดยแปลงข้อมูลอุปกรณ์และ SNMP Telemetry ให้แสดงผลบนผังอาคาร 2 มิติและแผนที่ดาวเทียม เชื่อมโยงสายสัญญาณระหว่างอุปกรณ์ และจำลองขอบเขตผลกระทบเมื่ออุปกรณ์หรือสายเชื่อมขัดข้อง

### 1.2 เป้าหมายและขอบเขตที่ไม่ครอบคลุม (Goals & Non-Goals)

- **เป้าหมายหลัก (Goals):**
  - แสดงผลตำแหน่งอุปกรณ์บนผังอาคาร 2 มิติและแผนที่ดาวเทียม (WGS84 GPS) ที่ซิงค์ผังห้องจากฐานข้อมูลร่วมกัน
  - ค้นพบและจำแนกประเภทอุปกรณ์ในเครือข่ายผ่าน ARP, ICMP Ping, Reverse DNS, MAC OUI และ SNMP (`v1`/`v2c`)
  - เก็บสถิติทราฟฟิกรายพอร์ตและทราฟฟิกรวมของอุปกรณ์ (`ifHCInOctets`/`ifHCOutOctets`), ข้อมูลสุขภาพ (CPU, Memory, อุณหภูมิ, Ping RTT, `sys_uptime`) และคำนวณสถานะอุปกรณ์ที่เชื่อมโยงกับการแจ้งเตือน
  - เชื่อมโยงโทโพโลยีและวิเคราะห์ผลกระทบลูกโซ่ (Blast-Radius), คะแนน Single Point of Failure (SPOF), ห้อง/โซน และแท็กบริการที่ได้รับผลกระทบ
- **ขอบเขตที่ไม่ครอบคลุม (Non-Goals):**
  - ไม่ใช่ระบบแก้ไข Configuration บนอุปกรณ์เครือข่ายโดยตรง (Read-Only Monitoring; ไม่ส่ง SNMP `SET` หรือเข้า SSH/Telnet)
  - ไม่ได้ออกแบบสำหรับความสามารถ Multi-tenancy หรือระบบสิทธิ์ผู้ใช้แบบ RBAC / OIDC (เหมาะสำหรับทีม NOC ภายในที่ควบคุมการเข้าถึงในระดับเครือข่ายและ `X-API-Key`)
  - ไม่รองรับระบบ Telemetry ระดับแสน Node แบบ Distributed Agent (มุ่งเป้าเครือข่ายระดับ 100–500 อุปกรณ์ภายในองค์กรหรือแคมปัส)

---

## 2. สถาปัตยกรรมและทางเลือกการออกแบบ (Architecture & Design Trade-offs)

### 2.1 แผนภาพและขอบเขตการทำงานของระบบ (System Architecture & Boundaries)

```text
+-------------------------------------------------------------------------------+
|                       Frontend Layer (React 19 + TypeScript)                  |
|  - Pages: FloorPlanPage, DeviceListPage, DeviceDetailPage, ReportsPage        |
|  - Visualization: FloorCanvas (2D), FloorMapOverlay (Leaflet), TrafficChart   |
|  - Topology & Sim UI: TopologyLinksLayer, ImpactDrawer, ServiceTagsEditor     |
|  - State Contexts: NetworkProvider (15s HTTP Poll), FaultSimProvider,         |
|                    SettingsProvider, SimulationProvider                       |
+---------------------------------------+---------------------------------------+
                                        |
              [HTTP REST Proxy: /api/v1/* + X-API-Key Header]
              [Offline Fallback ONLY on unreachable transport: localStorage +   |
               client topologyEngine / detailFactory]
                                        |
+---------------------------------------v---------------------------------------+
|                       Backend Layer (FastAPI + Uvicorn)                       |
|  - Controllers (`app/main.py`): REST Routes, `require_api_key`, `ALLOWED_ORIGINS` |
|  - Validation (`app/models.py`): `ipaddress` IP/CIDR & SNMP community checks  |
|  - Data Access (`app/repository.py`): SQL, transactions, `compute_device_status`, |
|                 `floor_layouts`, `is_simulated` isolation, `purge_expired_telemetry` |
|  - Topology Engine (`app/topology.py`): `infer_topology_links`, `compute_blast_radius` |
|  - Discovery & Placement (`app/discovery.py`, `classifier.py`, `placement.py`)|
|  - Collector & Poller (`app/collector.py`, `app/snmp.py`): Concurrent OIDs,   |
|    batched DB inserts, rate summation, `ADVISORY_LOCK_SNMP_POLLER` (30s cycle)|
+---------------------------------------+---------------------------------------+
                                        |
                    [asyncpg Connection Pool (min 2, max 10)]
                                        |
+---------------------------------------v---------------------------------------+
|                       Database Layer (PostgreSQL 17 Alpine)                   |
|  - Docker Container: `docker-db-1` (Port 5432, DB: `netmon`)                  |
|  - Tables: devices, interfaces, poll_runs, interface_samples,                 |
|            device_metric_samples, alerts, topology_links, floor_layouts       |
+-------------------------------------------------------------------------------+
```

### 2.2 ตารางสรุปเทคโนโลยีที่เลือกใช้ (Technology Stack)

| ส่วนประกอบ (Layer) | เทคโนโลยีที่เลือกใช้ | หน้าที่และเหตุผลเชิงเทคนิค |
|---|---|---|
| **Frontend UI** | **React 19 + TypeScript + Vite** | แยกส่วนแสดงผลเป็น Component ชัดเจน ตรวจ Type ล่วงหน้าก่อน Compile และรองรับ HMR ระหว่างพัฒนา |
| **Maps & Icons** | **Leaflet + Lucide React** | แสดงแผนที่ดาวเทียม/Carto ที่รองรับ Offline Tile Cache และการวาด Vector Overlay ด้วย SVG |
| **Localization** | **i18next / react-i18next** | จัดการข้อความ 2 ภาษา (`th` / `en`) จากศูนย์กลางผ่าน [th.ts](./netmonitor/src/i18n/th.ts) และ [en.ts](./netmonitor/src/i18n/en.ts) |
| **Backend API** | **Python FastAPI + Uvicorn** | รองรับ Async I/O สร้าง OpenAPI/Swagger อัตโนมัติ และตรวจสอบ Payload ด้วย Pydantic v2 |
| **Database Driver** | **asyncpg + PostgreSQL 17** | รองรับ `INET`, `JSONB`, Transaction, Batch Insert (`executemany` / `UNNEST`) และ Advisory Lock ในตัว |
| **SNMP / Network** | **Net-SNMP CLI + OS Subprocess** | ใช้งานคำสั่งมาตรฐาน `snmpget`/`snmpwalk` บน `asyncio.to_thread` ร่วมกับการอ่าน ARP/Route ของ OS |

### 2.3 ทางเลือกสถาปัตยกรรมที่ถูกพิจารณา (Alternatives Considered)

1. **การอัปเดตสถานะหน้าเว็บ (HTTP Polling 15s vs WebSockets / SSE):**
   - *แนวทางที่เลือก:* ใช้ HTTP Polling ทุก 15 วินาที (`LIVE_POLL_INTERVAL_MS = 15_000`) ร่วมกับ `deviceSnapshotKey` เพื่อข้ามการ Re-render เมื่อข้อมูลไม่เปลี่ยน
   - *แนวทางที่คัดออก:* WebSockets หรือ SSE + PostgreSQL `LISTEN/NOTIFY` ซึ่งเพิ่มความซับซ้อนในการดูแลการเชื่อมต่อและสถานะ Pub/Sub เกินความจำเป็นสำหรับปริมาณ 100–500 อุปกรณ์
2. **การเก็บผังห้องอาคาร (PostgreSQL `floor_layouts` + Cache vs Browser-Only `localStorage`):**
   - *แนวทางที่เลือก:* เก็บผังห้องรายชั้นไว้ที่ตาราง `floor_layouts` (`GET /api/v1/layout`, `PUT /api/v1/layout/{floor}`) เพื่อให้ Backend (`placement.py`, `topology.py`) และทุกหน้าจอใช้อ้างอิงร่วมกัน โดยมี `localStorage` เป็น Read-through Cache เพื่อการแสดงผลทันที (พร้อมรองรับ `floor_rooms` override ใน request)
   - *แนวทางที่คัดออก:* การเก็บไว้เฉพาะฝั่งเบราว์เซอร์ (`localStorage`) เพียงอย่างเดียว ซึ่งทำให้พิกัดห้องระหว่างการวางอุปกรณ์ฝั่ง Backend ไม่ตรงกับห้องที่ผู้ใช้ปรับแก้ หรือการทำระบบ Versioning พร้อม Conflict Resolution ข้ามผู้ใช้ซึ่งซับซ้อนเกินขนาดงาน
3. **การคำนวณโทโพโลยีและ Blast-Radius (Backend Single Engine vs Dual Client/Server Engine):**
   - *แนวทางที่เลือก:* ให้ Frontend (`FaultSimProvider.tsx`, `DeviceDetailPage.tsx`) เรียก `POST /api/v1/simulate/impact` เพื่อใช้ `backend/app/topology.py` เป็นแหล่งคำนวณหลักเพียงแหล่งเดียว และเก็บ `netmonitor/src/services/topologyEngine.ts` ไว้เฉพาะเป็น Offline Fallback เมื่อ Backend ไม่สามารถติดต่อได้
   - *แนวทางที่คัดออก:* การคำนวณคู่ขนานทั้งในเบราว์เซอร์และบนเซิร์ฟเวอร์ทุกครั้งที่ข้อมูลเปลี่ยนแปลง ซึ่งซ้ำซ้อนและเสี่ยงเกิดผลลัพธ์ไม่ตรงกัน
4. **การสื่อสาร SNMP และสแกนเครือข่าย (Net-SNMP CLI Subprocesses vs Async Python Libraries):**
   - *แนวทางที่เลือก:* เรียก `snmpget`/`snmpwalk` ผ่าน `asyncio.to_thread` พร้อม `sanitize_snmp_community()` และแยกคำสั่งค้นหา OS (`arp`/`netsh`/`route` บน Windows และ `ip neigh`/`ip route` บน Linux)
   - *แนวทางที่คัดออก:* การเขียนหรือเปลี่ยนไปใช้ Native Async SNMP Library (`pysnmp`/`aiosnmp`) ซึ่งต้องรื้อชุดทดสอบ MIB/Counter parsing ที่ผ่านการทดสอบกับอุปกรณ์จริงแล้ว
5. **การควบคุมสิทธิ์การเข้าถึง (`X-API-Key` vs RBAC / OIDC):**
   - *แนวทางที่เลือก:* ใช้ `settings.API_KEY` ตรวจสอบผ่าน Header `X-API-Key` บน Endpoint ที่เปลี่ยนแปลงข้อมูลหรือสั่งสแกนเครือข่าย สอดคล้องกับ Non-Goal ที่เป็นเครื่องมือสำหรับทีม NOC ภายในเดียว
   - *แนวทางที่คัดออก:* ระบบ Authentication เต็มรูปแบบ (RBAC / OIDC / Session Management)
6. **การจัดเก็บ Time-Series (PostgreSQL + Periodic Retention vs TimescaleDB):**
   - *แนวทางที่เลือก:* ใช้ PostgreSQL ปกติร่วมกับ Index และงานล้างข้อมูลเก่าอัตโนมัติ (`purge_expired_telemetry()` ตาม `METRICS_RETENTION_DAYS = 7`)
   - *แนวทางที่คัดออก:* การติดตั้ง Extension เพิ่มเติมอย่าง TimescaleDB เพื่อลดภาระในการดูแล Image และ Schema

### 2.4 ความเสี่ยง ขีดจำกัด และแนวทางความปลอดภัย (Risks, Limits & Security Mitigations)

1. **ความปลอดภัยและการยืนยันตัวตน (Security & Input Hardening):**
   - Endpoint ที่เปลี่ยนแปลงฐานข้อมูล สั่งจำลองสถานะ แก้ไขผังห้อง หรือสแกนเครือข่ายทั้งหมดอยู่ภายใต้ Dependency `require_api_key` (ตรวจ Header `X-API-Key` แบบ Constant-time ผ่าน `hmac.compare_digest` เมื่อตั้งค่า `API_KEY` ใน `backend/.env`)
   - CORS ถูกจำกัดตามรายการ `ALLOWED_ORIGINS` (`settings.allowed_origins_list` ค่าเริ่มต้น `http://localhost:5173,http://127.0.0.1:5173`)
   - IP และ CIDR ของอุปกรณ์ถูกตรวจสอบด้วย `ipaddress` ใน [models.py](./backend/app/models.py) และ SNMP Community String ผ่าน `sanitize_snmp_community()` ใน [snmp.py](./backend/app/snmp.py) เพื่อป้องกันการแทรก CLI options (`-...`) หรือ control characters
   - สถานะอุปกรณ์จำลองถูกแยกไว้ที่คอลัมน์ `devices.is_simulated` เพื่อไม่ให้เขียนทับ Community String จริงใน `credential_ref`; รหัสผ่านฐานข้อมูลต้องกำหนดผ่าน `.env` (ดู [backend/.env.example](./backend/.env.example)) และไม่ใช้รหัสผ่านจริงในไฟล์ตั้งค่าที่ Track ใน Git
2. **คอขวดของ Background SNMP Poller (Concurrency & Subprocess Limits):**
   - Background Poller ทำงานทุก `SNMP_POLL_INTERVAL_S = 30` วินาที จำกัดจำนวนอุปกรณ์พร้อมกันที่ `SNMP_MAX_CONCURRENT_POLLS = 5` โดยใช้ `asyncio.gather` เพื่อดึง OID ที่เป็นอิสระของแต่ละอุปกรณ์พร้อมกันและทำ Batch DB insert
   - หากขยายจำนวนอุปกรณ์ที่มี SNMP จริงเข้าใกล้ 300–500 เครื่องพร้อมพอร์ตจำนวนมาก รอบการ Poll อาจใช้เวลาเกิน 30 วินาที ควรปรับเพิ่มค่า `SNMP_POLL_INTERVAL_S` และ `SNMP_MAX_CONCURRENT_POLLS` ใน `.env` ตามความเหมาะสม
3. **พฤติกรรม Offline Fallback และการแยก HTTP Error:**
   - ใน [api.ts](./netmonitor/src/services/api.ts) การตอบกลับ HTTP `4xx` หรือ `5xx` ที่เป็น JSON จาก Backend จะถูกส่งเป็น `Error` ไปยัง UI โดยตรงโดยไม่ Fallback ไปแก้ไข `localStorage` เพื่อป้องกันสถานะคลาดเคลื่อนกับฐานข้อมูล
   - `localStorage` Fallback และฟังก์ชันสร้างกราฟฝั่ง Client (`traffic.ts`, `random.ts` และ `topologyEngine.ts`) จะทำงานเฉพาะเมื่อ Backend ไม่ตอบสนองระดับ Transport/Proxy เท่านั้น ส่วนฝั่ง Backend ใน `collector.py` ไม่มีการสร้างทราฟฟิกสังเคราะห์ (อุปกรณ์ที่ไม่มี SNMP จะแสดง `No SNMP Data (ICMP Only)`)
4. **การใช้งานข้ามระบบปฏิบัติการ (Windows vs Linux Discovery):**
   - `discovery.py` รองรับทั้ง Windows (`arp -a`, `netsh wlan`, `route print 0.0.0.0`, `ping -n`) และ Linux/POSIX (`ip neigh`, `arp -n`, `ip route show default`, `ping -c`) ทั้งนี้บน Windows การสืบค้น Wi-Fi SSID จะทำงานเพิ่มผ่าน `netsh` ในขณะที่ Linux Container จะข้ามข้อมูล Wi-Fi โดยอัตโนมัติ

---

## 3. โครงสร้างโปรเจกต์ (Project Directory Structure)

รายละเอียดโครงสร้างภายในแต่ละส่วนสามารถดูเพิ่มเติมได้ที่ [README.md](./README.md), [backend/README.md](./backend/README.md) และ [netmonitor/README.md](./netmonitor/README.md)

```text
snmp_font_end/
├── README.md                        # ภาพรวมระบบและคำสั่งเริ่มต้นใช้งาน
├── HANDOVER.md                      # เอกสารส่งต่องานฉบับนี้
├── docker-compose.yml               # PostgreSQL 17 Container (อ่านค่าจาก .env)
├── init/
│   └── 001_schema.sql               # DDL เริ่มต้น (รวม topology_links และ floor_layouts)
├── seed_mock_data.sql               # ข้อมูลอุปกรณ์ตัวอย่างสำหรับ Seed และ Reset
├── load_test.js                     # สคริปต์ k6 Baseline Load Test (15 VUs)
├── stress_limit_test.js             # สคริปต์ k6 Stress Limit Test (ถึง 500 VUs)
├── start_all.bat                    # สคริปต์เปิดระบบบน Windows (DB + Backend + Frontend)
├── start_docker_backend.bat         # สคริปต์เปิด DB + Backend บน Windows
│
├── backend/                         # FastAPI Backend Service (ดู backend/README.md)
│   ├── README.md
│   ├── .env.example                 # ตัวอย่าง Environment Variables (DB, API_KEY, CORS, Retention)
│   ├── requirements.txt
│   ├── run_backend.bat
│   ├── simulate_faults.py           # สคริปต์จำลองสถานะและ Alert 6 กรณี (is_simulated = true)
│   ├── test_classifier.py           # Pytest ชุดทดสอบ Classifier (17 tests)
│   ├── test_api.py                  # สคริปต์ทดสอบ CRUD Endpoints (ส่ง X-API-Key)
│   ├── test_discovery.py            # สคริปต์ทดสอบ Discovery และ Offline Flow
│   ├── test_real_snmp.py            # สคริปต์ทดสอบ SNMP กับ Switch จริงแบบ Standalone
│   ├── test_smart_placement.py      # สคริปต์ทดสอบ Placement บนห้องจำลอง
│   ├── app/
│   │   ├── main.py                  # FastAPI Endpoints, Lifecycle, Auth (`require_api_key`)
│   │   ├── config.py                # ค่าคงที่และ Settings จาก .env
│   │   ├── database.py              # asyncpg Pool & Idempotent DDL (Advisory Lock)
│   │   ├── repository.py            # Data Access Layer, Status Logic, Retention Purge
│   │   ├── models.py                # Pydantic Schemas & IP/CIDR/Community Validators
│   │   ├── snmp.py                  # snmpget Wrapper & Community Sanitization
│   │   ├── collector.py             # Concurrent SNMP Poller & Aggregate Bandwidth
│   │   ├── discovery.py             # Cross-Platform Network Scanner
│   │   ├── classifier.py            # Device Type Classification & Smart Naming
│   │   ├── placement.py             # Smart Placement & Bilinear GPS Mapping
│   │   └── topology.py              # Topology Inference, Blast Radius & SPOF Engine
│   └── tests/
│       ├── test_real_port_traffic.py
│       ├── test_security_and_fixes.py
│       ├── test_snmp_collector.py
│       ├── test_topology_impact.py
│       └── test_traffic_api.py
│
└── netmonitor/                      # React 19 Frontend Client (ดู netmonitor/README.md)
    ├── README.md
    ├── .env.example                 # VITE_API_KEY & VITE_MAP_API_KEY
    ├── package.json
    ├── vite.config.ts               # Proxy /api -> 127.0.0.1:8000
    ├── playwright.config.ts
    ├── e2e/
    │   ├── netmonitor.spec.ts       # Playwright 10 Core Navigation/UI Scenarios
    │   └── fault-simulation.spec.ts # Playwright 8 Topology/Simulation/Sync Scenarios
    └── src/
        ├── components/              # detail/, discovery/, floor/, layout/, simulation/, ui/
        ├── context/                 # NetworkProvider, FaultSimProvider, SettingsProvider, SimulationProvider
        ├── hooks/                   # useDeviceDetail
        ├── i18n/                    # th.ts, en.ts (543 บรรทัด / 510 entries), format.ts
        ├── pages/                   # FloorPlanPage, DeviceListPage, DeviceDetailPage, ReportsPage
        ├── services/                # api.ts, roomStore.ts, mapGeo.ts, detailFactory.ts, topologyEngine.ts
        └── types/
```

---

## 4. ฟังก์ชันหลักและความสามารถของระบบ (Core Features & Capabilities)

### 4.1 ระบบผังห้องและการซิงค์แผนที่ดาวเทียม (Floor Plan, Room Layouts & Map Synchronization)

- รองรับมุมมอง 2 มิติ (`FloorCanvas`) ควบคู่กับแผนที่ดาวเทียม/Carto (`FloorMapOverlay`) บนชั้น 1 และชั้น 2 พร้อมตัวเลือกความทึบและสลับชั้นแผนที่ฐาน
- คำนวณพิกัดระหว่างผังอาคาร `(x, y)` กับพิกัดโลก `(latitude, longitude)` และระดับความสูง (`altitude`) ผ่าน Bilinear Affine Transformation ใน [placement.py](./backend/app/placement.py) และ [mapGeo.ts](./netmonitor/src/services/mapGeo.ts)
- ผังห้องที่ปรับแต่งใน [FloorPlanPage.tsx](./netmonitor/src/pages/FloorPlanPage.tsx) ถูกบันทึกลง PostgreSQL ผ่าน `PUT /api/v1/layout/{floor}` และโหลดกลับมาผ่าน `GET /api/v1/layout` โดยมี `localStorage` (`roomStore.ts`) เป็น Cache ในเบราว์เซอร์

### 4.2 ระบบสแกน ค้นพบ และจำแนกอุปกรณ์ (Network Discovery & Classification)

- อ่านค่า ARP/Neighbor table, ตาราง Active Default Gateway (`0.0.0.0`), Reverse DNS, MAC OUI และ SNMP (`sysDescr`, `sysName`, `sysLocation`, `sysServices`, `ipForwarding`) ผ่าน [discovery.py](./backend/app/discovery.py)
- จำแนกชนิดอุปกรณ์ (`router`, `switch`, `ap`, `server`) และชั้นที่ตั้งใน [classifier.py](./backend/app/classifier.py) จากหลักฐานหลายปัจจัย (Default Gateway suffix, MAC OUI, `ipForwarding`, `sysServices` และคีย์เวิร์ด)
- จัดวางตำแหน่งลงห้องอัตโนมัติตามชนิดอุปกรณ์ใน `pick_smart_spot()` และป้องกันการนำเข้าอุปกรณ์ซ้ำด้วย IP หรือชื่อ (Case-insensitive) ใน `POST /api/v1/discovery/import`

### 4.3 ระบบเก็บทราฟฟิกและสถานะอุปกรณ์ (SNMP Telemetry & Alert-Aware Device Status)

- Background Poller ทำงานทุก 30 วินาที (`SNMP_POLL_INTERVAL_S = 30`) โดยข้ามอุปกรณ์ที่ `enabled = false`, ไม่มี IP หรือ `is_simulated = true`
- อ่านค่าพอร์ตผ่าน IF-MIB 64-bit HC (`ifHCInOctets`, `ifHCOutOctets`) หรือ Fallback 32-bit และบันทึกลง `interface_samples` พร้อมเมตริก CPU, Memory, อุณหภูมิ, Ping RTT และ `sys_uptime` ลง `device_metric_samples`
- หน้า `GET /api/v1/devices/{id}` อ่าน `sys_uptime` ล่าสุดจากฐานข้อมูลโดยไม่บล็อก HTTP request ด้วยการยิง `snmpget` สด
- เมื่อแสดงทราฟฟิกของ `interface_id == "all"` ใน `get_device_traffic_series()` ระบบจะ **รวมค่า (`sum`)** Mbps จากทุกพอร์ตในแต่ละ Bucket เวลา (ตัวเลข `47 พอร์ต` ที่เคยอ้างอิงในเอกสารก่อนหน้าเป็นเพียงจำนวนพอร์ตที่พบจาก Switch ทดสอบ Aruba 2930F ไม่ใช่ขีดจำกัดคงที่ของ Schema)
- กราฟทราฟฟิกใน [TrafficChart.tsx](./netmonitor/src/components/detail/TrafficChart.tsx) แสดงข้อมูลตามจุดเวลาที่แบ่ง Bucket (`TELEMETRY_DEFAULT_POINTS = 60` สำหรับช่วง `15m`/`1h`)
- ตรรกะ `compute_device_status()` ใน [repository.py](./backend/app/repository.py):
  1. หาก `enabled = false` -> `offline`
  2. หากมี Unacknowledged Alert ระดับ `crit` -> `offline`
  3. หาก `latest_poll_status` ไม่มีค่าหรือเป็น `failed` -> `offline`
  4. หากมี Unacknowledged Alert ระดับ `warn` หรือ `latest_poll_status == 'warning'` -> `warning`
  5. หาก `latest_poll_status == 'succeeded'` -> `online`
  - *ข้อควรทราบเมื่อกด Acknowledge:* การกดรับทราบ Alert จะล้างสถานะ Alert ออกจากเงื่อนไขข้อ 2 และ 4 แต่หากอุปกรณ์ยังออฟไลน์จริงและ `latest_poll_status` ล่าสุดเป็น `failed` สถานะของอุปกรณ์จะยังคงเป็น `offline` จนกว่าจะเชื่อมต่อหรือ Poll สำเร็จ (`succeeded`)

### 4.4 ระบบโทโพโลยีและการจำลองผลกระทบลูกโซ่ (Topology Inference & Blast-Radius Simulation)

- [topology.py](./backend/app/topology.py) สร้างสายเชื่อมโยงเบื้องต้นจากรายละเอียด Interface และลำดับชั้นอุปกรณ์ (`Router -> Core Switch -> Access/Dist Switch -> AP/Server`) ลงตาราง `topology_links` และเปิดให้ผู้ใช้เพิ่มหรือลบสายเชื่อมเองได้ใน UI (`Link Edit Mode` -> `POST/DELETE /api/v1/topology/links`)
- เมื่อเปิดโหมดจำลอง (`จำลองล่ม` / [ImpactDrawer.tsx](./netmonitor/src/components/simulation/ImpactDrawer.tsx)) หรือคำนวณผลกระทบจากการล่มจริงในระบบ Frontend จะส่งรายการอุปกรณ์/สายเชื่อมที่ขัดข้องไปยัง `POST /api/v1/simulate/impact` เพื่อประเมิน:
  - อุปกรณ์ที่เป็นต้นเหตุ (`root_down`), ขาดการเชื่อมต่อ (`unreachable`), ใช้เส้นทางสำรอง (`degraded`) และ `healthy` พร้อม Dependency Path
  - คะแนน `spof_ranking`, ห้องที่ได้รับผลกระทบ (`affected_zones` โดยเทียบกรอบห้องจาก `floor_layouts`) และบริการที่กระทบ (`affected_services` จาก Role-based defaults + แท็กที่กำหนดใน [ServiceTagsEditor.tsx](./netmonitor/src/components/detail/ServiceTagsEditor.tsx))
- ผู้ใช้สามารถบันทึกสถานะจำลองลง PostgreSQL ชั่วคราว (`POST /api/v1/simulate/apply-faults`) หรือใช้ปุ่ม `"นำเข้าตัวอย่างสถานะ"` และ `"ล้างข้อมูล DB ทั้งหมด"` บนหน้า [DeviceListPage.tsx](./netmonitor/src/pages/DeviceListPage.tsx)

### 4.5 การค้นหา ธีม และการรองรับสองภาษา (Search, Theme & Localization)

- **Global Search & Help Guide:** ค้นหาด่วนด้วย `Ctrl + K` ([NavbarSearch.tsx](./netmonitor/src/components/layout/NavbarSearch.tsx)) และคู่มือการใช้งานบน Navbar ([HelpGuideModal.tsx](./netmonitor/src/components/layout/HelpGuideModal.tsx))
- **Themes:** รองรับ Dark Theme (`#0b0f17` / `#111827`) และ **Balanced Warm Tan / Almond-Beige Light Theme** (`--bg-canvas: #ddd0be`, `--bg-surface: #ede1cf`, `--bg-elevated: #e4d4be`, `--text-primary: #1d140c`, `--chart-inbound: #047857`, `--chart-outbound: #1e40af` ใน [index.css](./netmonitor/src/index.css))
- **Typography & UI Scale:** ใช้ Google Fonts `Inter` และ `Noto Sans Thai`, `font-variant-numeric: tabular-nums` สำหรับตัวเลขสถิติ, หัวข้อ `line-height: 1.35`, ขนาดป้ายชื่อหมุด `11px`, ชื่อห้อง `12px`, Badge สถานะจำลอง `10px`, และปุ่มไอคอนบน Navbar `28px` (UI Scale ตั้งค่าเริ่มต้นที่ `'100%'` ใน [settingsContext.ts](./netmonitor/src/context/settingsContext.ts) และรองรับค่า `'100%'` / `'125%'` (`zoom: 1.15`) / `'150%'` (`zoom: 1.25`) ผ่าน `SettingsProvider` โดยไม่มีปุ่มสลับสเกลบน Navbar)
- **Bilingual (`th` / `en`):** ข้อความหลักทั้งหมดแปลผ่าน `i18next` ใน [th.ts](./netmonitor/src/i18n/th.ts) และ [en.ts](./netmonitor/src/i18n/en.ts) (ไฟล์ละ 543 บรรทัด / 510 entries)

---

## 5. ผลการทดสอบสมรรถนะและข้อสังเกต (Performance Benchmarks & Test Scope)

### 5.1 การทดสอบโหลดด้วย Grafana k6 (Load & Stress Benchmarks)

ชุดทดสอบ [load_test.js](./load_test.js) และ [stress_limit_test.js](./stress_limit_test.js) ยิงคำขอแบบ Read-only GET ไปยัง 4 Endpoints (`/api/v1/devices`, `/health`, `/api/v1/alerts`, `/api/v1/devices/1`) ต่อ Uvicorn Single Worker + `asyncpg` Pool (`max_size=10`) บนสภาพแวดล้อม Windows สำหรับพัฒนา (ไม่ได้ครอบคลุม Endpoint ที่เขียน DB หรือสแกน CIDR และไม่มีการบันทึกผลเป็น Log Artifact ใน Git):

| การทดสอบ / สคริปต์ | จำนวนผู้ใช้จำลอง (VUs) | อัตราคำขอ / Latency (ค่าสังเกตในการทดสอบอ้างอิง) | อัตรา Error (ในการทดสอบอ้างอิง) | ขอบเขตและข้อจำกัด |
|---|---|---|---|---|
| `load_test.js` (Baseline) | ถึง 15 VUs | ~60 req/s, `p95 = 7.96 ms` | `0.00%` | ทดสอบ Read-only GET routes |
| `stress_limit_test.js` (ขั้น 150–300 VUs) | 150–300 VUs | ~400 req/s, `p95 ~150 ms` | `0.00%` | ช่วงละ 10 วินาที, Read-only GET routes |
| `stress_limit_test.js` (ขั้น 500 VUs) | 500 VUs | `738.77 req/s`, `p95 = 976 ms` (29,554 requests) | `0.00%` | ขีดจำกัดที่ observed บน Windows Dev Host |
| ทดสอบเกิน Breaking Point | > 550–1,200 VUs | Timeout / Refused (`95.1%`) | > 95% | คอขวดที่ Windows TCP Socket Backlog และ Connection Pool |

### 5.2 การตรวจสอบคุณภาพหน้าเว็บด้วย Google Lighthouse (Lighthouse Web Quality Audit)

ผลตรวจคุณภาพ Web App จากรอบประเมินก่อนหน้าบนเบราว์เซอร์ Chrome DevTools (Build ล่าสุดในรอบส่งมอบนี้ผ่าน `tsc -b && vite build` ใช้เวลา `986ms` และผ่าน ESLint `0 errors`):

- Best Practices: `100 / 100`
- Accessibility: `93 / 100`
- Cumulative Layout Shift (CLS): `0.008`
- Total Blocking Time (TBT): `160 ms`
- SEO: `83 / 100`

*(หมายเหตุ: ค่าตัวเลข Lighthouse ด้านบนเป็นการบันทึกจากรอบทดสอบ UI เดิมก่อนปรับธีมเป็น Almond-Beige และเพิ่ม Telemetry Overlay ควรประเมินซ้ำก่อนส่งมอบจริงหากต้องการคะแนนล่าสุด)*

---

## 6. คู่มือการติดตั้งและตั้งค่า (Installation & Configuration Guide)

### 6.1 ความต้องการขั้นต่ำของระบบ (System Requirements)

1. **Node.js:** เวอร์ชัน `18.0.0` ขึ้นไป (และ `npm`)
2. **Python:** เวอร์ชัน `3.10` ขึ้นไป
3. **Docker Desktop / Docker Engine:** สำหรับรัน PostgreSQL 17 Container (`docker-db-1`)
4. **Net-SNMP CLI Suite (`snmpget`, `snmpwalk`):** ต้องอยู่ใน System `PATH` (บน Windows โค้ดใน `snmp.py` และ `collector.py` จะต่อ `C:\usr\bin` เข้า `PATH` ให้อัตโนมัติหากมีอยู่)
5. **เครื่องมือทดสอบเสริม:** Playwright Chromium (`npx playwright install chromium` ใน `netmonitor/`) และ Grafana `k6` (สำหรับสคริปต์ Load Test)

### 6.2 การเปิดระบบและการรันบน Production (One-Click Dev & Production Hosting)

- **การเปิดสำหรับพัฒนาบน Windows (One-Click Dev Launch):** รัน [`start_all.bat`](./start_all.bat) เพื่อเริ่ม PostgreSQL (`5432`), FastAPI Backend (`8000`) และ Vite Dev Server (`5173`)
- **การรันบน Production:**
  1. Build ไฟล์ Frontend ด้วย `npm run build` ใน `netmonitor/` เพื่อสร้าง Static Assets ใน `netmonitor/dist/`
  2. เสิร์ฟ `netmonitor/dist/` ผ่าน Reverse Proxy (เช่น Nginx หรือ Caddy) โดยตั้งค่า Proxy Pass เส้นทาง `/api/*` ไปยัง FastAPI Backend (`http://127.0.0.1:8000`)
  3. รัน FastAPI ด้วย **Single Uvicorn Worker** โดยไม่ใส่ `--reload` (`python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`)

### 6.3 การตั้งค่าสภาพแวดล้อมและเปิดระบบแบบแยกส่วน (Environment Config & Manual Execution)

#### 1. ตั้งค่าไฟล์ `.env` และฐานข้อมูล PostgreSQL

1. คัดลอก [`backend/.env.example`](./backend/.env.example) เป็น `backend/.env` และตั้งค่าสำคัญ:
   - `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_USER=netmon`, `DB_NAME=netmon`, `DB_PASSWORD=<รหัสผ่านเดียวกับ Docker Compose>`
   - `SNMP_COMMUNITY=public` (Community String เริ่มต้นหากอุปกรณ์ไม่ได้กำหนด `credential_ref` เฉพาะเครื่อง)
   - `API_KEY=<รหัสลับสำหรับ X-API-Key>` (หากกำหนดค่า ระบบจะบังคับตรวจ Header `X-API-Key` บน Route ที่แก้ไขข้อมูลและสแกน)
   - `ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`
   - `SNMP_POLL_INTERVAL_S=30`, `SNMP_MAX_CONCURRENT_POLLS=5`, `TELEMETRY_DEFAULT_POINTS=60`, `METRICS_RETENTION_DAYS=7`
2. คัดลอก [`netmonitor/.env.example`](./netmonitor/.env.example) เป็น `netmonitor/.env` และตั้งค่า `VITE_API_KEY` ให้ตรงกับ `API_KEY` ของฝั่ง Backend
3. เริ่มต้น PostgreSQL Container (กำหนด `DB_PASSWORD` ใน `.env` ที่ Root หรือใช้ค่าเริ่มต้น `netmon` ใน [`docker-compose.yml`](./docker-compose.yml)):
   ```powershell
   docker compose up -d
   ```
   - เมื่อ Volume ว่างครั้งแรก PostgreSQL จะรัน [`init/001_schema.sql`](./init/001_schema.sql) และ [`seed_mock_data.sql`](./seed_mock_data.sql) อัตโนมัติ และเมื่อ FastAPI เริ่มทำงาน `init_db()` จะตรวจสอบ/สร้างตารางและคอลัมน์เสริมแบบ Idempotent ภายใต้ Advisory Lock

#### 2. ตั้งค่า SNMP และการสแกนเครือข่าย

- ระบบรองรับ SNMP `v1` และ `v2c` โดยเก็บ Community String ของแต่ละเครื่องไว้ที่ `devices.credential_ref` (หรือใช้ค่า `SNMP_COMMUNITY` จาก `.env`)
- การค้นหาอุปกรณ์ผ่าน UI (`NetworkScanModal`) รองรับ CIDR เป้าหมาย (เช่น `192.168.22.0/24` หรือ `auto` จาก Gateway/Interface ปัจจุบัน) และกรอก Candidate Community Strings คั่นด้วยจุลภาคได้

#### 3. เริ่มต้น Backend API และ Frontend Web

```powershell
# Backend (Port 8000, Swagger UI: http://127.0.0.1:8000/docs)
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend (Port 5173, Web App: http://localhost:5173)
cd ..\netmonitor
npm install
npm run dev
```

---

## 7. ชุดคำสั่งทดสอบระบบ (Automated Test Suites)

### 7.1 ทดสอบ Backend (Python & Pytest)

```powershell
cd backend

# 1. ชุดทดสอบ Pytest ทั้งหมด (41 test cases: classifier, collector, security, topology, traffic API)
# หมายเหตุ: tests/test_real_port_traffic.py และ tests/test_traffic_api.py ต้องมี PostgreSQL กำลังทำงานอยู่
# และ tests/test_real_port_traffic.py จะเรียก pytest.skip() หาก Switch 192.168.22.254 ไม่ตอบสนอง
.\venv\Scripts\python.exe -m pytest test_classifier.py tests/ -v

# 2. สคริปต์ทดสอบ CRUD & Discovery (ต้องรัน PostgreSQL; มีการสร้างและลบข้อมูลทดสอบใน DB)
.\venv\Scripts\python.exe test_api.py
.\venv\Scripts\python.exe test_discovery.py
.\venv\Scripts\python.exe test_smart_placement.py

# 3. สคริปต์ทดสอบ Switch จริงแบบ Standalone (Raise AssertionError หาก Switch ไม่ตอบสนอง)
.\venv\Scripts\python.exe test_real_snmp.py

# 4. สคริปต์จำลอง Faults 6 กรณี (เขียนลง PostgreSQL พร้อม is_simulated = true)
# หมายเหตุ: หากต้องการล้างค่าจำลองกลับเป็น Seed เริ่มต้น ให้เรียก POST /api/v1/reset พร้อม X-API-Key
.\venv\Scripts\python.exe simulate_faults.py
curl -X POST http://127.0.0.1:8000/api/v1/reset -H "X-API-Key: <your_api_key>"
```

### 7.2 ทดสอบ Frontend (ESLint, TypeScript & Vite)

```powershell
cd netmonitor
npm run lint
npm run build
```

### 7.3 ทดสอบ End-to-End ด้วย Playwright (Playwright E2E Suite)

ต้องรัน PostgreSQL, Backend (`:8000`) และ Frontend (`:5173`) พร้อมติดตั้ง Browser (`npx playwright install chromium`) ก่อนรัน:

```powershell
cd netmonitor

# รัน E2E ทั้ง 18 กรณีแบบ Headless (netmonitor.spec.ts 10 กรณี + fault-simulation.spec.ts 8 กรณี)
npm run test:e2e

# หรือรันผ่าน Playwright Interactive UI
npm run test:e2e:ui
```

ขอบเขตหลักที่ชุดทดสอบ Playwright ครอบคลุม:
- [`netmonitor.spec.ts`](./netmonitor/e2e/netmonitor.spec.ts): สลับแท็บนำทางหลัก, ค้นหาด้วย `Ctrl+K` + `Esc`, สลับภาษา `TH/EN` และ Theme, สลับชั้น 1/2, สลับโหมด `2D` และแผนที่ `Leaflet`, สลับ `Move Mode`, กรอง KPI และคำค้นหาในหน้ารายการอุปกรณ์, ตรวจหน้า `#/detail?id=` (CPU/Memory/Chart Range) และตรวจหน้า Reports summary counters
- [`fault-simulation.spec.ts`](./netmonitor/e2e/fault-simulation.spec.ts): เปิด ImpactDrawer และเลือกอุปกรณ์จำลอง, โหมด `Link Edit` และ SVG lines, Downstream chips และการลิงก์ข้ามหน้ารายงาน, สร้าง/ตรวจซ้ำ/ลบสายเชื่อมใน PostgreSQL, Animated outage paths บน 2D/Map, Service tags persistence, Outage highlight ใน Light Mode และ Background outage sync

### 7.4 ทดสอบโหลดด้วย Grafana k6 (Load & Stress Tests)

ต้องรัน PostgreSQL และ FastAPI Backend (`127.0.0.1:8000`) ก่อนรัน:

```powershell
k6 run load_test.js
k6 run stress_limit_test.js
```

---

## 8. สรุปพัฒนาการระบบตามเวอร์ชัน (Release History Summary)

ประวัติการเปลี่ยนแปลงระดับ Commit อยู่ใน Git History (`git log`) ส่วนสรุปพัฒนาการเชิงสถาปัตยกรรมที่สำคัญมีดังนี้:

- **v1.1.0 (Baseline Refactor):** ปรับปรุง `reset_database`, เพิ่ม `asyncio.Lock` ใน `get_db_pool()`, ลบตรรกะที่ผูกสถานะกับชื่ออุปกรณ์เดิม, เพิ่ม Auto-interface discovery, แยก `NavbarSearch.tsx` และย้ายไอคอนมาเป็น Lucide React
- **v1.2.0:** เพิ่มการตรวจสอบ Discovery บนวง `192.168.22.0/24` (Smart Placement, Deduplication), เชื่อม Google Fonts (`Inter`, `Noto Sans Thai`), ปรับ `line-height` และ `tabular-nums`
- **v1.3.0 – v1.3.4:** เพิ่ม `FloorSidebar` device directory, Global health badge, `HelpGuideModal`, ปรับ Classifier สำหรับ Router (`ipForwarding`, Default Gateway route, OUI), เพิ่มตาราง `device_metric_samples` และ Idempotent DDL ใน `database.py`, เพิ่ม Advisory Lock `0x534E4D50` ใน Background Poller, ตัดการสังเคราะห์ทราฟฟิก Sine-wave ออกจาก `collector.py` และสร้าง `simulate_faults.py`
- **v1.3.5 (Current):**
  - แยก Data Access Layer (`compute_device_status()` และ SQL ทั้งหมด) ออกจาก `main.py` เข้าสู่ [repository.py](./backend/app/repository.py) และรวบค่าคงที่กลางไว้ใน [config.py](./backend/app/config.py)
  - เพิ่มระบบ Topology Inference, Link Management (`topology_links`), Blast-Radius/SPOF Simulator และ Business Impact (`affected_zones`, `affected_services`, `ServiceTagsEditor`) โดยรวมการคำนวณทั้งหมดไว้ที่ Backend (`/api/v1/simulate/impact`)
  - ปรับโหมดสว่างเป็น Balanced Warm Tan / Almond-Beige Light Theme ([index.css](./netmonitor/src/index.css)) และเพิ่มผังห้องบน PostgreSQL (`floor_layouts`)
  - เพิ่มความปลอดภัย (`require_api_key` ด้วย `X-API-Key`, `ALLOWED_ORIGINS`, `ipaddress`/`sanitize_snmp_community`, แยก `is_simulated` ออกจาก `credential_ref`), แก้สูตรรวมแบนด์วิธ `interface_id == "all"`, อ่าน `sys_uptime` จากฐานข้อมูลแบบ Non-blocking, ทำ Batch/Concurrent Polling + Telemetry Retention และรองรับคำสั่ง Discovery ทั้ง Windows และ Linux

---

## 9. แนวทางการบำรุงรักษาและขีดจำกัดการขยายระบบ (Maintenance & Operational Guidelines)

### 9.1 การสำรองและกู้คืนฐานข้อมูล (Database Backup & Restore)

อ้างอิงชื่อผู้ใช้และรหัสผ่านฐานข้อมูลจากไฟล์ `.env` (ในตัวอย่างใช้ `$env:PGPASSWORD` จาก Environment เพื่อไม่ระบุรหัสผ่านตายตัวในคำสั่ง):

```powershell
# สำรองข้อมูลเป็น UTF-8
docker exec -e PGPASSWORD=$env:DB_PASSWORD docker-db-1 pg_dump -U netmon netmon | Out-File -Encoding utf8 backup_netmon.sql

# กู้คืนข้อมูลผ่าน CMD Stream (เลี่ยง UTF-16 BOM ของ PowerShell)
cmd /c "docker exec -i -e PGPASSWORD=%DB_PASSWORD% docker-db-1 psql -U netmon -d netmon < backup_netmon.sql"
```

### 9.2 การปรับตั้งค่า SNMP Polling และ Retention (SNMP Polling & Retention Tuning)

- Background Poller ทำงานตามรอบกลาง `SNMP_POLL_INTERVAL_S = 30` วินาทีและจำกัด Concurrent Polls ที่ `SNMP_MAX_CONCURRENT_POLLS = 5` (ค่าคอลัมน์ `devices.poll_interval_s = 60` ใน DB ปัจจุบันใช้เป็น Metadata รายเครื่อง ยังไม่ได้แยก Scheduler รายเครื่อง)
- ค่า Timeout/Retry ของ CLI อยู่ที่ [snmp.py](./backend/app/snmp.py) (`timeout_s=2`, `retries=1`) และ [collector.py](./backend/app/collector.py) (`timeout_s=2`, `-r1`)
- ข้อมูล Time-series ใน `interface_samples`, `device_metric_samples` และ `poll_runs` เก่ากว่า `METRICS_RETENTION_DAYS` (ค่าเริ่มต้น `7` วัน) จะถูกล้างเป็นระยะในรอบ Background Poller โดยคงประวัติ `poll_runs` ล่าสุดของแต่ละอุปกรณ์ไว้เสมอ

### 9.3 แนวทางการรัน Single-Worker สำหรับระบบภายใน (Single-Worker Deployment Profile)

- สำหรับขอบเขต 100–500 อุปกรณ์ของทีม NOC ภายใน แนะนำให้รัน Uvicorn แบบ **Single Worker** (`python -m uvicorn app.main:app --host 0.0.0.0 --port 8000` โดยไม่เปิด `--reload` บน Production) ร่วมกับ `asyncpg` Pool ขนาด `min_size=2, max_size=10` ซึ่งเพียงพอต่อการใช้งานจริงและหลีกเลี่ยงการแย่ง Advisory Lock ของ Background Poller รวมถึง Overhead ของหลาย Process บน Windows
- `init_db()` ใน [database.py](./backend/app/database.py) ครอบ DDL ด้วย PostgreSQL Advisory Lock แล้วเพื่อความปลอดภัยกรณีมีการรัน Process ซ้อนชั่วคราวระหว่าง Restart
