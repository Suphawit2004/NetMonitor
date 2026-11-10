import type {
  Alert, Device, DeviceDetail, DeviceType, MetricValue, Port, PortStatus,
} from '../types'
import { getStoredRooms } from './roomStore'
import { createRng, hashString, pick, randInt, vary } from './random'

// ─────────────────────────────────────────────
// สร้าง DeviceDetail ต่ออุปกรณ์แบบ deterministic
// (seed จาก device.id → ข้อมูลเดิมเสมอสำหรับอุปกรณ์เดียวกัน)
// ─────────────────────────────────────────────

const IOS_VERSIONS: Record<DeviceType, string[]> = {
  switch: ['17.9.4a', '17.6.5', '16.12.8', '15.2.7E10'],
  router: ['17.9.4a', '17.3.6', '16.9.6'],
  ap:     ['8.10.162.0', '8.8.125.0', '17.9.3'],
  server: ['iDRAC 7.10.30', 'iDRAC 6.10.80', 'iLO 6 v1.60'],
}

export const VLAN_NAMES: Record<string, string> = {
  'VLAN 1':  'Management / Trunk',
  'VLAN 10': 'Office',
  'VLAN 20': 'Wireless',
  'VLAN 30': 'Server',
}

// ── helpers ─────────────────────────────────

// จำนวน uplink ของแต่ละประเภทอุปกรณ์ (ใช้สร้าง peer ของพอร์ต)
const UPLINK_COUNT: Record<DeviceType, number> = {
  switch: 4, router: 3, ap: 1, server: 2,
}

function nearestPeers(device: Device, all: Device[], count: number): Device[] {
  return all
    .filter(d => d.id !== device.id && d.floor === device.floor)
    .map(d => ({ d, dist: (d.x - device.x) ** 2 + (d.y - device.y) ** 2 }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map(p => p.d)
}

function vlanForPeer(peer: Device): string {
  if (peer.dtype === 'ap') return 'VLAN 20'
  if (peer.dtype === 'server') return 'VLAN 30'
  return 'VLAN 1'
}

function locateRoom(device: Device): { floor: 1 | 2; room: string | null } {
  const rooms = getStoredRooms(device.floor)
  const room = rooms.find(r =>
    device.x >= r.left && device.x <= r.left + r.width &&
    device.y >= r.top  && device.y <= r.top + r.height,
  )
  return { floor: device.floor, room: room?.label ?? null }
}

function buildMac(rng: () => number): string {
  const hex = () => randInt(rng, 0, 255).toString(16).toUpperCase().padStart(2, '0')
  return `00:1A:2B:${hex()}:${hex()}:${hex()}`
}

function metric(value: number, delta: number, suffix: string, higherIsWorse: boolean): MetricValue {
  if (delta === 0) return { value, change: `— 0${suffix}`, tone: 'neutral' }
  const up = delta > 0
  return {
    value,
    change: `${up ? '▲' : '▼'} ${up ? '+' : '-'}${Math.abs(delta)}${suffix}`,
    tone: up === higherIsWorse ? 'bad' : 'good',
  }
}

// ── ports ────────────────────────────────────

function buildPorts(device: Device, all: Device[], rng: () => number): Port[] {
  const offline = device.status === 'offline'
  const ports: Port[] = []
  const up = (): PortStatus => (offline ? 'down' : 'up')

  if (device.dtype === 'switch') {
    const total = rng() < 0.5 ? 24 : 48
    let n = 0

    for (const peer of nearestPeers(device, all, UPLINK_COUNT.switch)) {
      n += 1
      ports.push({
        num: `Gi${n}`,
        status: up(),
        name: peer.name,
        vlan: vlanForPeer(peer),
        speed: pick(rng, ['1G', '10G', '1G']),
        peerId: peer.id,
        utilization: offline ? 0 : randInt(rng, 8, 92),
      })
    }

    const hosts = randInt(rng, 5, 9)
    for (let i = 0; i < hosts && n < total - 1; i++) {
      n += 1
      const down = offline || rng() < 0.15
      ports.push({
        num: `Gi${n}`,
        status: down ? 'down' : 'up',
        name: '',
        nameKey: down ? 'port.noConnection' : undefined,
        vlan: down ? '' : 'VLAN 10',
        speed: pick(rng, ['100M', '1G', '1G']),
        utilization: down ? 0 : randInt(rng, 2, 45),
      })
    }

    for (; n < total - 1; n++) {
      ports.push({
        num: `Gi${n + 1}`,
        status: 'down',
        name: '',
        nameKey: 'port.noConnection',
        vlan: '',
        speed: '1G',
        utilization: 0,
      })
    }
    ports.push({ num: `Gi${total}`, status: 'disabled', name: '', nameKey: 'port.spare', vlan: '', speed: '1G' })
    return ports
  }

  if (device.dtype === 'router') {
    const peers = nearestPeers(device, all, 2)
    peers.forEach((peer, i) => {
      ports.push({
        num: `Gi0/${i}`,
        status: up(),
        name: peer.name,
        vlan: vlanForPeer(peer),
        speed: '1G',
        peerId: peer.id,
        utilization: offline ? 0 : randInt(rng, 10, 85),
      })
    })
    ports.push({
      num: 'Gi0/2',
      status: offline ? 'down' : 'up',
      name: 'ISP – WAN',
      vlan: '',
      speed: '1G',
      utilization: offline ? 0 : randInt(rng, 15, 80),
    })
    ports.push({ num: 'Gi0/3', status: 'disabled', name: '', nameKey: 'port.spare', vlan: '', speed: '1G' })
    return ports
  }

  if (device.dtype === 'ap') {
    const [uplink] = nearestPeers(device, all, 1)
    ports.push({
      num: 'eth0',
      status: offline ? 'down' : 'up',
      name: uplink ? uplink.name : 'Uplink',
      vlan: 'VLAN 1',
      speed: '1G',
      peerId: uplink?.id,
      utilization: offline ? 0 : randInt(rng, 5, 60),
    })
    ports.push({
      num: 'wlan0',
      status: offline ? 'down' : 'up',
      name: 'Radio 5GHz (Corp-WiFi)',
      vlan: 'VLAN 20',
      speed: '867M',
      utilization: offline ? 0 : randInt(rng, 10, 88),
    })
    return ports
  }

  // server
  const peers = nearestPeers(device, all, 2)
  ports.push({
    num: 'eno1',
    status: up(),
    name: peers[0]?.name ?? 'Switch',
    vlan: 'VLAN 30',
    speed: '10G',
    peerId: peers[0]?.id,
    utilization: offline ? 0 : randInt(rng, 10, 70),
  })
  ports.push({
    num: 'eno2',
    status: up(),
    name: peers[1]?.name ?? 'Switch 2',
    vlan: 'VLAN 30',
    speed: '10G',
    peerId: peers[1]?.id,
    utilization: offline ? 0 : randInt(rng, 10, 70),
  })
  ports.push({ num: 'eno3', status: 'disabled', name: '', nameKey: 'port.spareBond', vlan: '', speed: '25G' })
  ports.push({ num: 'eno4', status: 'down', name: '', nameKey: 'port.noConnection', vlan: '', speed: '25G', utilization: 0 })
  return ports
}

// ── metrics ──────────────────────────────────

function buildMetrics(device: Device, rng: () => number) {
  const cpu: MetricValue = device.status === 'online'
    ? metric(randInt(rng, 12, 55), randInt(rng, -6, 6), '%', true)
    : device.status === 'warning'
      ? metric(randInt(rng, 60, 88), randInt(rng, 0, 8), '%', true)
      : { value: 0, change: '—', tone: 'neutral' }

  const memory: MetricValue = device.status === 'online'
    ? metric(randInt(rng, 35, 70), randInt(rng, -5, 5), '%', true)
    : device.status === 'warning'
      ? metric(randInt(rng, 65, 88), randInt(rng, 0, 6), '%', true)
      : { value: 0, change: '—', tone: 'neutral' }

  const temperature: MetricValue = device.status === 'online'
    ? metric(randInt(rng, 38, 52), randInt(rng, -2, 2), '°C', true)
    : device.status === 'warning'
      ? metric(randInt(rng, 50, 58), randInt(rng, 0, 3), '°C', true)
      : { value: 0, change: '—', tone: 'neutral' }

  const ping: MetricValue =
    device.status === 'offline'
      ? { value: 0, change: 'Timeout', tone: 'bad' }
      : device.status === 'warning'
        ? metric(randInt(rng, 35, 75), randInt(rng, 1, 8), 'ms', true)
        : metric(randInt(rng, 2, 14), randInt(rng, -1, 1), 'ms', true)

  const packetLoss: MetricValue =
    device.status === 'offline'
      ? { value: 100, change: '—', tone: 'neutral' }
      : device.status === 'warning'
        ? metric(+(0.5 + rng() * 1.5).toFixed(1), 0.1, '%', true)
        : rng() < 0.7
          ? { value: 0, change: '— 0%', tone: 'neutral' }
          : metric(0.1, 0.1, '%', true)

  return { ping, cpu, memory, temperature, packetLoss }
}

// ── alerts ───────────────────────────────────

// จำนวนนาทีที่ผ่านมา (deterministic ต่อชนิด alert) — แปลงเป็นข้อความตอน render ด้วย formatTimeAgo
const TIME_AGO_MIN = [2, 15, 60, 180, 1440] as const

function buildAlerts(
  device: Device,
  ports: Port[],
  temperature: MetricValue,
): Alert[] {
  const alerts: Alert[] = []

  if (device.status === 'offline') {
    alerts.push({
      id: `${device.id}-crit1`, icon: '',
      messageKey: 'alerts.deviceNoResponse',
      timeMinutesAgo: 5, severity: 'crit',
    })
    alerts.push({
      id: `${device.id}-crit2`, icon: '',
      messageKey: 'alerts.uplinkDown',
      timeMinutesAgo: 5, severity: 'crit',
    })
  }

  if (device.status === 'warning') {
    const busy = [...ports]
      .filter(p => p.status === 'up')
      .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0]
    if (busy) {
      alerts.push({
        id: `${device.id}-w1`, icon: '',
        messageKey: 'alerts.portUtilization',
        params: { num: busy.num, name: busy.name, pct: busy.utilization ?? 0 },
        timeMinutesAgo: TIME_AGO_MIN[0], severity: 'warn',
      })
    }
    alerts.push({
      id: `${device.id}-w2`, icon: '',
      messageKey: 'alerts.tempNearLimit',
      params: { value: temperature.value },
      timeMinutesAgo: TIME_AGO_MIN[1], severity: 'warn',
    })
  }

  if (device.status !== 'offline') {
    const downPort = ports.find(p => p.peerId && p.status === 'down')
    if (downPort) {
      alerts.push({
        id: `${device.id}-i1`, icon: '',
        messageKey: 'alerts.portLinkDown',
        params: { num: downPort.num, name: downPort.name || downPort.num },
        timeMinutesAgo: TIME_AGO_MIN[2], severity: 'info',
      })
    }
    if (device.status === 'online') {
      alerts.push({
        id: `${device.id}-i2`, icon: '',
        messageKey: 'alerts.backupSuccess',
        timeMinutesAgo: TIME_AGO_MIN[3], severity: 'info',
      })
      alerts.push({
        id: `${device.id}-i3`, icon: '',
        messageKey: 'alerts.firmwareUpdate',
        timeMinutesAgo: TIME_AGO_MIN[4], severity: 'info',
      })
    }
  }

  return alerts
}

// ── main ─────────────────────────────────────

export function buildDeviceDetail(device: Device, allDevices: Device[], tick = 0): DeviceDetail {
  const rng = createRng(hashString(device.id))
  const phase = (hashString(device.id) % 100) * 0.09

  const ports = buildPorts(device, allDevices, rng).map((p, i) =>
    tick > 0 && p.status === 'up' && (p.utilization ?? 0) > 0
      ? { ...p, utilization: vary(p.utilization ?? 0, tick, i * 1.7, 15) }
      : p,
  )

  const base = buildMetrics(device, rng)
  const ping: MetricValue = {
    ...base.ping,
    value: device.status === 'offline'
      ? 0
      : Math.max(1, vary(base.ping.value, tick, phase + 3.8, 1.5)),
  }
  const cpu: MetricValue = { ...base.cpu, value: vary(base.cpu.value, tick, phase, 4) }
  const memory: MetricValue = { ...base.memory, value: vary(base.memory.value, tick, phase + 1.3, 3) }
  const temperature: MetricValue = { ...base.temperature, value: vary(base.temperature.value, tick, phase + 2.6, 1.5) }
  const packetLoss = base.packetLoss

  const uptime = device.status === 'offline'
    ? '—'
    : device.status === 'warning'
      ? `${randInt(rng, 1, 21)}d ${randInt(rng, 0, 23)}h`
      : `${randInt(rng, 5, 140)}d ${randInt(rng, 0, 23)}h`

  const mac = buildMac(rng)
  const iosVersion = pick(rng, IOS_VERSIONS[device.dtype])
  const vlanCount = new Set(
    ports.map(p => p.vlan).filter((v): v is string => !!v),
  ).size

  return {
    device,
    uptime,
    mac,
    iosVersion,
    location: locateRoom(device),
    portsUsed: ports.filter(p => p.status === 'up').length,
    portsTotal: ports.length,
    vlanCount: Math.max(vlanCount, 1),
    ping,
    cpu,
    memory,
    temperature,
    packetLoss,
    ports,
    alerts: buildAlerts(device, ports, temperature),
  }
}
