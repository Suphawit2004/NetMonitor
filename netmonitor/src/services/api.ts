import type {
  Device,
  RawDevice,
  DiscoveredDevice,
  ConnectResult,
  DeviceStatus,
  DeviceType,
  LocalNetworkInfo,
  Alert,
  TrafficSeries,
  InterfaceTrafficItem,
  PollTrafficResponse,
} from '../types'
import { ALL_DEVICES } from '../data/mockData'
import { getStoredBuildingBounds, canvasToGps } from './mapGeo'
import { getStoredRooms } from './roomStore'

// ─────────────────────────────────────────────
// Mock API layer — เลียนแบบ backend จริง
// ทีหลังเปลี่ยน implementation เป็น fetch() โดยไม่ต้องแก้ caller
// ─────────────────────────────────────────────

const BASE_LATENCY_MS = 200
const JITTER_MS = 200

function delay(): Promise<void> {
  return new Promise(resolve =>
    setTimeout(resolve, BASE_LATENCY_MS + Math.random() * JITTER_MS),
  )
}

// ── auto-place อุปกรณ์ที่ backend ยังไม่ระบุพิกัด ──────────
const GRID_X0 = 60
const GRID_X1 = 860
const GRID_Y0 = 60
const GRID_Y1 = 560
const GRID_STEP = 40
const MIN_DIST = 60

function pickFreeSpot(placed: Device[], floor: 1 | 2): { x: number; y: number } {
  const onFloor = placed.filter(d => d.floor === floor)
  for (let gy = GRID_Y0; gy <= GRID_Y1; gy += GRID_STEP) {
    for (let gx = GRID_X0; gx <= GRID_X1; gx += GRID_STEP) {
      if (!onFloor.some(d => Math.hypot(d.x - gx, d.y - gy) < MIN_DIST)) {
        return { x: gx, y: gy }
      }
    }
  }
  return { x: 450, y: 300 }
}

// แปลงข้อมูลจาก "backend" → Device ที่มีพิกัดครบเสมอ
// ล็อคตำแหน่งเป็นค่าเริ่มต้น (กันย้ายโดยไม่เจตนา) — backend ส่ง locked: false มาได้ถ้าต้องการปลด
function normalizeDevices(list: RawDevice[]): Device[] {
  const placed: Device[] = []
  for (const raw of list) {
    const spot = raw.x !== undefined && raw.y !== undefined
      ? { x: raw.x, y: raw.y }
      : pickFreeSpot(placed, raw.floor)
    placed.push({ ...raw, ...spot, locked: raw.locked ?? true })
  }
  return placed
}

const STORAGE_KEY = 'netmonitor:devices_db'
const API_BASE = '/api/v1'

function loadStoredDevices(): Device[] {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    if (raw !== null) {
      const parsed = JSON.parse(raw) as RawDevice[]
      if (Array.isArray(parsed)) return normalizeDevices(parsed)
    }
  } catch {
    // localStorage ใช้ไม่ได้ → ใช้ค่าเริ่มต้น
  }
  return normalizeDevices(ALL_DEVICES.map(d => ({ ...d })))
}

function saveStoredDevices(list: RawDevice[]): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    }
  } catch {
    // ignore
  }
}

// In-memory cache สำหรับ session นี้
let db: Device[] = loadStoredDevices()
let idSeq = 0

export async function fetchDevices(): Promise<Device[]> {
  try {
    const res = await fetch(`${API_BASE}/devices`)
    if (res.ok) {
      const data = (await res.json()) as Device[]
      db = data
      saveStoredDevices(db)
      return data
    }
  } catch (err) {
    console.warn('Backend API unavailable, falling back to LocalStorage', err)
  }

  await delay()
  return db.map(d => ({ ...d }))
}

export async function createDevice(input: Omit<RawDevice, 'id'>): Promise<Device> {
  const offlineInput = { ...input, status: 'offline' as const }
  try {
    const res = await fetch(`${API_BASE}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offlineInput),
    })
    if (res.ok) {
      const created = (await res.json()) as Device
      db = [...db, created]
      saveStoredDevices(db)
      return created
    }
  } catch (err) {
    console.warn('Backend API unavailable, falling back to local creation', err)
  }

  await delay()
  idSeq += 1
  const spot = (input.x !== undefined && input.y !== undefined)
    ? { x: input.x, y: input.y }
    : pickFreeSpot(normalizeDevices(db), input.floor)
  const device: Device = {
    ...offlineInput,
    ...spot,
    locked: input.locked ?? true,
    status: 'offline',
    id: `dev-${Date.now().toString(36)}-${idSeq}`,
  }
  db = [...db, device]
  saveStoredDevices(db)
  return { ...device }
}

export async function updateDevice(
  id: string,
  patch: Partial<Omit<Device, 'id'>>,
): Promise<Device | null> {
  try {
    const res = await fetch(`${API_BASE}/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      const updated = (await res.json()) as Device
      db = db.map(d => (d.id === id ? updated : d))
      saveStoredDevices(db)
      return updated
    }
  } catch (err) {
    console.warn('Backend API unavailable, falling back to local update', err)
  }

  await delay()
  const current = db.find(d => d.id === id)
  if (!current) return null
  const next: RawDevice = { ...current, ...patch }

  if (next.x === undefined || next.y === undefined) {
    const others = db.filter((d): d is Device =>
      d.id !== id && d.x !== undefined && d.y !== undefined,
    )
    const spot = pickFreeSpot(others, next.floor)
    next.x = spot.x
    next.y = spot.y
  }

  const updatedDevice: Device = { ...next, x: next.x, y: next.y, locked: next.locked ?? true }
  db = db.map(d => (d.id === id ? updatedDevice : d))
  saveStoredDevices(db)
  return updatedDevice
}

export async function deleteDevice(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/devices/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      db = db.filter(d => d.id !== id)
      saveStoredDevices(db)
      return true
    }
  } catch (err) {
    console.warn('Backend API unavailable, falling back to local delete', err)
  }

  await delay()
  const before = db.length
  db = db.filter(d => d.id !== id)
  saveStoredDevices(db)
  return db.length < before
}

export async function resetDevices(): Promise<Device[]> {
  try {
    const res = await fetch(`${API_BASE}/reset`, {
      method: 'POST',
    })
    if (res.ok) {
      return await fetchDevices()
    }
  } catch (err) {
    console.warn('Backend API unavailable, falling back to local reset', err)
  }

  await delay()
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // ignore
  }
  const devices = normalizeDevices(ALL_DEVICES.map(d => ({ ...d })))
  db = devices
  saveStoredDevices(db)
  return devices.map(d => ({ ...d }))
}

export async function clearDevices(): Promise<Device[]> {
  try {
    const res = await fetch(`${API_BASE}/clear`, {
      method: 'POST',
    })
    if (res.ok) {
      db = []
      saveStoredDevices(db)
      return []
    }
  } catch (err) {
    console.warn('Backend API unavailable, falling back to local clear', err)
  }

  await delay()
  db = []
  saveStoredDevices(db)
  return []
}

export async function connectDevice(id: string): Promise<ConnectResult> {
  try {
    const res = await fetch(`${API_BASE}/devices/${id}/connect`, {
      method: 'POST',
    })
    if (res.ok) {
      const result = (await res.json()) as ConnectResult
      if (result.success) {
        db = db.map(d => (d.id === id ? { ...d, status: result.status } : d))
        saveStoredDevices(db)
      }
      return result
    }
  } catch (err) {
    console.warn('Backend API unavailable for connect', err)
  }

  // Local fallback: simulate ping check
  await delay()
  const dev = db.find(d => d.id === id)
  if (!dev) return { device_id: id, success: false, status: 'offline', message: 'Device not found' }
  const reachable = !dev.name.toLowerCase().includes('fail')
  const newStatus: DeviceStatus = reachable ? 'online' : 'offline'
  db = db.map(d => (d.id === id ? { ...d, status: newStatus } : d))
  saveStoredDevices(db)
  return {
    device_id: id,
    success: reachable,
    status: newStatus,
    message: reachable ? 'Connected successfully (Local Simulation)' : 'Connection timed out',
  }
}

export async function checkBackendHealth(): Promise<{ online: boolean; db: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      const data = await res.json()
      return { online: true, db: Boolean(data.db) }
    }
  } catch {
    // Backend is offline
  }
  return { online: false, db: false }
}

export async function fetchLocalNetworkInfo(): Promise<LocalNetworkInfo> {
  try {
    const res = await fetch(`${API_BASE}/discovery/local-info`)
    if (res.ok) {
      return (await res.json()) as LocalNetworkInfo
    }
  } catch (err) {
    console.warn('Backend local-info unavailable, using fallback', err)
  }
  return {
    local_ip: '192.168.22.60',
    detected_subnet: '192.168.22.0/24',
    gateway: '192.168.22.254',
  }
}

export async function scanNetwork(
  cidr = 'auto',
  community = '',
  snmp_port = 161,
  scan_mode?: 'quick' | 'full',
  floor_split_ip = 120,
): Promise<DiscoveredDevice[]> {
  const buildingBounds = getStoredBuildingBounds()
  const floorRooms = {
    1: getStoredRooms(1),
    2: getStoredRooms(2),
  }
  try {
    const res = await fetch(`${API_BASE}/discovery/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cidr,
        community: community.trim() || undefined,
        snmp_port,
        scan_mode: scan_mode || 'quick',
        floor_split_ip,
        building_bounds: buildingBounds,
        auto_assign_gps: true,
        floor_rooms: floorRooms,
      }),
    })
    if (res.ok) {
      return (await res.json()) as DiscoveredDevice[]
    }
  } catch (err) {
    console.warn('Backend API unavailable for discovery scan', err)
  }

  // Local fallback simulation with dynamic georeferencing
  await delay()
  const base = cidr && cidr !== 'auto' ? cidr.split('/')[0].split('.').slice(0, 3).join('.') : '192.168.22'
  const existingIps = new Set(db.map(d => d.ip).filter(Boolean))

  const swCoords = canvasToGps(272, 52, buildingBounds)
  const rtrCoords = canvasToGps(320, 52, buildingBounds)
  const apCoords = canvasToGps(100, 52, buildingBounds)

  const f1Rooms = floorRooms[1]
  const f2Rooms = floorRooms[2]
  const swRoom = f1Rooms.find(r => /core|switch|server/i.test(r.label))?.label || f1Rooms[0]?.label || undefined
  const rtrRoom = f1Rooms.find(r => /core|network|router/i.test(r.label))?.label || f1Rooms[0]?.label || undefined
  const apRoom = f2Rooms.find(r => /office|ap|zone/i.test(r.label))?.label || f2Rooms[0]?.label || undefined

  return [
    {
      ip: `${base}.254`,
      hostname: 'Switch-Core',
      sys_descr: `Aruba JL261A 2930F-24G-PoE+-4SFP Switch [geo:${swCoords[0]},${swCoords[1]}]`,
      dtype: 'switch',
      snmp_ok: true,
      response_time_ms: 12.4,
      already_exists: existingIps.has(`${base}.254`),
      target_room: swRoom,
      preview_x: 272,
      preview_y: 52,
      confidence: 99,
      reason: 'SNMP L2/L3 Bridge + Aruba OUI + TTL 255',
      detected_floor: 1,
      floor_reason: swRoom ? `Core Switch -> ชั้น 1 (${swRoom})` : 'Core Switch -> ชั้น 1',
      mac: '8c-85-c1-83-92-e0',
      latitude: swCoords[0],
      longitude: swCoords[1],
      gps_source: 'sys_descr',
    },
    {
      ip: `${base}.1`,
      hostname: 'RTR-BORDER',
      sys_descr: `Cisco ISR 4451-X Enterprise Router [geo:${rtrCoords[0]},${rtrCoords[1]}]`,
      dtype: 'router',
      snmp_ok: true,
      response_time_ms: 15.8,
      already_exists: existingIps.has(`${base}.1`),
      target_room: rtrRoom,
      preview_x: 320,
      preview_y: 52,
      confidence: 95,
      reason: 'Default Gateway + Cisco OUI + TTL 255',
      detected_floor: 1,
      floor_reason: 'Gateway IP .1 -> ชั้น 1',
      mac: '54-ef-44-4f-cb-0c',
      latitude: rtrCoords[0],
      longitude: rtrCoords[1],
      gps_source: 'sys_descr',
    },
    {
      ip: `${base}.135`,
      hostname: 'AP-FL2-OFFICE',
      sys_descr: `Cisco Catalyst 9120AX Series Wi-Fi 6 AP [geo:${apCoords[0]},${apCoords[1]},314.5;fl:2]`,
      dtype: 'ap',
      snmp_ok: false,
      response_time_ms: 8.2,
      already_exists: existingIps.has(`${base}.135`),
      target_room: apRoom,
      preview_x: 100,
      preview_y: 52,
      confidence: 98,
      reason: 'Ubiquiti/Cisco AP OUI + TTL 64',
      detected_floor: 2,
      floor_reason: 'GPS Alt 314.5m (+3.5m เหนือพื้น) -> ชั้น 2',
      mac: 'e8-fd-f8-01-e0-5c',
      latitude: apCoords[0],
      longitude: apCoords[1],
      altitude: 314.5,
      gps_source: 'sys_descr',
    },
  ]
}

export async function importDiscoveredDevices(
  devices: Array<{
    name: string
    ip: string
    dtype: DeviceType
    floor: 1 | 2
    x?: number
    y?: number
    model?: string
    community?: string | null
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
    target_room?: string
  }>,
): Promise<Device[]> {
  // Deduplication check
  const existingIps = new Set(db.map(d => d.ip).filter(Boolean))
  const existingNames = new Set(db.map(d => d.name.toLowerCase()))
  const deduplicated = devices.filter(d => !existingIps.has(d.ip) && !existingNames.has(d.name.toLowerCase()))

  if (deduplicated.length === 0) return []

  try {
    const res = await fetch(`${API_BASE}/discovery/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devices: deduplicated }),
    })
    if (res.ok) {
      const imported = (await res.json()) as Device[]
      db = [...db, ...imported]
      saveStoredDevices(db)
      return imported
    }
  } catch (err) {
    console.warn('Backend API unavailable for import', err)
  }

  // Local fallback
  const importedList: Device[] = []
  for (const item of deduplicated) {
    const dev = await createDevice({ ...item, status: 'online' })
    dev.status = 'online'
    importedList.push(dev)
  }
  return importedList
}

// ── Alerts API ──────────────────────────────────────────

export async function fetchAlerts(deviceId?: string): Promise<Alert[]> {
  try {
    const url = deviceId ? `${API_BASE}/devices/${deviceId}/alerts` : `${API_BASE}/alerts`
    const res = await fetch(url)
    if (res.ok) {
      const data = (await res.json()) as Array<{
        id: number
        device_id: string
        severity: 'info' | 'warn' | 'crit'
        icon: string
        title: string
        description?: string
        created_at: string
        acknowledged: boolean
      }>
      return data.map(item => ({
        id: item.id,
        deviceId: item.device_id,
        severity: item.severity,
        icon: item.icon,
        title: item.title,
        description: item.description,
        createdAt: item.created_at,
        acknowledged: item.acknowledged,
      }))
    }
  } catch (err) {
    console.warn('Backend API unavailable for alerts', err)
  }
  return []
}

export async function acknowledgeAlert(alertId: number | string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/alerts/${alertId}/ack`, { method: 'POST' })
    return res.ok
  } catch (err) {
    console.warn('Backend API unavailable for acknowledgeAlert', err)
    return false
  }
}

// ── Real SNMP Traffic & Interfaces API ──────────────────

export async function fetchDeviceInterfaces(deviceId: string): Promise<InterfaceTrafficItem[]> {
  try {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/interfaces`)
    if (res.ok) {
      return (await res.json()) as InterfaceTrafficItem[]
    }
  } catch (err) {
    console.warn(`Failed to fetch interfaces for device ${deviceId}`, err)
  }
  return []
}

export async function pollDeviceTraffic(deviceId: string): Promise<PollTrafficResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/poll-traffic`, { method: 'POST' })
    if (res.ok) {
      return (await res.json()) as PollTrafficResponse
    }
  } catch (err) {
    console.warn(`Failed to poll traffic for device ${deviceId}`, err)
  }
  return null
}

export async function fetchDeviceTraffic(
  deviceId: string,
  interfaceId = 'all',
  range = '15m',
): Promise<TrafficSeries | null> {
  try {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/traffic?interface_id=${encodeURIComponent(interfaceId)}&range=${encodeURIComponent(range)}`)
    if (res.ok) {
      const data = await res.json()
      return {
        inbound: data.inbound || [],
        outbound: data.outbound || [],
        labels: data.labels || [],
        peak: data.peak || 0,
        avg: data.avg || 0,
        hasSnmp: data.has_snmp ?? true,
        interfaceId: data.interface_id || interfaceId,
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch traffic series for device ${deviceId}`, err)
  }
  return null
}
