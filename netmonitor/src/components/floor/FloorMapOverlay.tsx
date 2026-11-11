import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../../context/settingsContext'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Device, Room, DeviceType } from '../../types'
import {
  Network,
  Router,
  Wifi,
  Server,
  Lock,
  Unlock,
  Info,
  Maximize2,
  Crosshair,
  RotateCcw,
  RotateCw,
  Move,
} from 'lucide-react'
import {
  type BuildingBounds,
  getStoredBuildingBounds,
  saveBuildingBounds,
  getBuildingCorners,
  canvasToGps,
  gpsToCanvas,
  roomToGpsPolygon,
  rotateCorners,
  resetCornersToOrthogonal,
} from '../../services/mapGeo'
import styles from './FloorMapOverlay.module.css'

interface Props {
  devices: Device[]
  rooms: Room[]
  currentFloor: 1 | 2
  onFloorChange?: (floor: 1 | 2) => void
  onDeviceInfo: (device: Device) => void
  onDeviceMove: (id: string, x: number, y: number, lat?: number, lon?: number) => void
  onDeviceMoveEnd: (id: string) => void
  onToggleLock: (id: string) => void
}

type TileType = 'carto' | 'satellite'

const mapApiKey = (import.meta.env.VITE_MAP_API_KEY || import.meta.env.VITE_API_KEY || 'cb1_52gf_1_09bb94a002ffbe18afbfb80e') as string

interface TileConfig {
  url: string
  attribution: string
  maxNativeZoom: number
  subdomains?: string
}

const TILE_CONFIGS = {
  dark: {
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${mapApiKey}`,
    attribution: '&copy; CartoDB &copy; CARTO',
    maxNativeZoom: 18,
    subdomains: 'abcd',
  },
  light: {
    url: `https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${mapApiKey}`,
    attribution: '&copy; CartoDB &copy; CARTO',
    maxNativeZoom: 18,
    subdomains: 'abcd',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxNativeZoom: 19,
  },
}

function getTileConfig(tileType: TileType, isLight: boolean): TileConfig {
  if (tileType === 'satellite') return TILE_CONFIGS.satellite
  return isLight ? TILE_CONFIGS.light : TILE_CONFIGS.dark
}

const DEVICE_SVG_MAP: Record<DeviceType, string> = {
  switch: renderToStaticMarkup(<Network size={16} className="mapPinImg" />),
  router: renderToStaticMarkup(<Router size={16} className="mapPinImg" />),
  ap:     renderToStaticMarkup(<Wifi size={16} className="mapPinImg" />),
  server: renderToStaticMarkup(<Server size={16} className="mapPinImg" />),
}

const LOCK_BADGE_SVG = renderToStaticMarkup(<Lock size={10} className="mapLockImg" />)
const INFO_SVG = renderToStaticMarkup(<Info size={13} style={{ display: 'inline-block' }} />)
const LOCK_BTN_SVG = renderToStaticMarkup(<Lock size={12} style={{ display: 'inline-block' }} />)
const UNLOCK_BTN_SVG = renderToStaticMarkup(<Unlock size={12} style={{ display: 'inline-block' }} />)
const CENTER_MOVE_SVG = renderToStaticMarkup(<Move size={18} style={{ display: 'inline-block' }} />)

function getDeviceIconEmoji(dtype: DeviceType): string {
  return DEVICE_SVG_MAP[dtype] || ''
}

export default function FloorMapOverlay({
  devices,
  rooms,
  currentFloor,
  onFloorChange,
  onDeviceInfo,
  onDeviceMove,
  onDeviceMoveEnd,
  onToggleLock,
}: Props) {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const isLight = settings.theme === 'light'
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const roomGroupRef = useRef<L.LayerGroup | null>(null)
  const markerGroupRef = useRef<L.LayerGroup | null>(null)
  const handleGroupRef = useRef<L.LayerGroup | null>(null)
  const buildingBorderRef = useRef<L.Polygon | null>(null)

  // Cache references for smooth 60fps real-time dragging
  const roomLayersRef = useRef<{ poly: L.Polygon; labelMarker?: L.Marker; room: Room }[]>([])
  const deviceMarkersRef = useRef<{ marker: L.Marker; device: Device }[]>([])
  const userLocationMarkerRef = useRef<L.CircleMarker | null>(null)

  const [buildingBounds, setBuildingBounds] = useState<BuildingBounds>(() => getStoredBuildingBounds())
  const boundsRef = useRef<BuildingBounds>(buildingBounds)
  useEffect(() => { boundsRef.current = buildingBounds }, [buildingBounds])

  const [isEditingBuilding, setIsEditingBuilding] = useState<boolean>(false)
  const [tileType, setTileType] = useState<TileType>(() => {
    const saved = localStorage.getItem('netmonitor_map_tile')
    if (saved === 'satellite') return 'satellite'
    return 'carto'
  })
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.75)
  const [mapReady, setMapReady] = useState(false)
  const [zoomLevel, setZoomLevel] = useState<number>(20)
  const [isLocating, setIsLocating] = useState(false)

  // คำนวณพิกัดกึ่งกลางตัวอาคาร (รองรับทั้ง 4 มุมหมุนเอียงและกรอบสี่เหลี่ยม)
  const buildingCenter = useMemo<[number, number]>(() => {
    const c = getBuildingCorners(buildingBounds)
    return [
      (c.nw[0] + c.ne[0] + c.se[0] + c.sw[0]) / 4,
      (c.nw[1] + c.ne[1] + c.se[1] + c.sw[1]) / 4,
    ]
  }, [buildingBounds])

  // สถิติอุปกรณ์
  const onlineCount  = devices.filter(d => d.status === 'online').length
  const warningCount = devices.filter(d => d.status === 'warning').length
  const offlineCount = devices.filter(d => d.status === 'offline').length

  // ฟังก์ชันอัปเดตเลเยอร์ทั้งหมดบนแผนที่ตาม Bounds แบบเรียลไทม์ (ไม่มี React Re-render ขัดจังหวะ Drag)
  const syncLayersToBounds = useCallback((b: BuildingBounds) => {
    const corners = getBuildingCorners(b)
    // 1. อัปเดตกรอบอาคาร (Polygon 4 มุมหมุน/เอียงอิสระ)
    if (buildingBorderRef.current) {
      buildingBorderRef.current.setLatLngs([
        corners.nw,
        corners.ne,
        corners.se,
        corners.sw,
      ])
    }
    // 2. อัปเดตห้องทุกห้อง (Polygon 4 จุด เอียงตามอาคารจริง พร้อมป้ายชื่อที่ขอบล่าง)
    roomLayersRef.current.forEach(({ poly, labelMarker, room }) => {
      const pts = roomToGpsPolygon(room, b)
      poly.setLatLngs(pts)
      if (labelMarker) {
        const bottomCanvasX = room.left + room.width / 2
        const bottomOffset = Math.min(12, Math.max(4, room.height * 0.15))
        const bottomCanvasY = room.top + room.height - bottomOffset
        const [lat, lon] = canvasToGps(bottomCanvasX, bottomCanvasY, b)
        labelMarker.setLatLng([lat, lon])
      }
    })
    // 3. อัปเดตตำแหน่งหมุดอุปกรณ์ที่อิงตามผังห้อง
    deviceMarkersRef.current.forEach(({ marker, device }) => {
      const hasGps = typeof device.latitude === 'number' && typeof device.longitude === 'number'
      if (!hasGps) {
        const [lat, lon] = canvasToGps(device.x, device.y, b)
        marker.setLatLng([lat, lon])
      }
    })
  }, [])

  // ── 1. กำหนดค่าเริ่มต้นแผนที่ Leaflet ─────────────────────────
  useEffect(() => {
    const container = mapContainerRef.current
    if (!container || mapRef.current) return

    const map = L.map(container, {
      center: buildingCenter,
      zoom: 20,
      minZoom: 18.0,
      maxZoom: 23,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
      wheelPxPerZoomLevel: 180,
      zoomControl: false,
    })

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    // Base Tile Layer
    const cfg = getTileConfig(tileType, isLight)
    const tileLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      subdomains: cfg.subdomains || 'abc',
      maxNativeZoom: cfg.maxNativeZoom,
      maxZoom: 23,
    }).addTo(map)
    tileLayerRef.current = tileLayer

    // Layer Groups
    const roomGroup = L.layerGroup().addTo(map)
    const markerGroup = L.layerGroup().addTo(map)
    const handleGroup = L.layerGroup().addTo(map)
    roomGroupRef.current = roomGroup
    markerGroupRef.current = markerGroup
    handleGroupRef.current = handleGroup

    // Building Boundary Outline (interactive: false เพื่อไม่ขัดขวางการคลิก Handle)
    const corners = getBuildingCorners(buildingBounds)
    const border = L.polygon(
      [corners.nw, corners.ne, corners.se, corners.sw],
      {
        color: isLight ? '#0284c7' : '#00f0ff',
        weight: 2.5,
        fillColor: isLight ? '#0284c7' : '#0369a1',
        fillOpacity: isLight ? 0.12 : 0.16,
        dashArray: '6, 6',
        interactive: false,
      }
    ).addTo(map)
    buildingBorderRef.current = border

    const handleZoomChange = () => {
      setZoomLevel(map.getZoom())
    }
    map.on('zoom', handleZoomChange)
    map.on('zoomend', handleZoomChange)

    const ro = new ResizeObserver(() => {
      map.invalidateSize()
    })
    ro.observe(container)

    mapRef.current = map
    setMapReady(true)

    return () => {
      ro.disconnect()
      map.off('zoom', handleZoomChange)
      map.off('zoomend', handleZoomChange)
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // ── 2. อัปเดตกรอบอาคารเมื่อพิกัด Bounds ใน State หรือธีมเปลี่ยนแปลง ───
  useEffect(() => {
    if (!buildingBorderRef.current) return
    const corners = getBuildingCorners(buildingBounds)
    buildingBorderRef.current.setLatLngs([
      corners.nw,
      corners.ne,
      corners.se,
      corners.sw,
    ])
    buildingBorderRef.current.setStyle({
      color: isLight ? '#0284c7' : '#00f0ff',
      fillColor: isLight ? '#0284c7' : '#0369a1',
      fillOpacity: isLight ? 0.12 : 0.16,
    })
  }, [buildingBounds, isLight])

  // ── 3. จุดจับปรับขอบเขตและตำแหน่งอาคาร (Drag & Resize Handles) ───
  // สำคัญมาก: ปรับ 4 มุมได้อย่างอิสระ (เอียงได้ หมุนได้ ไม่บังคับเป็นสี่เหลี่ยมผืนผ้าตั้งฉาก 90 องศา)
  useEffect(() => {
    if (!mapReady || !handleGroupRef.current) return
    const group = handleGroupRef.current
    group.clearLayers()

    if (!isEditingBuilding) return

    // ใช้พิกัดปัจจุบันใน boundsRef เพื่อสร้าง Marker
    const b = { ...boundsRef.current }
    const c = { ...getBuildingCorners(b) }
    b.corners = c

    function updateBoundsCorners() {
      b.north = Math.max(c.nw[0], c.ne[0], c.se[0], c.sw[0])
      b.south = Math.min(c.nw[0], c.ne[0], c.se[0], c.sw[0])
      b.west  = Math.min(c.nw[1], c.ne[1], c.se[1], c.sw[1])
      b.east  = Math.max(c.nw[1], c.ne[1], c.se[1], c.sw[1])
      b.corners = { ...c }
      handleCenter.setLatLng([
        (c.nw[0] + c.ne[0] + c.se[0] + c.sw[0]) / 4,
        (c.nw[1] + c.ne[1] + c.se[1] + c.sw[1]) / 4,
      ])
      syncLayersToBounds(b)
    }

    function saveCurrent() {
      setBuildingBounds({ ...b })
      saveBuildingBounds(b)
    }

    // 1) Handle มุมบนซ้าย (North-West)
    const handleNW = L.marker([c.nw[0], c.nw[1]], {
      draggable: true,
      zIndexOffset: 1200,
      icon: L.divIcon({
        className: 'buildingCornerHandle handleNW',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
      title: 'ลากมุมบนซ้ายอย่างอิสระ (ปรับเอียงได้)',
    })
    handleNW.on('drag', () => {
      const pos = handleNW.getLatLng()
      c.nw = [Number(pos.lat.toFixed(7)), Number(pos.lng.toFixed(7))]
      updateBoundsCorners()
    })
    handleNW.on('dragend', saveCurrent)
    group.addLayer(handleNW)

    // 2) Handle มุมบนขวา (North-East)
    const handleNE = L.marker([c.ne[0], c.ne[1]], {
      draggable: true,
      zIndexOffset: 1200,
      icon: L.divIcon({
        className: 'buildingCornerHandle handleNE',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
      title: 'ลากมุมบนขวาอย่างอิสระ (ปรับเอียงได้)',
    })
    handleNE.on('drag', () => {
      const pos = handleNE.getLatLng()
      c.ne = [Number(pos.lat.toFixed(7)), Number(pos.lng.toFixed(7))]
      updateBoundsCorners()
    })
    handleNE.on('dragend', saveCurrent)
    group.addLayer(handleNE)

    // 3) Handle มุมล่างขวา (South-East)
    const handleSE = L.marker([c.se[0], c.se[1]], {
      draggable: true,
      zIndexOffset: 1200,
      icon: L.divIcon({
        className: 'buildingCornerHandle handleSE',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
      title: 'ลากมุมล่างขวาอย่างอิสระ (ปรับเอียงได้)',
    })
    handleSE.on('drag', () => {
      const pos = handleSE.getLatLng()
      c.se = [Number(pos.lat.toFixed(7)), Number(pos.lng.toFixed(7))]
      updateBoundsCorners()
    })
    handleSE.on('dragend', saveCurrent)
    group.addLayer(handleSE)

    // 4) Handle มุมล่างซ้าย (South-West)
    const handleSW = L.marker([c.sw[0], c.sw[1]], {
      draggable: true,
      zIndexOffset: 1200,
      icon: L.divIcon({
        className: 'buildingCornerHandle handleSW',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
      title: 'ลากมุมล่างซ้ายอย่างอิสระ (ปรับเอียงได้)',
    })
    handleSW.on('drag', () => {
      const pos = handleSW.getLatLng()
      c.sw = [Number(pos.lat.toFixed(7)), Number(pos.lng.toFixed(7))]
      updateBoundsCorners()
    })
    handleSW.on('dragend', saveCurrent)
    group.addLayer(handleSW)

    // 5) Handle ตรงกลางสำหรับย้ายตำแหน่งทั้งตัวอาคาร (Move Entire Building)
    const initCenterLat = (c.nw[0] + c.ne[0] + c.se[0] + c.sw[0]) / 4
    const initCenterLon = (c.nw[1] + c.ne[1] + c.se[1] + c.sw[1]) / 4
    let moveStartPos = L.latLng(initCenterLat, initCenterLon)
    let cornerSnapshot = { ...c }

    const handleCenter = L.marker([initCenterLat, initCenterLon], {
      draggable: true,
      zIndexOffset: 1300,
      icon: L.divIcon({
        className: 'buildingCenterHandle',
        html: CENTER_MOVE_SVG,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
      title: t('floor.handleCenterTitle'),
    })

    handleCenter.on('dragstart', () => {
      moveStartPos = handleCenter.getLatLng()
      cornerSnapshot = { ...c }
    })

    handleCenter.on('drag', () => {
      const curPos = handleCenter.getLatLng()
      const dLat = curPos.lat - moveStartPos.lat
      const dLon = curPos.lng - moveStartPos.lng

      c.nw = [Number((cornerSnapshot.nw[0] + dLat).toFixed(7)), Number((cornerSnapshot.nw[1] + dLon).toFixed(7))]
      c.ne = [Number((cornerSnapshot.ne[0] + dLat).toFixed(7)), Number((cornerSnapshot.ne[1] + dLon).toFixed(7))]
      c.se = [Number((cornerSnapshot.se[0] + dLat).toFixed(7)), Number((cornerSnapshot.se[1] + dLon).toFixed(7))]
      c.sw = [Number((cornerSnapshot.sw[0] + dLat).toFixed(7)), Number((cornerSnapshot.sw[1] + dLon).toFixed(7))]

      handleNW.setLatLng(c.nw)
      handleNE.setLatLng(c.ne)
      handleSE.setLatLng(c.se)
      handleSW.setLatLng(c.sw)
      updateBoundsCorners()
    })

    handleCenter.on('dragend', saveCurrent)
    group.addLayer(handleCenter)
  }, [mapReady, isEditingBuilding, syncLayersToBounds, t])

  // ── 4. สลับ Tile Layer (Carto ตามธีม / Satellite) ─────────────
  useEffect(() => {
    localStorage.setItem('netmonitor_map_tile', tileType)
    if (!mapRef.current || !tileLayerRef.current) return
    const cfg = getTileConfig(tileType, isLight)
    tileLayerRef.current.setUrl(cfg.url)
    tileLayerRef.current.options.maxNativeZoom = cfg.maxNativeZoom
    if (cfg.subdomains) {
      tileLayerRef.current.options.subdomains = cfg.subdomains
    }
  }, [tileType, isLight])

  // ── 5. เรนเดอร์ผังห้อง (Room Overlay Polygons & Labels - เอียงตามอาคารจริง) ────
  useEffect(() => {
    if (!mapReady || !roomGroupRef.current) return
    const group = roomGroupRef.current
    group.clearLayers()
    roomLayersRef.current = []

    rooms.forEach(room => {
      const pts = roomToGpsPolygon(room, buildingBounds)
      const isStairs = room.type === 'stairs' || /บันได|stairs/i.test(room.label)
      const isRestroom = room.type === 'restroom' || /ห้องน้ำ|restroom|toilet|wc/i.test(room.label)
      const isServer = room.type === 'server' || /server|datacenter|เซิร์ฟเวอร์/i.test(room.label)

      const color = isServer
        ? (isLight ? '#6366f1' : '#a5b4fc')
        : isStairs
        ? (isLight ? '#d97706' : '#fbbf24')
        : isRestroom
        ? (isLight ? '#0891b2' : '#22d3ee')
        : (isLight ? '#0284c7' : '#38bdf8')

      const fillColor = isServer
        ? (isLight ? '#4338ca' : '#3730a3')
        : isStairs
        ? (isLight ? '#b45309' : '#92400e')
        : isRestroom
        ? (isLight ? '#0e7490' : '#155e75')
        : (isLight ? '#0284c7' : '#0369a1')

      const poly = L.polygon(pts, {
        color,
        weight: isServer ? 2.5 : 2,
        fillColor,
        fillOpacity: isServer ? Math.min(0.85, overlayOpacity + 0.18) : Math.max(0.22, overlayOpacity),
        dashArray: isStairs ? '3, 4' : '4, 4',
        interactive: isStairs && !!onFloorChange,
      })

      if (isStairs && onFloorChange) {
        poly.on('click', () => {
          onFloorChange(currentFloor === 1 ? 2 : 1)
        })
      }

      let labelMarker: L.Marker | undefined
      if (zoomLevel >= 19.5) {
        const stairSuffix = isStairs ? ` (${currentFloor === 1 ? t('floor.stairUp', { floor: 2 }) : t('floor.stairDown', { floor: 1 })})` : ''
        const bottomCanvasX = room.left + room.width / 2
        const bottomOffset = Math.min(12, Math.max(4, room.height * 0.15))
        const bottomCanvasY = room.top + room.height - bottomOffset
        const [bottomLat, bottomLon] = canvasToGps(bottomCanvasX, bottomCanvasY, buildingBounds)

        const typeClass = isServer
          ? 'roomMapLabelServer'
          : isStairs
          ? 'roomMapLabelStairs'
          : isRestroom
          ? 'roomMapLabelRestroom'
          : ''

        labelMarker = L.marker([bottomLat, bottomLon], {
          icon: L.divIcon({
            className: 'roomMapLabelWrap',
            html: `<span class="roomMapLabel ${typeClass}">${room.label + stairSuffix}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          interactive: isStairs && !!onFloorChange,
          zIndexOffset: 300,
        })

        if (isStairs && onFloorChange) {
          labelMarker.on('click', () => {
            onFloorChange(currentFloor === 1 ? 2 : 1)
          })
        }

        group.addLayer(labelMarker)
      }

      group.addLayer(poly)
      roomLayersRef.current.push({ poly, labelMarker, room })
    })
  }, [mapReady, rooms, overlayOpacity, zoomLevel, buildingBounds, currentFloor, onFloorChange, t, isLight])

  // ── 6. เรนเดอร์หมุดอุปกรณ์ (Zoom-responsive Scaling Pins) ──────
  useEffect(() => {
    if (!mapReady || !markerGroupRef.current) return
    const group = markerGroupRef.current
    group.clearLayers()
    deviceMarkersRef.current = []

    // ในขณะกำลังปรับขนาดและตำแหน่งผัง ให้ซ่อนหมุดอุปกรณ์
    if (isEditingBuilding) return

    const pinScale = Math.max(0.40, Math.min(1.20, Math.pow(1.10, zoomLevel - 20.0)))
    const showNameTag = zoomLevel >= 19.5

    devices.forEach(device => {
      const hasCanvasPos = typeof device.x === 'number' && typeof device.y === 'number'
      const hasGps = typeof device.latitude === 'number' && typeof device.longitude === 'number'
      const [lat, lon] = hasCanvasPos
        ? canvasToGps(device.x, device.y, buildingBounds)
        : hasGps
          ? [device.latitude!, device.longitude!]
          : canvasToGps(40, 40, buildingBounds)

      const statusClass =
        device.status === 'online' ? 'pinStatusOnline' :
        device.status === 'warning' ? 'pinStatusWarning' : 'pinStatusOffline'

      const emoji = getDeviceIconEmoji(device.dtype)
      const cleanName = device.name.replace(/^["']+|["']+$/g, '').trim()

      const html = `
        <div class="mapPinWrap">
          <div class="pinScaleBox" style="transform: scale(${pinScale.toFixed(2)}); transform-origin: 13px 13px;">
            <div class="pinIconBox ${statusClass}">
              <span class="pinEmoji">${emoji}</span>
              <span class="pinDotPulse"></span>
              ${device.locked ? `<span class="mapPinLockBadge">${LOCK_BADGE_SVG}</span>` : ''}
            </div>
            ${showNameTag ? `<div class="pinNameTag" title="${cleanName}">${cleanName}</div>` : ''}
          </div>
        </div>
      `

      const customIcon = L.divIcon({
        className: 'deviceMapPin',
        html,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      })

      const marker = L.marker([lat, lon], {
        icon: customIcon,
        draggable: !device.locked && !isEditingBuilding,
      })

      // รายละเอียดแบบย่อเมื่อเมาส์ Hover (Mini Tooltip)
      const tooltipHtml = `
        <div class="mapTipContent">
          <div class="mapTipHeader">
            <span class="mapTipName">
              <span style="display:inline-flex; align-items:center; width:12px; height:12px;">${emoji}</span>
              ${cleanName}
            </span>
            <span class="mapTipDot ${device.status || 'offline'}" title="${t(`status.${device.status}`)}"></span>
          </div>
          <div class="mapTipRow"><span>IP:</span><strong>${device.ip || '—'}</strong></div>
          <div class="mapTipRow"><span>${t('list.colType')}:</span><strong>${t(`deviceType.${device.dtype}`)}</strong></div>
          ${device.model ? `<div class="mapTipRow"><span>${t('pin.model')}:</span><strong style="max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${device.model}</strong></div>` : ''}
          <div class="mapTipRow"><span>${t('list.colFloor')}:</span><strong>${t('floor.tab', { floor: device.floor })}</strong></div>
        </div>
      `
      marker.bindTooltip(tooltipHtml, {
        direction: 'top',
        offset: [0, -14],
        opacity: 0.98,
        className: 'mapDeviceTooltip',
      })

      marker.on('popupopen', () => {
        marker.closeTooltip()
      })
      marker.on('dragstart', () => {
        marker.closeTooltip()
      })

      const statusDotColor =
        device.status === 'online' ? '#22c55e' :
        device.status === 'warning' ? '#f59e0b' : '#ef4444'
      const statusPill = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusDotColor};margin-right:5px;vertical-align:middle;"></span>${t(`status.${device.status}`)}`

      const popupHtml = `
        <div>
          <div class="popupTitle">
            <span>${emoji} ${cleanName}</span>
            <span style="font-size: 12px;">${statusPill}</span>
          </div>
          <div class="popupRow"><span>IP:</span> <span class="popupVal">${device.ip}</span></div>
          <div class="popupRow"><span>${t('list.colType')}:</span> <span class="popupVal">${t(`deviceType.${device.dtype}`)}</span></div>
          <div class="popupRow"><span>${t('list.colFloor')}:</span> <span class="popupVal">${t('floor.tab', { floor: device.floor })}</span></div>
          ${device.model ? `<div class="popupRow"><span>${t('pin.model')}:</span> <span class="popupVal">${device.model}</span></div>` : ''}
          ${hasGps ? `<div class="popupRow" style="font-size: 12px; color:#64748b;">GPS: ${lat.toFixed(6)}, ${lon.toFixed(6)}</div>` : ''}
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <button class="popupBtn" data-device-id="${device.id}" style="margin-top: 0; flex: 1.2; display: inline-flex; align-items: center; justify-content: center; gap: 5px;">
              ${INFO_SVG}
              <span>${t('floor.viewDeviceInfo')}</span>
            </button>
            <button class="popupLockBtn ${device.locked ? 'locked' : 'unlocked'}" data-lock-id="${device.id}" style="margin-top: 0; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
              ${device.locked ? UNLOCK_BTN_SVG : LOCK_BTN_SVG}
              <span>${device.locked ? t('pin.unlock') : t('pin.lock')}</span>
            </button>
          </div>
        </div>
      `
      marker.bindPopup(popupHtml)

      marker.on('dragend', () => {
        const newPos = marker.getLatLng()
        const [newX, newY] = gpsToCanvas(newPos.lat, newPos.lng, buildingBounds)
        const newLat = Number(newPos.lat.toFixed(7))
        const newLon = Number(newPos.lng.toFixed(7))
        onDeviceMove(device.id, newX, newY, newLat, newLon)
        onDeviceMoveEnd(device.id)
      })

      group.addLayer(marker)
      deviceMarkersRef.current.push({ marker, device })
    })
  }, [mapReady, devices, zoomLevel, buildingBounds, isEditingBuilding, onDeviceMove, onDeviceMoveEnd, onToggleLock, t])

  // ── 7. Event Delegation สำหรับปุ่มเปิด Device Info ใน Popup ────
  useEffect(() => {
    const container = mapContainerRef.current
    if (!container) return

    const handlePopupClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const lockBtn = target.closest('[data-lock-id]') as HTMLElement | null
      if (lockBtn) {
        const id = lockBtn.getAttribute('data-lock-id')
        if (id) {
          onToggleLock(id)
        }
        return
      }

      const btn = target.closest('[data-device-id]') as HTMLElement | null
      if (btn) {
        const id = btn.getAttribute('data-device-id')
        const targetDev = devices.find(d => d.id === id)
        if (targetDev) {
          onDeviceInfo(targetDev)
        }
      }
    }

    container.addEventListener('click', handlePopupClick)
    return () => container.removeEventListener('click', handlePopupClick)
  }, [devices, onDeviceInfo])

  // ── 8. ฟังก์ชันควบคุมพิกัดและมุมมอง ───────────────────────────
  // ตรวจจับพิกัด GPS ปัจจุบันของผู้ใช้ (เลื่อนแผนที่ไปดูพิกัด โดยไม่ปรับหรือเลื่อนกรอบผังอาคาร)
  const handleLocateMe = useCallback(() => {
    if (!('geolocation' in navigator)) {
      alert(t('floor.geoNotSupported'))
      return
    }
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false)
        const lat = Number(pos.coords.latitude.toFixed(7))
        const lon = Number(pos.coords.longitude.toFixed(7))

        // เลื่อนมุมมองแผนที่ไปยังพิกัดปัจจุบัน โดยไม่ต้องปรับกรอบแผนผังอาคาร
        if (mapRef.current) {
          mapRef.current.flyTo([lat, lon], 20, { duration: 1.2 })

          // แสดงหมุดพิกัดปัจจุบันสีฟ้า (Current Location Pin)
          if (userLocationMarkerRef.current) {
            userLocationMarkerRef.current.setLatLng([lat, lon])
          } else {
            userLocationMarkerRef.current = L.circleMarker([lat, lon], {
              radius: 8,
              color: '#ffffff',
              weight: 2,
              fillColor: '#0ea5e9',
              fillOpacity: 0.95,
            }).addTo(mapRef.current)
            userLocationMarkerRef.current.bindPopup(t('floor.currentGps') || 'พิกัดปัจจุบัน')
          }
        }
      },
      (err) => {
        setIsLocating(false)
        alert(t('floor.geoError', { message: err.message }))
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [t])

  // ฟังก์ชันหมุนอาคารรอบจุดกึ่งกลาง (เอียงองศาตามภาพถ่ายดาวเทียมจริง)
  const handleRotate = useCallback((deg: number) => {
    const b = { ...boundsRef.current }
    const corners = getBuildingCorners(b)
    const rotated = rotateCorners(corners, deg)
    b.corners = rotated
    b.north = Math.max(rotated.nw[0], rotated.ne[0], rotated.se[0], rotated.sw[0])
    b.south = Math.min(rotated.nw[0], rotated.ne[0], rotated.se[0], rotated.sw[0])
    b.west  = Math.min(rotated.nw[1], rotated.ne[1], rotated.se[1], rotated.sw[1])
    b.east  = Math.max(rotated.nw[1], rotated.ne[1], rotated.se[1], rotated.sw[1])
    boundsRef.current = b
    setBuildingBounds({ ...b })
    saveBuildingBounds(b)
    syncLayersToBounds(b)
  }, [syncLayersToBounds])

  // ฟังก์ชันรีเซ็ตกรอบอาคารกลับเป็นสี่เหลี่ยมผืนผ้าตั้งฉาก 90 องศา
  const handleResetOrthogonal = useCallback(() => {
    const b = { ...boundsRef.current }
    const corners = getBuildingCorners(b)
    const ortho = resetCornersToOrthogonal(corners)
    b.corners = ortho
    b.north = Math.max(ortho.nw[0], ortho.ne[0], ortho.se[0], ortho.sw[0])
    b.south = Math.min(ortho.nw[0], ortho.ne[0], ortho.se[0], ortho.sw[0])
    b.west  = Math.min(ortho.nw[1], ortho.ne[1], ortho.se[1], ortho.sw[1])
    b.east  = Math.max(ortho.nw[1], ortho.ne[1], ortho.se[1], ortho.sw[1])
    boundsRef.current = b
    setBuildingBounds({ ...b })
    saveBuildingBounds(b)
    syncLayersToBounds(b)
  }, [syncLayersToBounds])

  return (
    <div className={styles.mapContainer}>
      {/* Floating Toolbar on Top Right */}
      <div className={styles.mapToolbar}>
        {/* Toggle Interactive Building Edit (Drag & Resize Handles) */}
        <button
          className={`${styles.controlBtn} ${isEditingBuilding ? styles.editBtnActive : ''}`}
          onClick={() => setIsEditingBuilding(prev => !prev)}
          title={isEditingBuilding ? t('floor.finishEditBuildingTitle') : t('floor.editBuildingTitle')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Maximize2 size={13} />
          <span>{isEditingBuilding ? t('floor.finishEditBuilding') : t('floor.editBuilding')}</span>
        </button>

        {/* GPS Current Location Button */}
        <button
          className={styles.controlBtn}
          onClick={handleLocateMe}
          disabled={isLocating}
          title={t('floor.currentGpsTitle')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Crosshair size={13} />
          <span>{isLocating ? t('floor.locatingGps') : t('floor.currentGps')}</span>
        </button>

        <div className={styles.toolDivider} />

        {/* Map Tile Layer Selector (Carto Auto Theme / Satellite) */}
        <select
          className={styles.layerSelect}
          value={tileType}
          onChange={e => {
            const val = e.target.value as TileType
            setTileType(val)
            localStorage.setItem('netmonitor_map_tile', val)
          }}
          title={t('floor.layerSelectTitle')}
        >
          <option value="carto">{t('floor.tileCarto')}</option>
          <option value="satellite">{t('floor.tileSatellite')}</option>
        </select>

        <div className={styles.toolDivider} />

        {/* Overlay Opacity Slider */}
        <div className={styles.opacityControl} title={t('floor.opacityTitle')}>
          <span>{t('floor.opacityLabel')}</span>
          <input
            type="range"
            min="0.1"
            max="0.95"
            step="0.05"
            value={overlayOpacity}
            onChange={e => setOverlayOpacity(parseFloat(e.target.value))}
            className={styles.slider}
          />
        </div>
      </div>

      {/* Floating Edit Guide Banner with Rotation Controls */}
      {isEditingBuilding && (
        <div className={styles.editGuideBanner}>
          <div className={styles.guideText} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Maximize2 size={14} />
            <span>ลากหมุด 4 มุมปรับเอียง/บิดทรงอิสระ (ไม่จำเป็นต้อง 90°) หรือลากหมุดกึ่งกลางเพื่อเลื่อน</span>
          </div>
          <div className={styles.rotateRow}>
            <button
              className={styles.rotateBtn}
              onClick={() => handleRotate(-5)}
              title="หมุนทวนเข็ม 5 องศา"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RotateCcw size={12} />
              <span>-5°</span>
            </button>
            <button
              className={styles.rotateBtn}
              onClick={() => handleRotate(-1)}
              title="หมุนทวนเข็ม 1 องศา"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RotateCcw size={12} />
              <span>-1°</span>
            </button>
            <button
              className={styles.rotateBtn}
              onClick={() => handleRotate(1)}
              title="หมุนตามเข็ม 1 องศา"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RotateCw size={12} />
              <span>+1°</span>
            </button>
            <button
              className={styles.rotateBtn}
              onClick={() => handleRotate(5)}
              title="หมุนตามเข็ม 5 องศา"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RotateCw size={12} />
              <span>+5°</span>
            </button>
            <button
              className={styles.resetOrthoBtn}
              onClick={handleResetOrthogonal}
              title="คืนค่าเป็นกรอบสี่เหลี่ยมผืนผ้าตั้งฉาก 90 องศา"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <RotateCcw size={12} />
              <span>คืนค่ามุมฉาก 90°</span>
            </button>
          </div>
        </div>
      )}

      {/* Stats Summary Badge (Bottom Left) */}
      <div className={styles.statsOverlay}>
        <div className={styles.statItem}>
          <span className={`${styles.statNum} ${styles.statOnline}`}>{onlineCount}</span> {t('floor.statsOnline')}
        </div>
        <div className={styles.statItem}>
          <span className={`${styles.statNum} ${styles.statWarning}`}>{warningCount}</span> {t('floor.statsWarning')}
        </div>
        <div className={styles.statItem}>
          <span className={`${styles.statNum} ${styles.statOffline}`}>{offlineCount}</span> {t('floor.statsOffline')}
        </div>
        <div className={styles.statItem}>
          <span className={`${styles.statNum} ${styles.statTotal}`}>{devices.length}</span> {t('floor.statsTotal')}
        </div>
      </div>

      {/* Leaflet Map DOM Element */}
      <div ref={mapContainerRef} className={styles.leafletWrap} />
    </div>
  )
}
