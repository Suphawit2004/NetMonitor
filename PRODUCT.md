# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **ทีมปฏิบัติการเครือข่าย (NOC Engineers & Campus/Office IT Admins):** ผู้ดูแลระบบเครือข่ายภายในองค์กรที่ต้องเฝ้าระวังอุปกรณ์ระดับ **100–500 เครื่อง** ในอาคารหรือแคมปัส แยกแยะสาเหตุต้นตอเมื่ออุปกรณ์ขัดข้อง ประเมินขอบเขตผลกระทบต่อห้อง/บริการ และวางแผนจัดวางอุปกรณ์ใหม่

## Product Purpose

รวมงานเฝ้าระวังเครือข่าย การอ่านค่าทราฟฟิกพอร์ตและสุขภาพเครื่อง พิกัดตำแหน่งทางกายภาพ และการวิเคราะห์ผลกระทบลูกโซ่ไว้ในหน้าจอเดียว เพื่อลดภาระที่ผู้ดูแลต้องสลับตรวจตาราง IP ผังอาคาร และคำสั่ง CLI แยกส่วนกันระหว่างเหตุขัดข้อง ความสำเร็จของระบบคือการมองเห็นจุดเกิดปัญหา แยกอุปกรณ์ที่ล่มจริงออกจากอุปกรณ์ที่ดับตาม และตัดสินใจรับมือได้จากจุดเดียว

## Positioning

ผสาน 4 ความสามารถหลักไว้ในระบบเดียวสำหรับทีม NOC ภายในองค์กร:

1. **Dual-Mode Physical Context:** ผังอาคาร 2 มิติที่ปรับแก้ไขกรอบห้องได้เอง ร่วมกับแผนที่พิกัด GPS (WGS84 / Leaflet) ที่ซิงค์ผังห้องจากฐานข้อมูลร่วมกัน (`floor_layouts`)
2. **Multi-Protocol Auto-Discovery & Smart Placement:** สแกนวงแลนผ่าน ARP/Neighbor table, ICMP Ping (พร้อม Retry), SNMP `v1`/`v2c` และ TCP Liveness Fallback พร้อมจำแนกประเภทอุปกรณ์และคำนวณจุดวางลงห้องอัตโนมัติ
3. **Single-Engine Topology & Blast-Radius Analysis:** คำนวณผลกระทบลูกโซ่ คะแนน Single Point of Failure (SPOF) ห้องและแท็กบริการที่ได้รับผลกระทบจาก Backend เพียงแหล่งเดียว พร้อม Offline Fallback บนเบราว์เซอร์
4. **Cascading Status Distinction:** แยกความต่างระหว่างอุปกรณ์ต้นเหตุที่ล่ม (`offline`) กับอุปกรณ์ปลายทางที่ได้รับผลกระทบลูกโซ่ (**ดับตาม / `unreachable`**) และเส้นทางสำรอง (`degraded`) โดยเปลี่ยนสถานะปลายทางจาก `online` เป็น **`warning`**

## Operating Context

- **โหมดการใช้งาน:** ระบบปฏิบัติการและการเฝ้าระวังต่อเนื่อง (Operate) รองรับการใช้งานทั้งในห้องควบคุมมืด (Dark Theme) และสภาพแวดล้อมสำนักงานสว่าง (Light Theme แบบลดแสงจ้า)
- **การเชื่อมต่อและเก็บข้อมูล:** FastAPI + Uvicorn (Single Worker) และ PostgreSQL 17 เก็บ Telemetry แบบ Time-series ตามรอบการ Poll (30 วินาที) และ Retention (7 วัน) ร่วมกับ Frontend React 19 ที่ดึงข้อมูลทุก 15 วินาที
- **สภาพแวดล้อมเมื่อขาดการเชื่อมต่อ:** คงความสามารถในการดูผัง ปรับโหมดจำลอง และคำนวณผลกระทบบนเบราว์เซอร์ผ่าน `localStorage` และ Client Fallback เมื่อ Backend ไม่ตอบสนองระดับ Transport (โดยไม่ปกปิด HTTP 4xx/5xx error จริงจาก Backend)

## Capabilities and Constraints

- **ขอบเขตการเฝ้าระวังแบบ Read-Only:** ติดตามสถานะ อ่าน Counter และทดสอบการเชื่อมต่อเท่านั้น ไม่ส่งคำสั่งแก้ไขค่าบน Switch/Router (ไม่ส่ง SNMP `SET` และไม่เชื่อมต่อ SSH/Telnet)
- **ขอบเขตความปลอดภัยและการเข้าถึง:** ออกแบบสำหรับทีม NOC ภายในองค์กร ควบคุมสิทธิ์ Endpoint แก้ไขข้อมูลและการสแกนด้วย `X-API-Key` ร่วมกับการจำกัด `ALLOWED_ORIGINS` และ Input Sanitization โดยไม่รวม Multi-tenancy, Login Flow หรือ RBAC หลายระดับ
- **เกณฑ์สถานะอุปกรณ์:** สถานะหลักมี 3 ระดับ (`online`, `warning`, `offline`) โดยการพลาด Poll 1 รอบหลังจากเคยเชื่อมต่อสำเร็จจะบันทึก `warning` ก่อนเปลี่ยนเป็น `offline` เมื่อพลาด 2 รอบติดต่อกัน และอุปกรณ์ที่ได้รับผลกระทบลูกโซ่ (`unreachable` / `degraded`) จะถูกปรับจาก `online` เป็น `warning`
- **การรองรับระบบปฏิบัติการ:** รองรับคำสั่ง Network Discovery ทั้ง Windows (`arp`, `netsh`, `route`, `ping`) และ Linux/POSIX (`ip neigh`, `arp -n`, `ip route`, `ping`) รวมถึงการทำงานใน Docker

## Brand Commitments

- ใช้ชื่อผลิตภัณฑ์อย่างเป็นทางการว่า **NetMonitor**
- รองรับสองภาษาตลอดระบบ (**ภาษาไทยเป็นหลัก** พร้อมสวิตช์สลับเป็น **ภาษาอังกฤษ** ผ่าน `i18next`)

## Evidence on Hand

- **เอกสารระบบใน Repo:** [README.md](./README.md), [HANDOVER.md](./HANDOVER.md), [backend/README.md](./backend/README.md), [netmonitor/README.md](./netmonitor/README.md)
- **สคริปต์และข้อมูลทดสอบ:** [init/001_schema.sql](./init/001_schema.sql), [seed_mock_data.sql](./seed_mock_data.sql), ชุดทดสอบ Backend Pytest ([backend/tests/](./backend/tests/) และ [backend/test_classifier.py](./backend/test_classifier.py)), Playwright E2E ([netmonitor/e2e/](./netmonitor/e2e/)) และสคริปต์โหลด [load_test.js](./load_test.js) / [stress_limit_test.js](./stress_limit_test.js)
- **ข้อมูลที่ยังไม่มีและห้ามสร้างเสริม:** ไม่มีคำรับรองจากลูกค้าภายนอก ไม่มีตัวเลข SLA เชิงพาณิชย์ และยังไม่มีไฟล์ `DESIGN.md` แยก (ผลโหลด/Lighthouse ที่มีเป็นเฉพาะรอบอ้างอิงบนเครื่องพัฒนา)

## Product Principles

1. **Location-First Situational Awareness:** ทุกอุปกรณ์และเหตุขัดข้องต้องผูกกลับไปเห็นตำแหน่งจริงบนผังห้องและพิกัดแผนที่ได้ทันที ไม่ใช่เพียงตาราง IP
2. **Distinguish Root Failure from Cascading Impact:** แยกอุปกรณ์ต้นเหตุที่ล่ม (`offline`) ออกจากอุปกรณ์ปลายทางที่ดับตามหรือวิ่งผ่านสายสำรอง (`warning`) เพื่อไม่ให้สัญญาณเตือนซ้ำซ้อนกลบต้นเหตุจริง
3. **Resilience Without Silent Data Corruption:** เมื่อเครือข่ายแกว่งหรือขาดการเชื่อมต่อระดับ Transport ให้รักษาการทำงานต่อได้อย่างนุ่มนวล แต่ต้องรายงาน HTTP/DB Error จริงตรงไปตรงมาเสมอ
4. **Right-Sized Read-Only Simplicity:** รักษาความเรียบง่ายและปลอดภัยสำหรับทีม NOC ภายในขนาด 100–500 เครื่อง หลีกเลี่ยงระบบกระจายส่วนหรือโครงสร้างสิทธิ์ที่เกินความจำเป็น

## Accessibility & Inclusion

- ออกแบบให้ใช้งานได้สบายตาต่อเนื่องทั้งในห้องมืดและสำนักงานที่มีแสงสว่างโดยไม่พึ่งพื้นผิวสีขาวจ้า
- แสดงสถานะและผลกระทบด้วย **สี + ไอคอน + ข้อความกำกับ** ร่วมกันเสมอ รองรับความชัดเจนของตัวเลขสถิติด้วย `tabular-nums` และข้อความสองภาษา (`TH`/`EN`)
