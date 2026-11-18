# NetMonitor — Remediation TODO List (EGM Review Stages 5–8)

เอกสารรายการแก้ไขที่รวบรวมจากผลการตรวจสอบ EGM Review ทั้ง 4 ฉบับ:
- [zoom_out_report.md](./zoom_out_report.md) (Stage 5)
- [comprehension_report.md](./comprehension_report.md) (Stage 6)
- [critic_report.md](./critic_report.md) (Stage 7)
- [intermediate_zoom_out_report.md](./intermediate_zoom_out_report.md) (Stage 8)

---

## 1. โค้ดระบบฝั่ง Backend (Security, Data Integrity & Bugs)

### 1.1 ความปลอดภัยและ Credentials (`CRIT-1`, `ZO-5`, `IC-2`, `IC-8`, `IZO-4`)
- [x] **เปิดใช้งาน `settings.API_KEY` สำหรับ Mutating & Scanning Routes:** นำ `API_KEY` ที่นิยามไว้แล้วใน `backend/app/config.py` (line 18) มาทำเป็น FastAPI Dependency (`require_api_key`) คุ้มครอง Route ที่แก้ไข/ทำลายข้อมูลและสแกนเครือข่าย (`POST /api/v1/clear`, `POST /api/v1/reset`, `DELETE /api/v1/devices/{id}`, `POST /api/v1/simulate/apply-faults`, `POST /api/v1/discovery/scan` และ mutating routes ทั้งหมด) พร้อมให้ `netmonitor/src/services/api.ts` ส่ง `X-API-Key` อัตโนมัติ
- [x] **จำกัด CORS Origins:** เปลี่ยน `allow_origins=["*"]` ใน `backend/app/main.py` เป็นค่าคอนฟิก `ALLOWED_ORIGINS` (`settings.allowed_origins_list` ใน `backend/app/config.py`)
- [x] **ปรับรหัสผ่าน DB และ Input Validation:**
  - ปรับค่าเริ่มต้น `POSTGRES_PASSWORD` ใน `docker-compose.yml` เป็น `${DB_PASSWORD:-netmon}` ให้ตรงกับ `backend/app/config.py` (line 14) โดยไม่อัดรหัสผ่านจริงลงใน repo
  - เพิ่มการตรวจสอบ IP/CIDR (`validate_optional_ip` / `validate_optional_cidr` ผ่าน `ipaddress`) ใน `backend/app/models.py` (`DeviceBase.ip`, `DeviceUpdate.ip`, `ImportItem.ip`, `ScanRequest.cidr`)
  - เพิ่ม `sanitize_snmp_community()` ใน `backend/app/snmp.py` และใช้ร่วมกันใน `snmp.py`, `collector.py`, `discovery.py`, `models.py` เพื่อกันการแทรก CLI flags หรือ control characters
- [x] **แยกสถานะ Simulation ออกจาก `credential_ref`:**
  - เพิ่มคอลัมน์ `is_simulated BOOLEAN NOT NULL DEFAULT FALSE` ใน `init/001_schema.sql` และ `backend/app/database.py` (พร้อม migration อัตโนมัติสำหรับข้อมูลเดิม)
  - อัปเดต `repository.py`, `main.py` และ `backend/simulate_faults.py` ให้ใช้ `is_simulated` โดยไม่เขียนทับ `credential_ref` และให้ `poll_device_traffic` อ่านค่าจาก `get_latest_interface_traffic_snapshot()` แทนค่าฮาร์ดโค้ด `18.4`/`9.7` Mbps

### 1.2 ความถูกต้องของข้อมูลและสถาปัตยกรรม (`CRIT-2`, `CRIT-3`, `CRIT-5`, `ZO-3`, `IZO-3`, `IZO-7`, `IZO-8`)
- [x] **แก้สูตรคำนวณ Aggregate Bandwidth (`interface_id == "all"`):** ใน `backend/app/collector.py` เปลี่ยนจากการหารเฉลี่ยเป็น **ผลรวม (`sum`)** ข้าม interfaces ในแต่ละ bucket และเก็บ `speed_bps = None` เมื่อ `ifHighSpeed == 0`
- [x] **ยุติ Split-Brain ของผังห้อง (Rooms) ระหว่าง Frontend กับ Backend:** เชื่อม `FloorPlanPage.tsx` กับ `GET /api/v1/layout` และ `PUT /api/v1/layout/{floor}`, ส่ง `floor_rooms` บน `createDevice`/`importDiscoveredDevices`, และให้ `backend/app/topology.py` ใช้ `_resolve_effective_rooms()` จาก `main.py` ตรงกับผังห้องบนหน้าจอ
- [x] **ปิดช่องว่าง Repository Pattern ใน `main.py`:** ย้าย Raw SQL ที่ค้างอยู่และ `compute_device_status()` จาก `backend/app/main.py` ไปไว้ที่ `backend/app/repository.py` ครบทั้งหมด

### 1.3 ประสิทธิภาพและการรันระบบ (`CRIT-4`, `CRIT-5`, `IC-4`, `IC-7`, `IZO-1`, `IZO-8`)
- [x] **เลิกเรียก Synchronous `snmp_get_oid` ใน HTTP `GET`:** ใน `GET /api/v1/devices/{device_id}` เปลี่ยนมาอ่านค่า `sys_uptime` ล่าสุดที่ Poller เก็บลง `device_metric_samples` (`repository.fetch_latest_sys_uptime`)
- [x] **ลดคอขวดของ `collector.py` ระหว่าง Background Poll:**
  - รันคำสั่ง `snmpwalk`/`snmpget` ของ OID ที่เป็นอิสระต่อกันแบบ concurrent ด้วย `asyncio.gather`
  - เปลี่ยน N+1 queries ใน `sync_device_interfaces` / `poll_and_calculate_device_traffic` เป็น batch (`UNNEST` / `ANY()` / `executemany`)
- [x] **เพิ่มนโยบายล้าง/จำกัดอายุ Time-Series:** เพิ่ม `METRICS_RETENTION_DAYS` ใน `config.py` และ `repository.purge_expired_telemetry()` ให้ `background_snmp_poller` ล้างข้อมูลเก่าเป็นระยะ
- [x] **แก้ Multi-Worker DDL Race & รองรับ OS Linux:**
  - ครอบ DDL ใน `database.py` (`init_db()`) ด้วย `pg_advisory_lock` / `pg_advisory_unlock`
  - เพิ่มการ parse คำสั่ง `ip neigh`, `arp -n`, `ip route show default`, `ping -c 1 -W` สำหรับ POSIX/Linux ใน `backend/app/discovery.py`

---

## 2. โค้ดระบบฝั่ง Frontend (`CRIT-3`, `CRIT-5`, `ZO-3`, `IZO-7`, `IZO-8`)

- [x] **แยก HTTP Error ออกจาก Offline Mode ใน `netmonitor/src/services/api.ts`:** เพิ่ม `throwIfBackendError()` + `isOfflineTransportError()` ให้ HTTP `4xx` และ FastAPI JSON `5xx` throw Error ตรงๆ แทนการ fall through ไปเขียน `localStorage` (fallback เฉพาะเมื่อเชื่อมต่อ Backend ไม่ได้จริง)
- [x] **รวม Topology & Blast-Radius Engine เป็นแหล่งเดียว:** ย้าย `FaultSimProvider.tsx` และ `DeviceDetailPage.tsx` มาเรียก `api.simulateImpact()` (`/api/v1/simulate/impact`) แทนการรัน `topologyEngine.ts` ซ้ำในเบราว์เซอร์ (คง `topologyEngine.ts` ไว้เป็น offline fallback เมื่อ Backend ดับเท่านั้น)
- [x] **ตรวจสอบ script และ i18n ที่ค้างอยู่:**
  - เพิ่ม `"test:e2e:ui": "playwright test --ui"` ใน `netmonitor/package.json`
  - ย้ายข้อความ hardcode ใน `DeviceListPage.tsx`, `FloorPlanPage.tsx`, `ReportsPage.tsx` เข้า `netmonitor/src/i18n/th.ts` และ `en.ts`
  - ปรับ `.simTag` (`DevicePin.module.css`) และ `.mapSimBadge` (`FloorMapOverlay.module.css`) เป็น `10px` และยืนยันค่า UI Scale (`DEFAULT_SETTINGS.uiScale = '100%'`, ไม่มีปุ่มสลับบน Navbar) สำหรับใช้อัปเดตเอกสารในหัวข้อ 3

---

## 3. เอกสาร (`HANDOVER.md` และ Companion `README.md`)

### 3.1 โครงสร้างและเนื้อหาที่ขาดหาย (`CRIT-1`, `CRIT-2`, `ZO-2`, `CRIT-6`, `COMP-1..3`)
- [x] **เพิ่มหัวข้อ `Problem Statement` และ `Security Risks & Mitigations`:** ระบุปัญหาที่ระบบแก้ไขใน Section 1 และความเสี่ยง+แนวทางป้องกันด้านความปลอดภัย (API Key auth, CORS, input validation, credential handling) ใน Section 2.4
- [x] **ปรับ Section 2.3 (Alternatives Considered):** เพิ่มการเปรียบเทียบ OS CLI (`snmpget`/`arp`) vs native async libraries, Single vs Dual Topology Engine, แหล่งเก็บ Room State, และแนวทาง Auth
- [x] **เพิ่มเอกสารระบบ Topology Inference & Blast-Radius Simulation:** อัปเดต Diagram (Section 2.1), Directory Tree (Section 3), รายชื่อตาราง (`topology_links`), และ Core Features (Section 4) ให้ครอบคลุม `topology.py`, `/api/v1/topology/*`, `/api/v1/simulate/*`, `topologyEngine.ts`, `FaultSimProvider.tsx`, `ImpactDrawer.tsx`, และ `ServiceTagsEditor.tsx`
- [x] **เติม Operational Prerequisites ให้ครบใน Section 6–7:**
  - วิธีตั้งค่า SNMP (v2c/v3, community, `credential_ref`), Target scan subnet, และ Environment variables ใน `backend/app/config.py`
  - ระบุรหัสผ่าน DB ใน Section 6.3 ให้ตรงกับ `docker-compose.yml` และอธิบายว่า `docker compose up -d` ใช้ `init/001_schema.sql` หรือ Auto-migration อย่างไร รวมถึงการใช้ `seed_mock_data.sql` / `POST /api/v1/reset`
  - เพิ่มขั้นตอนติดตั้ง Playwright browser (`npx playwright install`) และ `k6` ใน Section 6.1, ระบุว่าแต่ละคำสั่งเทสใน Section 7 ต้องเปิด server/DB ก่อนหรือไม่ และคำสั่งไหนแก้ข้อมูล DB
  - อธิบายวิธี serve ไฟล์จาก `npm run build` ใน Production และอธิบายพฤติกรรมของ `compute_device_status()` เมื่อกด Acknowledge Alert ขณะที่อุปกรณ์ยังออฟไลน์จริง

### 3.2 แก้ไขข้อมูลที่ขัดแย้งกับโค้ดจริง (`CRIT-3`, `CRIT-4`, `ZO-4`, `COMP-4..8`, `IZO-6..10`)
- [x] **อัปเดตชื่อธีมสว่างและค่าสี:** เปลี่ยนจาก `"Soft Slate Light Theme"` (`#e8edf2`, `#f6f8fa`, `#ffffff`, `#0f172a`, `#059669`/`#2563eb`) เป็น `"Balanced Warm Tan / Almond-Beige Light Theme"` ตาม `netmonitor/src/index.css` (`#ddd0be`, `#ede1cf`, `#e4d4be`, `#1d140c`, กราฟ `#047857`/`#1e40af`), อัปเดตสี Popup ใน `DevicePin` / `FloorMapOverlay`, และเอาข้อความเคลม WCAG AA ออกหากยังไม่ได้ตรวจวัดจริง
- [x] **แก้ข้อมูล UI Scale, ขนาดปุ่ม และ Simulation Buttons:**
  - แก้ Section 8.4 ให้ตรงกับ `settingsContext.ts` (`uiScale` เริ่มต้น `'100%'`), `SettingsProvider.tsx` (`'150%'` -> `zoom: 1.25`), และลบการอ้างถึงปุ่ม Scale Switcher บน Navbar ที่ไม่มีอยู่จริง
  - แก้ขนาดปุ่ม Navbar จาก `32px` เป็น `28px` และเอาข้ออ้างเรื่อง "ลบตัวอักษรต่ำกว่า 12px ทั้งระบบ" ออกให้ตรงกับ `11px`/`9px`/`8px` จริง
  - แก้ Section 8.11 ให้ตรงปุ่มจริงบน `FloorPlanPage` (`"จำลองล่ม"` / ImpactDrawer) กับ `DeviceListPage` (`"นำเข้าตัวอย่างสถานะ"` + `"ล้างข้อมูล DB ทั้งหมด"`) และแก้ชื่ออุปกรณ์จำลองใน Section 8.7 จาก `SW-42-B73C` เป็น `Cisco-SW-46`
- [x] **แก้ชื่อค่าคงที่, Intervals และ Repository Symbols:**
  - แก้ Section 8.9 และ 9.2 จาก `60s` / `MAX_SCAN_HOSTS = 254` / `SNMP_ADVISORY_LOCK_KEY` เป็นค่าจริงใน `config.py` (`SNMP_POLL_INTERVAL_S = 30`, `ADVISORY_LOCK_SNMP_POLLER = 0x534E4D50`, `discovery.py` `max_hosts = 256`) และแยก Frontend Poll (`15s`) ออกจาก SNMP Poll (`30s`)
  - ลบหรือแก้ชื่อฟังก์ชันที่ไม่มีจริงใน `repository.py` (`fetch_all_devices`, `fetch_device_by_id`, `update_device`, `fetch_active_alerts`, `resolve_alert`), ระบุที่อยู่จริงของ `compute_device_status()` (`main.py`), และตัดคำว่า "Resolve Alert" หากไม่มี Endpoint จริง
  - จำกัดความเรื่องการตัด Sine Wave ให้ระบุเฉพาะ Backend `collector.py` (ไม่เหมารวม Frontend `traffic.ts`/`random.ts`)
  - ปรับเลข Uvicorn `--host` (`127.0.0.1` vs `0.0.0.0`) และเลขเวอร์ชัน (`1.3.5` vs `1.1.0` vs `Navbar.tsx` `v1.3` vs `main.py` `1.0.0` vs `package.json` `0.0.0`) ให้ตรงกันทั้งโปรเจกต์
- [x] **แก้ตัวเลขการทดสอบและ Benchmarks:**
  - ปรับจำนวน Pytest ให้ตรงกัน (`24/24` vs `17 + 9 = 26` vs `24 passed, 2 skipped`) และแก้คำอธิบาย `backend/test_real_snmp.py` ที่ไม่ได้ใช้ `pytest.skip()`
  - อัปเดต Section 8.10 ให้ตรงกับเทสจริงใน `netmonitor/e2e/netmonitor.spec.ts` (ตัด Scenario 3 & 7 ที่ไม่มีอยู่จริง, ปรับคำบรรยาย Assertion ของแต่ละ TC, ลบหรือแก้ `npm run test:e2e:ui`, เพิ่ม `stress_limit_test.js` ใน Section 7, และเอาตัวเลข `12 วินาที` ที่ไม่มี log ออก)
  - ใส่บริบทสเปกเครื่อง/ขนาด DB/ขอบเขต `stress_limit_test.js` (4 GET routes, 10s) ให้ผล k6 / Lighthouse / Vite `~380ms` และลดทอนคำเคลม `0.00% Error Rate` เป็นผลภายใต้เงื่อนไขทดสอบ
  - แก้ตัวเลข `i18n` (`332 keys 100%` -> 532 บรรทัด ~480+ keys และยังมีบางข้อความ hardcode), อธิบายที่มาของ `47 พอร์ต` กับ `Mock Detail`, และแก้คำอธิบายกราฟ Tooltip จาก `ระดับมิลลิวินาที` เป็น discrete sample intervals

### 3.3 จัดระเบียบโครงสร้าง, Altitude Control และสำนวนภาษา (`ZO-1`, `CRIT-6`, `CRIT-7`, `CRIT-9`)
- [x] **ตัด Changelog Bloat & CSS/JSX Weeds ออก (`Anti-Weeds`):** ย้ายรายละเอียด Section 8 (กว่า 215 บรรทัด) และรายละเอียด CSS/hex/px/Lucide Icon ใน Section 4.5–4.8 ไปไว้ใน Git history หรือ `CHANGELOG.md` แยก, ตัดความซ้ำซ้อนระหว่าง Section 1 Highlights, Section 4, Section 8 และ `README.md`/`backend/README.md`/`netmonitor/README.md` โดยใช้ลิงก์เชื่อมโยงแทนการเขียนซ้ำ
- [x] **ปรับสารบัญ, Heading และลิงก์ให้เป็นมาตรฐาน:**
  - เพิ่มลิงก์ `[Title](#anchor)` และ H3 ใน Table of Contents
  - ปรับ Section 3 Directory Tree ให้ตรงไฟล์จริง (`README.md`, `backend/README.md`, `netmonitor/README.md`, `docker-compose.yml`, `init/001_schema.sql`, `backend/test_classifier.py`, `HelpGuideModal.tsx`, ชื่อ provider แทน `Network, Simulation, Settings`)
  - จัดเลขหัวข้อให้สม่ำเสมอ (`1.2` แทน `### จุดเด่นสำคัญของระบบ:`, `7.1–7.4` แทน `1.–4.:`, เติมคำแปลอังกฤษใน `5.2`), ลบโคลอน `:` เกิน, จัดรูปแบบ bullet (`*` vs `-`), เว้นบรรทัดหลัง heading, เส้นคั่น `---`, และลูกศร (`➔` vs `$\rightarrow$`)
  - เปลี่ยนพาธเฉพาะเครื่อง (`C:\work\snmp_font_end\...`, `file:///c:/work/snmp_font_end/...`) เป็น Relative Markdown Links ทั้งไฟล์
- [x] **ปรับน้ำเสียงเอกสาร:** ลบ `"Ponytail Senior Dev"` (line 414), ตัดคำโฆษณาเกินจริง (`อัจฉริยะ`, `เร็วเป็นพิเศษ`, `สมบูรณ์แบบ`, `ลื่นไหล`, `เร็วที่สุดในระบบนิเวศ Python`, `คุณภาพสูง`, `ดีไซน์ยุคใหม่`, `นิ่งสนิท`, `ระดับมืออาชีพ`, `อย่างนุ่มนวล`, `"ใช้งานได้ใน 10 วินาที"`, `100% เสมอในทุกสภาพแวดล้อม CI/CD`, `"อย่างถาวร"`, คำซ้ำ `"พร้อมกัน...พร้อมกัน"`)

---

## 4. รายการที่ไม่ควรทำตอนนี้ (Deferred / YAGNI Guardrails จาก Stage 8)

อ้างอิงจาก [intermediate_zoom_out_report.md](./intermediate_zoom_out_report.md) สำหรับระบบ NOC ภายในขนาด **100–500 อุปกรณ์** รายการเหล่านี้เพิ่มความซับซ้อนเกินความจำเป็น:
- **ไม่ต้องทำ:** แยก `background_snmp_poller` ออกเป็น Daemon/Container ใหม่ (`python -m app.poller`), เปลี่ยน Net-SNMP CLI เป็น async SNMP library, รัน `--workers 4` หรือติดตั้ง PgBouncer (ให้ใช้ Single Uvicorn Worker โดยไม่เปิด `--reload` บน Prod และตัดคำแนะนำ `--workers 4` / PgBouncer ออกจาก Section 9.3)
- **ไม่ต้องทำ:** เปลี่ยน HTTP Polling 15s เป็น SSE + PostgreSQL `LISTEN/NOTIFY` + Cache invalidation (Polling 15s + `deviceSnapshotKey` เพียงพอแล้ว)
- **ไม่ต้องทำ:** สร้างระบบ Room Layout Versioning พร้อม Multi-operator Conflict Resolution (แค่ใช้แหล่งข้อมูลเดียวก็เพียงพอ)
- **ไม่ต้องทำ:** เพิ่ม OIDC / RBAC / Enterprise Secret Vault หรือเขียน Threat Model ยาวในเอกสาร (แค่เปิดใช้งาน `settings.API_KEY` + `ALLOWED_ORIGINS` ก็ตรงตาม Non-Goal)
