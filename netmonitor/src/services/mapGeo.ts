import type { Room } from '../types'

export const PLAN_W = 900
export const PLAN_H = 600

// พิกัดค่าเริ่มต้นตามสถานที่ตั้งจริงของอุปกรณ์และเครือข่าย: 18.70320, 98.90928
export const DEFAULT_LAT = 18.70320
export const DEFAULT_LON = 98.90928

// ขนาดเริ่มต้นตามหลังคาอาคารจริง (LAT_SPAN: ~22.3m, LON_SPAN: ~36.8m)
export const LAT_SPAN = 0.000200
export const LON_SPAN = 0.000350

export type CornerCoords = [number, number] // [lat, lon]

export interface BuildingCorners {
  nw: CornerCoords // บนซ้าย (North-West)
  ne: CornerCoords // บนขวา (North-East)
  se: CornerCoords // ล่างขวา (South-East)
  sw: CornerCoords // ล่างซ้าย (South-West)
}

export interface BuildingBounds {
  north: number
  south: number
  west: number
  east: number
  corners?: BuildingCorners // 4 จุดมุมอิสระ (เอียง หมุน หรือบิดทรงตามหลังคาอาคารจริงได้ ไม่จำเป็นต้องตั้งฉาก 90 องศา)
}

/**
 * ดึงพิกัด 4 มุมของอาคาร (หากยังไม่มี ให้สร้างจากกรอบ North/South/West/East เดิม)
 */
export function getBuildingCorners(bounds: BuildingBounds): BuildingCorners {
  if (
    bounds.corners &&
    Array.isArray(bounds.corners.nw) &&
    Array.isArray(bounds.corners.ne) &&
    Array.isArray(bounds.corners.se) &&
    Array.isArray(bounds.corners.sw)
  ) {
    return bounds.corners
  }
  return {
    nw: [bounds.north, bounds.west],
    ne: [bounds.north, bounds.east],
    se: [bounds.south, bounds.east],
    sw: [bounds.south, bounds.west],
  }
}

/**
 * คำนวณระยะห่างระหว่างจุด GPS 2 จุดในหน่วยเมตร (Haversine/Flat earth approximation)
 */
export function gpsDistanceMeters(p1: [number, number], p2: [number, number]): number {
  const dLat = (p2[0] - p1[0]) * 111320
  const midLat = (p1[0] + p2[0]) / 2
  const dLon = (p2[1] - p1[1]) * 111320 * Math.cos((midLat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLon * dLon)
}

/**
 * หมุนพิกัด 4 มุมรอบจุดกึ่งกลางอาคารด้วยมุม deltaDegrees (+ หรือ -)
 */
export function rotateCorners(corners: BuildingCorners, deltaDegrees: number): BuildingCorners {
  const centerLat = (corners.nw[0] + corners.ne[0] + corners.se[0] + corners.sw[0]) / 4
  const centerLon = (corners.nw[1] + corners.ne[1] + corners.se[1] + corners.sw[1]) / 4
  const rad = (deltaDegrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cosLat = Math.cos((centerLat * Math.PI) / 180)

  function rotPoint(pt: CornerCoords): CornerCoords {
    const dLat = pt[0] - centerLat
    const dLon = (pt[1] - centerLon) * cosLat
    const rLat = dLat * cos - dLon * sin
    const rLon = (dLat * sin + dLon * cos) / cosLat
    return [
      Number((centerLat + rLat).toFixed(7)),
      Number((centerLon + rLon).toFixed(7)),
    ]
  }

  return {
    nw: rotPoint(corners.nw),
    ne: rotPoint(corners.ne),
    se: rotPoint(corners.se),
    sw: rotPoint(corners.sw),
  }
}

/**
 * คืนค่ามุมอาคารให้กลับเป็นสี่เหลี่ยมผืนผ้าตั้งฉาก 90 องศาตามแนวแกนหลัก
 */
export function resetCornersToOrthogonal(corners: BuildingCorners): BuildingCorners {
  const centerLat = (corners.nw[0] + corners.ne[0] + corners.se[0] + corners.sw[0]) / 4
  const centerLon = (corners.nw[1] + corners.ne[1] + corners.se[1] + corners.sw[1]) / 4
  const wMeters = (gpsDistanceMeters(corners.nw, corners.ne) + gpsDistanceMeters(corners.sw, corners.se)) / 2
  const hMeters = (gpsDistanceMeters(corners.nw, corners.sw) + gpsDistanceMeters(corners.ne, corners.se)) / 2
  const halfLatSpan = (hMeters / 2) / 111320
  const halfLonSpan = (wMeters / 2) / (111320 * Math.cos((centerLat * Math.PI) / 180))
  return {
    nw: [Number((centerLat + halfLatSpan).toFixed(7)), Number((centerLon - halfLonSpan).toFixed(7))],
    ne: [Number((centerLat + halfLatSpan).toFixed(7)), Number((centerLon + halfLonSpan).toFixed(7))],
    se: [Number((centerLat - halfLatSpan).toFixed(7)), Number((centerLon + halfLonSpan).toFixed(7))],
    sw: [Number((centerLat - halfLatSpan).toFixed(7)), Number((centerLon - halfLonSpan).toFixed(7))],
  }
}

/**
 * คำนวณขอบเขตสี่เหลี่ยมรอบตัวอาคาร (North, South, West, East) จากกึ่งกลาง
 */
export function computeBounds(
  center: [number, number],
  latSpan: number = LAT_SPAN,
  lonSpan: number = LON_SPAN
): BuildingBounds {
  const [lat, lon] = center
  const north = Number((lat + latSpan / 2).toFixed(7))
  const south = Number((lat - latSpan / 2).toFixed(7))
  const west =  Number((lon - lonSpan / 2).toFixed(7))
  const east =  Number((lon + lonSpan / 2).toFixed(7))
  return {
    north,
    south,
    west,
    east,
    corners: {
      nw: [north, west],
      ne: [north, east],
      se: [south, east],
      sw: [south, west],
    },
  }
}

// ค่าตั้งต้นสำหรับ backward compatibility
export const BUILDING_CENTER: [number, number] = [DEFAULT_LAT, DEFAULT_LON]
export const BUILDING_BOUNDS = computeBounds(BUILDING_CENTER)

/**
 * ดึงพิกัดกึ่งกลางตัวอาคารที่บันทึกไว้ หรือคืนค่าพิกัดปัจจุบันตั้งต้น
 */
export function getStoredBuildingCenter(): [number, number] {
  try {
    const saved = localStorage.getItem('netmonitor:building_center')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
        if (parsed.lat < 15.0) {
          // เคลียร์พิกัดเก่าเดิมที่เป็นกรุงเทพฯ
          localStorage.removeItem('netmonitor:building_center')
          return [DEFAULT_LAT, DEFAULT_LON]
        }
        return [Number(parsed.lat.toFixed(7)), Number(parsed.lon.toFixed(7))]
      }
    }
  } catch (e) { console.warn('mapGeo', e) }
  return [DEFAULT_LAT, DEFAULT_LON]
}

/**
 * บันทึกพิกัดกึ่งกลางตัวอาคารลง LocalStorage
 */
export function saveBuildingCenter(lat: number, lon: number): void {
  try {
    localStorage.setItem(
      'netmonitor:building_center',
      JSON.stringify({ lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)) })
    )
  } catch (e) { console.warn('mapGeo', e) }
}

/**
 * ดึงขอบเขตตัวอาคาร (BuildingBounds) ที่บันทึกไว้ หรือคำนวณจากกึ่งกลาง
 */
export function getStoredBuildingBounds(): BuildingBounds {
  try {
    const saved = localStorage.getItem('netmonitor:building_bounds')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (
        typeof parsed.north === 'number' &&
        typeof parsed.south === 'number' &&
        typeof parsed.west === 'number' &&
        typeof parsed.east === 'number' &&
        parsed.north > parsed.south &&
        parsed.east > parsed.west
      ) {
        if (parsed.north < 15.0) {
          // เคลียร์พิกัดกรอบอาคารเก่าเดิมที่เป็นกรุงเทพฯ
          localStorage.removeItem('netmonitor:building_bounds')
          localStorage.removeItem('netmonitor:building_center')
          return computeBounds(getStoredBuildingCenter())
        }
        return parsed
      }
    }
  } catch (e) { console.warn('mapGeo', e) }
  return computeBounds(getStoredBuildingCenter())
}

/**
 * บันทึกขอบเขตตัวอาคาร (BuildingBounds) ลง LocalStorage
 */
export function saveBuildingBounds(bounds: BuildingBounds): void {
  try {
    localStorage.setItem('netmonitor:building_bounds', JSON.stringify(bounds))
    // บันทึก center ควบคู่กันไป
    const centerLat = (bounds.north + bounds.south) / 2
    const centerLon = (bounds.west + bounds.east) / 2
    saveBuildingCenter(centerLat, centerLon)
  } catch (e) { console.warn('mapGeo', e) }
}

/**
 * คำนวณขนาดจริงของอาคารเป็นเมตร (Width, Height, AspectRatio)
 * และคำนวณขนาดผ้าใบ 2D Canvas (canvasW, canvasH) ให้ตรงตามสัดส่วนอาคารจริงบนแผนที่
 */
export function getBuildingRealDimensions(bounds: BuildingBounds = getStoredBuildingBounds()): {
  widthMeters: number
  heightMeters: number
  aspectRatio: number
  canvasW: number
  canvasH: number
} {
  const corners = getBuildingCorners(bounds)
  const widthMeters = Number(gpsDistanceMeters(corners.nw, corners.ne).toFixed(1))
  const heightMeters = Number(gpsDistanceMeters(corners.nw, corners.sw).toFixed(1))
  const aspectRatio = Number((widthMeters / Math.max(1, heightMeters)).toFixed(2))

  // ปรับขนาด Canvas ให้ตรงตามสัดส่วนอาคารจริง
  let canvasW: number
  let canvasH = Math.round(900 / Math.max(0.3, aspectRatio))

  canvasH = Math.max(540, Math.min(800, canvasH))
  canvasW = Math.round(canvasH * aspectRatio)
  canvasW = Math.max(840, Math.min(1200, canvasW))

  return {
    widthMeters,
    heightMeters,
    aspectRatio,
    canvasW,
    canvasH,
  }
}

/**
 * แปลงพิกัด 2D Canvas เป็นพิกัด GPS WGS84 [lat, lon]
 * รองรับการบิดเอียง หมุนองศา และสี่เหลี่ยมด้านไม่ขนาน (Bilinear 4-corner transformation)
 */
export function canvasToGps(
  x: number,
  y: number,
  target: BuildingBounds | [number, number] = getStoredBuildingBounds(),
  canvasW?: number,
  canvasH?: number
): [number, number] {
  const bounds = Array.isArray(target) ? computeBounds(target) : target
  const dims = getBuildingRealDimensions(bounds)
  const w = canvasW ?? dims.canvasW
  const h = canvasH ?? dims.canvasH
  const u = Math.max(0, Math.min(1, x / w))
  const v = Math.max(0, Math.min(1, y / h))
  const corners = getBuildingCorners(bounds)

  // Bilinear interpolation ข้าม 4 มุมอิสระ (NW, NE, SE, SW)
  const lat =
    (1 - u) * (1 - v) * corners.nw[0] +
    u * (1 - v) * corners.ne[0] +
    u * v * corners.se[0] +
    (1 - u) * v * corners.sw[0]
  const lon =
    (1 - u) * (1 - v) * corners.nw[1] +
    u * (1 - v) * corners.ne[1] +
    u * v * corners.se[1] +
    (1 - u) * v * corners.sw[1]

  return [Number(lat.toFixed(7)), Number(lon.toFixed(7))]
}

/**
 * แปลงพิกัด GPS WGS84 [lat, lon] กลับเป็นพิกัด 2D Canvas [x, y]
 * รองรับการเอียงและหมุนมุม (Affine vector projection)
 */
export function gpsToCanvas(
  lat: number,
  lon: number,
  target: BuildingBounds | [number, number] = getStoredBuildingBounds(),
  canvasW?: number,
  canvasH?: number
): [number, number] {
  const bounds = Array.isArray(target) ? computeBounds(target) : target
  const dims = getBuildingRealDimensions(bounds)
  const w = canvasW ?? dims.canvasW
  const h = canvasH ?? dims.canvasH
  const corners = getBuildingCorners(bounds)

  const vxLat = corners.ne[0] - corners.nw[0]
  const vxLon = corners.ne[1] - corners.nw[1]
  const vyLat = corners.sw[0] - corners.nw[0]
  const vyLon = corners.sw[1] - corners.nw[1]
  const det = vxLat * vyLon - vxLon * vyLat

  let u = 0.5
  let v = 0.5
  if (Math.abs(det) > 1e-13) {
    const dLat = lat - corners.nw[0]
    const dLon = lon - corners.nw[1]
    u = (dLat * vyLon - dLon * vyLat) / det
    v = (vxLat * dLon - vxLon * dLat) / det
  }

  const x = Math.round(u * w)
  const y = Math.round(v * h)
  return [
    Math.max(20, Math.min(x, w - 20)),
    Math.max(20, Math.min(y, h - 20)),
  ]
}

/**
 * คำนวณพิกัด 4 มุมของห้องบนแผนที่ (Polygon 4 จุด) รองรับการเอียงตามแนวอาคารจริง
 */
export function roomToGpsPolygon(
  room: Room,
  target: BuildingBounds | [number, number] = getStoredBuildingBounds(),
  canvasW?: number,
  canvasH?: number
): [number, number][] {
  const nw = canvasToGps(room.left, room.top, target, canvasW, canvasH)
  const ne = canvasToGps(room.left + room.width, room.top, target, canvasW, canvasH)
  const se = canvasToGps(room.left + room.width, room.top + room.height, target, canvasW, canvasH)
  const sw = canvasToGps(room.left, room.top + room.height, target, canvasW, canvasH)
  return [nw, ne, se, sw]
}

/**
 * คำนวณขอบเขต Leaflet LatLngBounds สำหรับกล่องห้องแต่ละห้อง (สำหรับ backward compatibility)
 */
export function roomToGpsBounds(
  room: Room,
  target: BuildingBounds | [number, number] = getStoredBuildingBounds(),
  canvasW?: number,
  canvasH?: number
): [[number, number], [number, number]] {
  const poly = roomToGpsPolygon(room, target, canvasW, canvasH)
  const lats = poly.map(p => p[0])
  const lons = poly.map(p => p[1])
  return [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ]
}
