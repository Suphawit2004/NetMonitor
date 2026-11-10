// ─────────────────────────────────────────────
// Core domain types
// ─────────────────────────────────────────────

export type DeviceStatus = 'online' | 'warning' | 'offline'
export type DeviceType   = 'switch' | 'ap' | 'router' | 'server'
export type PortStatus   = 'up' | 'down' | 'disabled'
export type AlertSeverity = 'warn' | 'info' | 'crit'
export type TimeRange    = '15m' | '1h' | '6h' | '24h' | '7d'
export type MetricTone   = 'good' | 'bad' | 'neutral'

export interface Device {
  id: string
  name: string
  dtype: DeviceType
  status: DeviceStatus
  floor: 1 | 2
  x: number
  y: number
  locked?: boolean   // ← ล็อคตำแหน่ง ไม่ให้ลาก
  ip?: string
  model?: string
  latitude?: number | null
  longitude?: number | null
  altitude?: number | null
  gps_source?: string | null
}

// รูปแบบอุปกรณ์จาก backend — พิกัดอาจยังไม่ถูกระบุตอนเชื่อมเครื่อง
// (services/api.ts จะ auto-place ให้ก่อน ผู้ใช้ลากแก้ได้ภายหลัง)
export interface RawDevice extends Omit<Device, 'x' | 'y'> {
  x?: number
  y?: number
  latitude?: number | null
  longitude?: number | null
  altitude?: number | null
  gps_source?: string | null
}

export interface DiscoveredDevice {
  ip: string
  hostname?: string
  sys_descr?: string
  dtype: DeviceType
  snmp_ok: boolean
  community?: string | null
  response_time_ms: number
  already_exists: boolean
  target_room?: string
  preview_x?: number
  preview_y?: number
  confidence?: number
  reason?: string
  detected_floor?: 1 | 2
  floor_reason?: string
  mac?: string
  latitude?: number | null
  longitude?: number | null
  altitude?: number | null
  gps_source?: string | null
}

export interface ConnectResult {
  device_id: string
  success: boolean
  status: DeviceStatus
  message: string
  sys_uptime?: string
}

export interface LocalNetworkInfo {
  local_ip: string
  detected_subnet: string
  gateway?: string
  wifi_ssid?: string
  wifi_bssid?: string
  wifi_signal?: string
}

export interface Room {
  label: string
  left: number
  top: number
  width: number
  height: number
  type?: 'room' | 'stairs' | 'restroom' | 'server'
  connectsToFloor?: 1 | 2
}

export interface Port {
  num: string
  status: PortStatus
  name: string
  nameKey?: string      // ← ถ้ามี ให้แสดง t(nameKey) แทน name (ข้อความ placeholder)
  vlan?: string
  speed?: string
  peerId?: string       // ← อุปกรณ์ปลายทาง (ถ้าเชื่อมกับอุปกรณ์ที่รู้จัก)
  utilization?: number  // ← % การใช้งาน (0-100)
}

export interface Alert {
  id: string | number
  deviceId?: string
  icon: string
  messageKey?: string                          // ← i18n key แปลตอน render (ถ้ามี)
  title?: string                               // ← ข้อความหัวข้อตรง (ถ้ามาจาก backend DB)
  description?: string                         // ← คำอธิบายเพิ่มเติม
  params?: Record<string, string | number>    // ← ค่า interpolate ในข้อความ
  timeMinutesAgo?: number                      // ← เวลา relative → formatTimeAgo ตอน render
  createdAt?: string                           // ← ISO timestamp จากฐานข้อมูล
  severity: AlertSeverity
  acknowledged?: boolean
}

export interface MetricValue {
  value: number
  change?: string            // เช่น '▲ +4%' | '▼ -2%' | '—'
  tone?: MetricTone          // good = ดีขึ้น, bad = แย่ลง
}

export interface DeviceDetail {
  device: Device
  uptime: string
  mac: string
  iosVersion: string
  location: { floor: 1 | 2; room: string | null }
  portsUsed: number
  portsTotal: number
  vlanCount: number
  ping: MetricValue
  cpu: MetricValue
  memory: MetricValue
  temperature: MetricValue
  packetLoss: MetricValue
  ports: Port[]
  alerts: Alert[]
}

export interface TrafficSeries {
  inbound: number[]
  outbound: number[]
  labels: string[]
  peak: number   // Mbps
  avg: number    // Mbps
  hasSnmp?: boolean
  interfaceId?: string
  isInitialLoading?: boolean
  isRefreshing?: boolean
}

export interface InterfaceTrafficItem {
  id: number
  if_index: number
  name: string
  description?: string
  speed_bps?: number
  oper_status?: string
  in_mbps: number
  out_mbps: number
}

export interface PollTrafficResponse {
  success: boolean
  has_snmp: boolean
  interfaces_polled: number
  total_in_mbps: number
  total_out_mbps: number
  timestamp: string
  interfaces: InterfaceTrafficItem[]
}
