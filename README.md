# NetMonitor (Web-based Network Topology & Monitoring System)

ระบบบริหารจัดการและติดตามสถานะอุปกรณ์เครือข่ายอัจฉริยะ (Web-based Network Topology & SNMP Monitoring) สำหรับห้องปฏิบัติการและห้องควบคุมเครือข่าย (NOC)

---

## 🌟 ฟีเจอร์หลัก (Core Features)

1. **Dual-Mode Visualization (การแสดงผล 2 รูปแบบคู่ขนาน):**
   * **2D Floor Plan Canvas:** ผังอาคาร 2 มิติ แสดงห้อง เซิร์ฟเวอร์ โซนทำงาน ลากจัดวางและล็อคตำแหน่งอุปกรณ์ได้อย่างอิสระ
   * **Satellite Map Overlay:** ทาบผังห้องลงบนภาพถ่ายดาวเทียมจริงตามพิกัดสากล WGS84 GPS (Bilinear Affine Transformation)
2. **Zero-Config Network Discovery:**
   * สแกนค้นหาอุปกรณ์ในวงเครือข่ายผ่าน Dynamic ARP Cache และ Ping-First
   * จำแนกประเภทอุปกรณ์อัตโนมัติ (Router, Switch, Access Point, Server) ด้วย Smart Classifier Engine วิเคราะห์ sysServices, RFC 1213 IP Forwarding OID, MAC OUI, และ Hostname/sysDescr
3. **Deep Diagnostics & Real SNMP Telemetry:**
   * ตรวจวัดสถานะสุขภาพ (Uptime, CPU, Memory, Temperature, Packet Loss)
   * กราฟ Bandwidth Real-Time (Traffic Chart) พร้อม Interactive Crosshair
   * คำแนะนำการวินิจฉัยปัญหาอัตโนมัติ (Diagnostic Suggestion Banner) เมื่ออุปกรณ์เตือนหรือออฟไลน์
4. **Full-Stack Alert Management:**
   * จัดการแจ้งเตือนระดับ Critical, Warning, และ Info ในฐานข้อมูล PostgreSQL
   * รองรับการกดรับทราบปัญหา (Acknowledge) และตรวจสอบสาเหตุย้อนหลัง
5. **Modern Accessible UI (Impeccable Design):**
   * ไอคอนมาตรฐานทั้งหมดจาก `lucide-react`
   * รองรับ Dark Theme และ Light Theme
   * ปรับขนาด UI 150% Scale สำหรับหน้าจอแสดงผลห้องควบคุม และมีปุ่มสลับสเกลแบบ Real-time
   * รองรับสองภาษา (ไทย 🇹🇭 / English 🇺🇸) ครบถ้วน 100%

---

## 🏗️ สถาปัตยกรรมระบบ (Architecture)

```text
+-------------------------------------------------------------------------------+
|                       ชั้นส่วนติดต่อผู้ใช้ (Frontend Client)                   |
|  - React 19 + TypeScript + Vite (Port 5173)                                   |
|  - 2D Canvas Engine (Pan/Zoom/Drag) | Leaflet Map Overlay (Satellite/Carto)   |
|  - NetworkContext & State Store     | Lucide React Icons | i18next            |
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
|  - SNMP Poller Engine (Net-SNMP CLI Integration)                              |
+---------------------------------------+---------------------------------------+
                                        |
                     [asyncpg Connection Pool (Max Size: 10)]
                                        |
+---------------------------------------v---------------------------------------+
|                       ชั้นฐานข้อมูล (Database Layer)                          |
|  - Docker Container: 'docker-db-1' (PostgreSQL 17 Alpine)                     |
|  - Port: 5432 / Database: netmon                                              |
|  - ตาราง: devices, alerts, poll_runs, interfaces, interface_samples            |
+-------------------------------------------------------------------------------+
```

---

## 🚀 เริ่มต้นใช้งาน (Quick Start Guide)

### 1. โคลนและเตรียม Environment
```bash
git clone https://github.com/Suphawit2004/snmp_font_end.git
cd snmp_font_end

# คัดลอกไฟล์ Environment
cp .env.example .env
cp backend/.env.example backend/.env
cp netmonitor/.env.example netmonitor/.env
```

### 2. เริ่มต้นฐานข้อมูล PostgreSQL (Docker)
```bash
docker compose up -d db
```

### 3. รัน FastAPI Backend
```bash
cd backend
python -m venv venv
# สำหรับ Windows:
.\venv\Scripts\activate
# สำหรับ Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. รัน Frontend (Vite + React)
```bash
cd netmonitor
npm install
npm run dev
```
เปิดบราวเซอร์ที่ `http://localhost:5173`

---

## 🧪 การทดสอบระบบ (Automated Tests)

```bash
# รัน Unit & Classifier Tests:
pytest backend/test_classifier.py backend/test_smart_placement.py

# รัน API Integration Tests:
python backend/test_api.py

# ตรวจสอบการบิลด์ Frontend:
npm --prefix netmonitor run build
```

---

## 📄 เอกสารเพิ่มเติม (Documentation)
* [HANDOVER.md](HANDOVER.md) — เอกสารส่งต่องานระบบฉบับสมบูรณ์ (Architecture, Load Testing, Changelog)
* [DESIGN.md](DESIGN.md) — แนวทางการออกแบบ UI และ Design System
