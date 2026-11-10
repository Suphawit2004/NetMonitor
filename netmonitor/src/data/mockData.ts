import type { RawDevice, Room } from '../types'

// ─────────────────────────────────────────────
// ชั้น 1 – อาคาร A
// ─────────────────────────────────────────────

export const ROOMS_F1: Room[] = [
  { label: 'Server Room',      left: 20,  top: 20,  width: 200, height: 160 },
  { label: 'Network Core',     left: 240, top: 20,  width: 200, height: 160 },
  { label: 'Zone A – Office',  left: 460, top: 20,  width: 340, height: 160 },
  { label: 'Zone B – Meeting', left: 20,  top: 200, width: 360, height: 170 },
  { label: 'Zone C – Lab',     left: 400, top: 200, width: 400, height: 170 },
  { label: 'IT Office',        left: 20,  top: 390, width: 250, height: 130 },
  { label: 'Zone D – Lounge',  left: 290, top: 390, width: 510, height: 130 },
]

export const DEVICES_F1: RawDevice[] = [
  { id: 'sw-core-01', name: 'SW-CORE-01', dtype: 'switch', status: 'online',  floor: 1, x: 96,  y: 98,  ip: '10.0.0.1',    model: 'Cisco Catalyst 9500' },
  { id: 'sw-dist-01', name: 'SW-DIST-01', dtype: 'switch', status: 'online',  floor: 1, x: 226, y: 98,  ip: '10.0.0.5',    model: 'Cisco Catalyst 9300-48P' },
  { id: 'rtr-01',     name: 'RTR-CORE-01', dtype: 'router', status: 'warning', floor: 1, x: 386, y: 98,  ip: '192.168.22.1', model: 'Cisco ISR 4451' },
  { id: 'srv-01',     name: 'SRV-01',     dtype: 'server', status: 'online',  floor: 1, x: 576, y: 98,  ip: '10.0.1.10',   model: 'Dell PowerEdge R750' },
  { id: 'ap-a1',      name: 'AP-A1',      dtype: 'ap',     status: 'online',  floor: 1, x: 686, y: 58,  ip: '10.1.0.1' },
  { id: 'ap-a2',      name: 'AP-A2',      dtype: 'ap',     status: 'warning', floor: 1, x: 686, y: 118, ip: '10.1.0.2' },
  { id: 'sw-b1',      name: 'SW-B1',      dtype: 'switch', status: 'online',  floor: 1, x: 226, y: 238, ip: '10.0.0.10' },
  { id: 'ap-b1',      name: 'AP-B1',      dtype: 'ap',     status: 'online',  floor: 1, x: 66,  y: 238, ip: '10.1.0.10' },
  { id: 'ap-b2',      name: 'AP-B2',      dtype: 'ap',     status: 'online',  floor: 1, x: 306, y: 238, ip: '10.1.0.11' },
  { id: 'sw-c1',      name: 'SW-42-B73C', dtype: 'switch', status: 'warning', floor: 1, x: 576, y: 238, ip: '192.168.22.42' },
  { id: 'ap-c1',      name: 'AP-C1',      dtype: 'ap',     status: 'online',  floor: 1, x: 456, y: 268, ip: '10.1.0.20' },
  { id: 'ap-c2',      name: 'AP-C2',      dtype: 'ap',     status: 'offline', floor: 1, x: 716, y: 268, ip: '10.1.0.21' },
  { id: 'srv-02',     name: 'SRV-44-F9FF', dtype: 'server', status: 'offline', floor: 1, x: 96,  y: 418, ip: '192.168.22.44' },
  { id: 'sw-it1',     name: 'SW-IT1',     dtype: 'switch', status: 'offline', floor: 1, x: 176, y: 418, ip: '10.0.0.30' },
  { id: 'ap-d1',      name: 'AP-D1',      dtype: 'ap',     status: 'online',  floor: 1, x: 426, y: 418, ip: '10.1.0.30' },
  { id: 'ap-d2',      name: 'AP-D2',      dtype: 'ap',     status: 'warning', floor: 1, x: 626, y: 358, ip: '10.1.0.31' },
  { id: 'ap-d3',     name: 'AP-D3',     dtype: 'ap',     status: 'online',  floor: 1, ip: '10.1.0.32' },
]

// ─────────────────────────────────────────────
// ชั้น 2 – อาคาร A
// ─────────────────────────────────────────────

export const ROOMS_F2: Room[] = [
  { label: 'Zone E – Office',  left: 20,  top: 20,  width: 380, height: 160 },
  { label: 'Zone F – Lab',     left: 420, top: 20,  width: 380, height: 160 },
  { label: 'Zone G – Meeting', left: 20,  top: 200, width: 780, height: 160 },
  { label: 'Zone H – Lounge',  left: 20,  top: 380, width: 780, height: 140 },
]

export const DEVICES_F2: RawDevice[] = [
  { id: 'rtr-f2-01',  name: 'RTR-BRANCH-02', dtype: 'router', status: 'offline', floor: 2, x: 120, y: 90,  ip: '192.168.22.2',   model: 'MikroTik CCR2004-16G-2S+' },
  { id: 'sw-f2-01',   name: 'SW-112-B3C3',   dtype: 'switch', status: 'offline', floor: 2, x: 500, y: 90,  ip: '192.168.22.112', model: 'EdgeSwitch 24' },
  { id: 'ap-f2-01',   name: 'Ubiquiti-AP-239', dtype: 'ap',   status: 'warning', floor: 2, x: 260, y: 270, ip: '192.168.22.239', model: 'UniFi AP-AC-Pro' },
  { id: 'ap-f2-02',   name: 'AP-F2-02',      dtype: 'ap',     status: 'online',  floor: 2, x: 600, y: 270, ip: '192.168.22.240', model: 'UniFi AP-AC-Pro' },
]

// ─────────────────────────────────────────────
// Combined (ทุกชั้น — seed ให้ services/api)
// ─────────────────────────────────────────────

export const ALL_DEVICES: RawDevice[] = [...DEVICES_F1, ...DEVICES_F2]

// Floor map helper (rooms ใช้แสดงผัง + หาตำแหน่งห้องของอุปกรณ์)
// ป้ายชื่อชั้นแสดงผ่าน i18n key 'floor.buildingA'
export const FLOOR_DATA: Record<number, { rooms: Room[] }> = {
  1: { rooms: ROOMS_F1 },
  2: { rooms: ROOMS_F2 },
}

// หมายเหตุ: รายละเอียดอุปกรณ์ (ports/metrics/alerts) สร้างสดจาก
// services/detailFactory.ts ต่อ device.id — ไม่เก็บ hardcode ที่นี่แล้ว
