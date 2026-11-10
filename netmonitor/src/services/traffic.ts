import type { DeviceStatus, DeviceType, TimeRange, TrafficSeries } from '../types'
import { createRng, hashString } from './random'

// ─────────────────────────────────────────────
// สร้างกราฟ traffic mock ต่อ device/ช่วงเวลา
// ─────────────────────────────────────────────

export const TYPE_MAX_MBPS: Record<DeviceType, number> = {
  switch: 1000, router: 1000, ap: 300, server: 1000,
}

const POINT_COUNT: Record<TimeRange, number> = {
  '15m': 60, '1h': 60, '6h': 36, '24h': 48, '7d': 56,
}

const RANGE_LABELS: Record<TimeRange, string[]> = {
  '15m': ['-15m', '-10m', '-5m', 'now'],
  '1h':  ['-60m', '-40m', '-20m', 'now'],
  '6h':  ['-6h', '-4h', '-2h', 'now'],
  '24h': ['-24h', '-16h', '-8h', 'now'],
  '7d':  ['-7d', '-5d', '-3d', 'now'],
}

// ชุดช่วงเวลากลาง — ใช้ร่วมกันทั้งหน้ารายละเอียดและ more-info modal
export const TIME_RANGES: TimeRange[] = ['15m', '1h', '6h', '24h', '7d']

export function createEmptyTrafficSeries(range: TimeRange): TrafficSeries {
  const n = POINT_COUNT[range] || 60
  const labels = RANGE_LABELS[range] || ['-15m', '-10m', '-5m', 'now']
  return {
    inbound: Array.from({ length: n }, () => 0),
    outbound: Array.from({ length: n }, () => 0),
    labels,
    peak: 0,
    avg: 0,
  }
}

function walk(
  rng: () => number,
  n: number,
  center: number,
  amp: number,
  noise: number,
  max: number,
  waves: number,
): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const wave = Math.sin((i / Math.max(n - 1, 1)) * Math.PI * 2 * waves)
    const v = center + amp * wave + (rng() - 0.5) * noise
    out.push(Math.round(Math.max(0, Math.min(max, v))))
  }
  return out
}

function rotate(values: number[], k: number): number[] {
  if (k === 0) return values
  return [...values.slice(k), ...values.slice(0, k)]
}

export function generateTraffic(
  seed: number,
  status: DeviceStatus,
  range: TimeRange,
  maxMbps: number,
  tick = 0,
): TrafficSeries {
  const n = POINT_COUNT[range]
  const labels = RANGE_LABELS[range]
  // seed ผูกกับ range ด้วย — '15m' และ '1h' มีจำนวนจุดเท่ากัน (60)
  // ถ้า seed ด้วย n เพียงอย่างเดียวสองช่วงนี้จะได้รูปกราฟซ้ำกัน
  const rng = createRng(seed ^ hashString(range) ^ (n << 16))

  if (status === 'offline') {
    return {
      inbound: Array.from({ length: n }, () => 0),
      outbound: Array.from({ length: n }, () => 0),
      labels, peak: 0, avg: 0,
    }
  }

  const load = status === 'warning' ? 1.3 : 1
  const centerIn  = maxMbps * 0.32 * load * (0.7 + rng() * 0.6)
  const centerOut = maxMbps * 0.22 * load * (0.7 + rng() * 0.6)
  const waves = range === '7d' ? 6 : range === '24h' ? 3 : range === '15m' ? 1 : 1.5

  const rawIn  = walk(rng, n, centerIn,  centerIn  * 0.35, centerIn  * 0.5, maxMbps * 0.92, waves)
  const rawOut = walk(rng, n, centerOut, centerOut * 0.30, centerOut * 0.5, maxMbps * 0.92, waves)

  // จำลองเวลาเดิน: เลื่อนกราฟไปตาม tick ให้ดูเหมือน real-time
  const shift = tick > 0 ? tick % n : 0
  const inbound = rotate(rawIn, shift)
  const outbound = rotate(rawOut, shift)

  const peak = Math.max(...inbound, ...outbound)
  const avg = Math.round(
    (inbound.reduce((s, v) => s + v, 0) / n + outbound.reduce((s, v) => s + v, 0) / n) / 2,
  )

  return { inbound, outbound, labels, peak, avg }
}
