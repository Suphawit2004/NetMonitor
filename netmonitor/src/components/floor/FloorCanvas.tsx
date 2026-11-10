import { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device, Room } from '../../types'
import { getBuildingRealDimensions, getStoredBuildingBounds, canvasToGps } from '../../services/mapGeo'
import { saveStoredRooms, resetStoredRooms, syncStairsAcrossFloors, removeStairsAcrossFloors } from '../../services/roomStore'
import DevicePin, { type PopupPlacement } from './DevicePin'
import {
  Server,
  Building2,
  Footprints,
  Bath,
  RotateCcw,
  Pencil,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import styles from './FloorCanvas.module.css'

interface RoomsLayerProps {
  roomList: Room[]
  isEditingRooms: boolean
  activeRoomIndex: number | null
  editingRoomIdx: number | null
  editNameText: string
  currentFloor: 1 | 2
  onFloorChange?: (floor: 1 | 2) => void
  onRoomMouseDown: (e: React.MouseEvent, index: number) => void
  onStartRename: (index: number, label: string) => void
  onDeleteRoom: (index: number) => void
  onEditNameChange: (val: string) => void
  onSaveRename: (index: number) => void
  onCancelRename: () => void
  t: (key: string, opts?: Record<string, unknown>) => string
}

const RoomsLayer = memo(function RoomsLayer({
  roomList,
  isEditingRooms,
  activeRoomIndex,
  editingRoomIdx,
  editNameText,
  currentFloor,
  onFloorChange,
  onRoomMouseDown,
  onStartRename,
  onDeleteRoom,
  onEditNameChange,
  onSaveRename,
  onCancelRename,
  t,
}: RoomsLayerProps) {
  return (
    <>
      {roomList.map((room, i) => {
        const isEditingThisRoom = isEditingRooms && activeRoomIndex === i
        const isStairs = room.type === 'stairs' || /บันได|stairs/i.test(room.label)
        const isRestroom = room.type === 'restroom' || /ห้องน้ำ|restroom|toilet|wc/i.test(room.label)
        const isServer = room.type === 'server' || /server|datacenter|เซิร์ฟเวอร์/i.test(room.label)
        const roomTypeClass = isServer ? styles.roomServer : isStairs ? styles.roomStairs : isRestroom ? styles.roomRestroom : ''

        return (
          <div
            key={i}
            className={`${styles.room} ${roomTypeClass} ${isEditingRooms ? styles.roomEditing : ''} ${isEditingThisRoom ? styles.roomDragging : ''}`}
            style={{ left: room.left, top: room.top, width: room.width, height: room.height }}
            onMouseDown={e => onRoomMouseDown(e, i)}
          >
            {isStairs && onFloorChange && (
              <button
                type="button"
                className={styles.stairLink}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation()
                  onFloorChange(currentFloor === 1 ? 2 : 1)
                }}
                title={t('floor.clickToSwitchFloor', { floor: currentFloor === 1 ? 2 : 1 })}
              >
                {currentFloor === 1
                  ? t('floor.stairUp', { floor: 2 })
                  : t('floor.stairDown', { floor: 1 })}
              </button>
            )}
            {isEditingRooms && (
              <div className={styles.roomActions}>
                <button
                  className={styles.roomActionBtn}
                  onClick={() => onStartRename(i, room.label)}
                  title={t('floor.renameRoom')}
                >
                  <Pencil size={11} />
                </button>
                <button
                  className={`${styles.roomActionBtn} ${styles.roomActionBtnDanger}`}
                  onClick={() => onDeleteRoom(i)}
                  title={t('floor.deleteRoom')}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}

            {editingRoomIdx === i ? (
              <input
                type="text"
                className={styles.renameInput}
                value={editNameText}
                autoFocus
                onChange={e => onEditNameChange(e.target.value)}
                onBlur={() => onSaveRename(i)}
                onKeyDown={e => {
                  if (e.key === 'Enter') onSaveRename(i)
                  if (e.key === 'Escape') onCancelRename()
                }}
              />
            ) : (
              <span className={styles.roomLabel}>{room.label}</span>
            )}

            {isEditingRooms && (
              <div
                className={styles.resizeHandle}
                title={t('floor.resizeRoomTitle')}
              />
            )}
          </div>
        )
      })}
    </>
  )
})

interface Props {
  devices: Device[]
  rooms: Room[]
  currentFloor: 1 | 2
  bgImage?: string | null
  onDeviceInfo: (device: Device) => void
  onDeviceMove: (id: string, x: number, y: number, lat?: number, lon?: number) => void
  onDeviceMoveEnd: (id: string) => void
  onToggleLock: (id: string) => void
  onRoomsChange?: (updatedRooms: Room[]) => void
  onFloorChange?: (floor: 1 | 2) => void
  onEditingRoomsChange?: (isEditing: boolean) => void
}

const DRAG_THRESHOLD = 6
const POPUP_HIDE_DELAY_MS = 3000
const POPUP_FADE_MS = 380
const POPUP_H = 250
const POPUP_W = 230

function getPopupPlacement(x: number, y: number, planW: number, planH: number): PopupPlacement {
  const spaceAbove = y
  const spaceBelow = planH - y
  const spaceLeft  = x
  const spaceRight = planW - x

  if (spaceAbove >= POPUP_H) {
    if (x - POPUP_W / 2 >= 0 && x + POPUP_W / 2 <= planW) return 'above'
    return spaceLeft >= spaceRight ? 'left' : 'right'
  }
  if (spaceBelow >= POPUP_H) {
    if (x - POPUP_W / 2 >= 0 && x + POPUP_W / 2 <= planW) return 'below'
    return spaceLeft >= spaceRight ? 'left' : 'right'
  }
  return spaceLeft >= spaceRight ? 'left' : 'right'
}

interface HoverPopup {
  kind: 'pin'
  id: string
}

export default function FloorCanvas({
  devices,
  rooms,
  currentFloor,
  bgImage = null,
  onDeviceInfo,
  onDeviceMove,
  onDeviceMoveEnd,
  onToggleLock,
  onRoomsChange,
  onFloorChange,
  onEditingRoomsChange,
}: Props) {
  const { t } = useTranslation()

  // ── 0. คำนวณขนาดและสัดส่วนอาคารจริงจากแผนที่ดาวเทียม ───────────────
  const buildingDim = useMemo(() => getBuildingRealDimensions(), [currentFloor])
  const PLAN_W = buildingDim.canvasW
  const PLAN_H = buildingDim.canvasH

  // ── 1. จัดการสถานะการปรับแต่งผังห้อง (Room Customization) ──────────
  const [isEditingRooms, setIsEditingRooms] = useState(false)
  const [roomList, setRoomList] = useState<Room[]>(rooms)
  const [editingRoomIdx, setEditingRoomIdx] = useState<number | null>(null)
  const [editNameText, setEditNameText] = useState('')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoomList(rooms)
  }, [rooms])

  const roomListRef = useRef<Room[]>(roomList)
  useEffect(() => {
    roomListRef.current = roomList
  }, [roomList])

  // Refs สำหรับการคลิกลากย้าย/ย่อขยายห้อง
  const draggingRoomIdx = useRef<number | null>(null)
  const resizingRoomIdx = useRef<number | null>(null)
  const [activeRoomIndex, setActiveRoomIndex] = useState<number | null>(null)
  const roomDragStart = useRef({ mx: 0, my: 0, rLeft: 0, rTop: 0, rW: 0, rH: 0 })

  // ── 2. Zoom & Pan ──────────────────────────────────────────────
  const [scale, setScale] = useState(1)
  const [pan,   setPan]   = useState({ x: 0, y: 0 })
  const isPanning         = useRef(false)
  const panStart          = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const wrapRef           = useRef<HTMLDivElement>(null)
  const planRef           = useRef<HTMLDivElement>(null)
  const hasAutoFitted     = useRef(false)

  // คำนวณ Auto-Fit ย่อ/ขยายผังอาคารให้พอดีกับหน้าจอและกึ่งกลางเสมอ โดยไม่เว้นขอบรอบตัวอาคาร
  const fitToViewport = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (cw > 100 && ch > 100) {
      // พอดีกับหน้าจอ ไม่เว้นขอบรอบตัวอาคาร
      const scaleX = cw / PLAN_W
      const scaleY = ch / PLAN_H
      const bestScale = Math.min(scaleX, scaleY, 1.0)
      const clampedScale = Number(Math.max(0.3, bestScale).toFixed(2))
      setScale(clampedScale)
      setPan({ x: 0, y: 0 })
    }
  }, [PLAN_W, PLAN_H])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!hasAutoFitted.current) {
        fitToViewport()
        hasAutoFitted.current = true
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitToViewport])

  // ── 3. Device Drag refs & state ────────────────────────────────
  const [draggingDeviceId, setDraggingDeviceId] = useState<string | null>(null)
  const draggingId   = useRef<string | null>(null)
  const dragMoved    = useRef(false)
  const dragStartPos = useRef({ mx: 0, my: 0 })
  const boundsRef    = useRef(getStoredBuildingBounds())
  const rafId        = useRef<number | null>(null)
  const pendingDrag  = useRef<{ dragId: string; clientX: number; clientY: number } | null>(null)

  useEffect(() => {
    boundsRef.current = getStoredBuildingBounds()
  }, [currentFloor])

  // ── 4. Popup state (hover) ─────────────────────────────────────
  const [openPopup, setOpenPopup] = useState<HoverPopup | null>(null)
  const [fading, setFading]       = useState(false)
  const closeTimer = useRef<number | null>(null)
  const fadeTimer  = useRef<number | null>(null)

  const clearPopupTimers = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (fadeTimer.current !== null) {
      window.clearTimeout(fadeTimer.current)
      fadeTimer.current = null
    }
  }, [])

  const hidePopupNow = useCallback(() => {
    clearPopupTimers()
    setFading(false)
    setOpenPopup(null)
  }, [clearPopupTimers])

  const showPopup = useCallback((id: string) => {
    if (draggingId.current || isPanning.current || isEditingRooms) return
    clearPopupTimers()
    setFading(false)
    setOpenPopup({ kind: 'pin', id })
  }, [clearPopupTimers, isEditingRooms])

  const scheduleHide = useCallback(() => {
    clearPopupTimers()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setFading(true)
      fadeTimer.current = window.setTimeout(() => {
        fadeTimer.current = null
        setOpenPopup(null)
        setFading(false)
      }, POPUP_FADE_MS)
    }, POPUP_HIDE_DELAY_MS)
  }, [clearPopupTimers])

  const popupRef = useRef<HoverPopup | null>(null)
  useEffect(() => { popupRef.current = openPopup }, [openPopup])

  const handleHoverStart = useCallback((dev: Device) => {
    showPopup(dev.id)
  }, [showPopup])

  const handleHoverEnd = useCallback(() => {
    if (popupRef.current) scheduleHide()
  }, [scheduleHide])

  // Refs สำหรับ listener
  const devicesRef = useRef(devices)
  const scaleRef   = useRef(scale)
  const callbacksRef = useRef({ onDeviceInfo, onDeviceMove, onDeviceMoveEnd })

  useEffect(() => { devicesRef.current = devices }, [devices])
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { callbacksRef.current = { onDeviceInfo, onDeviceMove, onDeviceMoveEnd } })
  useEffect(() => () => clearPopupTimers(), [clearPopupTimers])

  const zoom = useCallback((delta: number) => {
    setScale(s => Math.min(3, Math.max(0.3, +(s + delta).toFixed(2))))
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      zoom(e.deltaY < 0 ? 0.1 : -0.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom])

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    hidePopupNow()
    if (e.button !== 1 && !e.altKey) return
    e.preventDefault()
    isPanning.current = true
    panStart.current  = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
  }, [pan, hidePopupNow])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return
    setPan({
      x: panStart.current.px + e.clientX - panStart.current.mx,
      y: panStart.current.py + e.clientY - panStart.current.my,
    })
  }, [])

  const handleCanvasMouseUp = useCallback(() => { isPanning.current = false }, [])

  const handlePinMouseDown = useCallback((device: Device, e: React.MouseEvent) => {
    if (e.button !== 0 || isEditingRooms) return
    e.stopPropagation()
    e.preventDefault()

    draggingId.current   = device.id
    dragMoved.current    = false
    dragStartPos.current = { mx: e.clientX, my: e.clientY }
  }, [isEditingRooms])

  // ── 5. Mouse Event Listener รวมทั้ง Device Dragging และ Room Resizing/Dragging ──
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const s = scaleRef.current

      // A) ปรับขนาดหรือย้ายห้องในโหมดปรับแต่ง
      if (draggingRoomIdx.current !== null) {
        const idx = draggingRoomIdx.current
        const start = roomDragStart.current
        const dx = Math.round((e.clientX - start.mx) / s)
        const dy = Math.round((e.clientY - start.my) / s)

        const newLeft = Math.max(0, Math.min(PLAN_W - start.rW, start.rLeft + dx))
        const newTop  = Math.max(0, Math.min(PLAN_H - start.rH, start.rTop + dy))

        setRoomList(prev => prev.map((r, i) => i === idx ? { ...r, left: newLeft, top: newTop } : r))
        return
      }

      if (resizingRoomIdx.current !== null) {
        const idx = resizingRoomIdx.current
        const start = roomDragStart.current
        const dx = Math.round((e.clientX - start.mx) / s)
        const dy = Math.round((e.clientY - start.my) / s)

        const newW = Math.max(80, Math.min(PLAN_W - start.rLeft, start.rW + dx))
        const newH = Math.max(50, Math.min(PLAN_H - start.rTop, start.rH + dy))

        setRoomList(prev => prev.map((r, i) => i === idx ? { ...r, width: newW, height: newH } : r))
        return
      }

      // B) ย้ายอุปกรณ์ (Device Dragging)
      const dragId = draggingId.current
      if (!dragId || !planRef.current) return

      const dev = devicesRef.current.find(d => d.id === dragId)
      if (dev?.locked) return

      const dx = e.clientX - dragStartPos.current.mx
      const dy = e.clientY - dragStartPos.current.my

      if (!dragMoved.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        dragMoved.current = true
        setDraggingDeviceId(dragId)
        hidePopupNow()
      }

      pendingDrag.current = { dragId, clientX: e.clientX, clientY: e.clientY }

      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null
          if (!pendingDrag.current || !planRef.current) return
          const { dragId: id, clientX, clientY } = pendingDrag.current
          const s = scaleRef.current
          const rect = planRef.current.getBoundingClientRect()
          const nx = Math.round((clientX - rect.left) / s)
          const ny = Math.round((clientY - rect.top) / s)

          const clampedX = Math.max(20, Math.min(nx, PLAN_W - 20))
          const clampedY = Math.max(20, Math.min(ny, PLAN_H - 20))
          const bounds = boundsRef.current
          const [calcLat, calcLon] = canvasToGps(clampedX, clampedY, bounds)

          callbacksRef.current.onDeviceMove(
            id,
            clampedX,
            clampedY,
            Number(calcLat.toFixed(7)),
            Number(calcLon.toFixed(7)),
          )
        })
      }
    }

    function onUp() {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
        rafId.current = null
      }

      // เสร็จสิ้นการย้าย/ปรับขนาดห้อง
      if (draggingRoomIdx.current !== null || resizingRoomIdx.current !== null) {
        const modifiedIdx = draggingRoomIdx.current ?? resizingRoomIdx.current
        const latest = roomListRef.current
        saveStoredRooms(currentFloor, latest)
        onRoomsChange?.(latest)
        if (modifiedIdx !== null && latest[modifiedIdx]) {
          const room = latest[modifiedIdx]
          if (room.type === 'stairs' || /บันได|stairs/i.test(room.label)) {
            syncStairsAcrossFloors(currentFloor, room)
          }
        }
        draggingRoomIdx.current = null
        resizingRoomIdx.current = null
        setActiveRoomIndex(null)
      }

      // เสร็จสิ้นการย้ายอุปกรณ์
      const dragId = draggingId.current
      if (dragId) {
        if (!dragMoved.current) {
          const dev = devicesRef.current.find(d => d.id === dragId)
          if (dev) {
            hidePopupNow()
            callbacksRef.current.onDeviceInfo(dev)
          }
        } else {
          if (pendingDrag.current && planRef.current) {
            const { dragId: id, clientX, clientY } = pendingDrag.current
            const s = scaleRef.current
            const rect = planRef.current.getBoundingClientRect()
            const nx = Math.round((clientX - rect.left) / s)
            const ny = Math.round((clientY - rect.top) / s)

            const clampedX = Math.max(20, Math.min(nx, PLAN_W - 20))
            const clampedY = Math.max(20, Math.min(ny, PLAN_H - 20))
            const bounds = boundsRef.current
            const [calcLat, calcLon] = canvasToGps(clampedX, clampedY, bounds)

            callbacksRef.current.onDeviceMove(
              id,
              clampedX,
              clampedY,
              Number(calcLat.toFixed(7)),
              Number(calcLon.toFixed(7)),
            )
          }
          callbacksRef.current.onDeviceMoveEnd(dragId)
        }
      }
      pendingDrag.current = null
      draggingId.current = null
      dragMoved.current  = false
      setDraggingDeviceId(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [PLAN_W, PLAN_H, currentFloor, onRoomsChange, hidePopupNow])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        hidePopupNow()
        setEditingRoomIdx(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hidePopupNow])

  // ── 6. จัดการเพิ่ม / ลบ / เปลี่ยนชื่อห้อง ────────────────────────
  const handleRoomMouseDown = (e: React.MouseEvent, index: number) => {
    if (!isEditingRooms || e.button !== 0) return
    const target = e.target as HTMLElement

    // หากคลิกที่ปุ่มจัดการ หรือช่องพิมพ์ข้อความ ไม่เริ่ม drag
    if (target.closest(`.${styles.roomActions}`) || target.tagName === 'INPUT') return

    e.stopPropagation()
    e.preventDefault()

    const room = roomList[index]
    roomDragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      rLeft: room.left,
      rTop: room.top,
      rW: room.width,
      rH: room.height,
    }

    setActiveRoomIndex(index)

    if (target.closest(`.${styles.resizeHandle}`)) {
      resizingRoomIdx.current = index
    } else {
      draggingRoomIdx.current = index
    }
  }

  const handleAddRoom = (type: 'room' | 'stairs' | 'restroom' | 'server' = 'room') => {
    let label: string
    let w = Math.min(260, Math.round(PLAN_W * 0.35))
    let h = Math.min(160, Math.round(PLAN_H * 0.35))

    if (type === 'server') {
      const serverCount = roomList.filter(r => r.type === 'server' || /server|datacenter|เซิร์ฟเวอร์/i.test(r.label)).length + 1
      label = t('floor.serverRoomName', { count: serverCount })
      w = Math.min(240, Math.round(PLAN_W * 0.30))
      h = Math.min(180, Math.round(PLAN_H * 0.30))
    } else if (type === 'stairs') {
      const stairsCount = roomList.filter(r => r.type === 'stairs' || /บันได|stairs/i.test(r.label)).length + 1
      label = t('floor.stairsName', { count: stairsCount })
      w = Math.min(180, Math.round(PLAN_W * 0.22))
      h = Math.min(140, Math.round(PLAN_H * 0.22))
    } else if (type === 'restroom') {
      const restroomCount = roomList.filter(r => r.type === 'restroom' || /ห้องน้ำ|restroom|toilet|wc/i.test(r.label)).length + 1
      label = t('floor.restroomName', { count: restroomCount })
      w = Math.min(160, Math.round(PLAN_W * 0.20))
      h = Math.min(140, Math.round(PLAN_H * 0.20))
    } else {
      const regularCount = roomList.filter(r => (!r.type || r.type === 'room') && !/บันได|stairs|ห้องน้ำ|restroom|toilet|wc|server/i.test(r.label)).length + 1
      label = t('floor.roomName', { count: regularCount })
    }

    const offset = (roomList.length % 6) * 24
    const newRoom: Room = {
      label,
      type,
      left: Math.round(PLAN_W * 0.08) + offset,
      top: Math.round(PLAN_H * 0.08) + offset,
      width: w,
      height: h,
      connectsToFloor: type === 'stairs' ? (currentFloor === 1 ? 2 : 1) : undefined,
    }
    const updated = [...roomList, newRoom]
    setRoomList(updated)
    saveStoredRooms(currentFloor, updated)
    onRoomsChange?.(updated)

    // บันไดเชื่อมกันต่อชั้น: ซิงค์บันไดไปยังอีกชั้นอัตโนมัติ
    if (type === 'stairs') {
      syncStairsAcrossFloors(currentFloor, newRoom)
    }
  }

  const handleDeleteRoom = (index: number) => {
    const deleted = roomList[index]
    const updated = roomList.filter((_, i) => i !== index)
    setRoomList(updated)
    saveStoredRooms(currentFloor, updated)
    onRoomsChange?.(updated)

    // บันไดเชื่อมต่อกัน: ถ้าลบบันไดในชั้นนี้ ให้ลบบันไดในอีกชั้นออกด้วย
    const isStairs = deleted?.type === 'stairs' || /บันได|stairs/i.test(deleted?.label || '')
    if (isStairs) {
      removeStairsAcrossFloors(currentFloor)
    }
  }

  const handleStartRename = (index: number, curLabel: string) => {
    setEditingRoomIdx(index)
    setEditNameText(curLabel)
  }

  const handleSaveRename = (index: number) => {
    if (!editNameText.trim()) return
    const updated = roomList.map((r, i) => i === index ? { ...r, label: editNameText.trim() } : r)
    setRoomList(updated)
    saveStoredRooms(currentFloor, updated)
    onRoomsChange?.(updated)
    setEditingRoomIdx(null)

    const modified = updated[index]
    if (modified && (modified.type === 'stairs' || /บันได|stairs/i.test(modified.label))) {
      syncStairsAcrossFloors(currentFloor, modified)
    }
  }

  const handleResetDefaultRooms = () => {
    if (confirm(t('floor.resetRoomsConfirm'))) {
      const empty = resetStoredRooms(currentFloor)
      setRoomList(empty)
      onRoomsChange?.(empty)
      removeStairsAcrossFloors(currentFloor)
    }
  }

  return (
    <div
      ref={wrapRef}
      className={styles.canvasWrap}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
    >
      {!bgImage && <div className={styles.canvasBg} />}

      {/* Top Bar: แสดงขนาดอาคารจริงจากแผนที่ + ปุ่มเปิดโหมดปรับแต่งผังห้อง */}
      <div className={styles.topBar}>
        <div className={styles.dimBadge} title={t('floor.realBuildingSizeTitle')}>
          {t('floor.realBuildingSize', { w: buildingDim.widthMeters, h: buildingDim.heightMeters, ratio: buildingDim.aspectRatio })}
        </div>

        <button
          className={`${styles.editRoomsBtn} ${isEditingRooms ? styles.editRoomsBtnActive : ''}`}
          onClick={() => {
            setOpenPopup(null)
            setDraggingDeviceId(null)
            setIsEditingRooms(prev => {
              const next = !prev
              onEditingRoomsChange?.(next)
              return next
            })
          }}
          title={isEditingRooms ? t('floor.finishEditRoomsTitle') : t('floor.editRoomsTitle')}
        >
          {isEditingRooms ? t('floor.finishEditRooms') : t('floor.editRooms')}
        </button>

        {isEditingRooms && (
          <div className={styles.editControls}>
            <button className={`${styles.secondaryBtn} ${styles.btnAddRoom}`} onClick={() => handleAddRoom('room')} title={t('floor.addRoomTitle')}>
              <Building2 size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {t('floor.addRoom')}
            </button>
            <button className={`${styles.secondaryBtn} ${styles.btnAddServer}`} onClick={() => handleAddRoom('server')} title={t('floor.addServerTitle')}>
              <Server size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {t('floor.addServer')}
            </button>
            <button className={`${styles.secondaryBtn} ${styles.btnAddStairs}`} onClick={() => handleAddRoom('stairs')} title={t('floor.addStairsTitle')}>
              <Footprints size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {t('floor.addStairs')}
            </button>
            <button className={`${styles.secondaryBtn} ${styles.btnAddRestroom}`} onClick={() => handleAddRoom('restroom')} title={t('floor.addRestroomTitle')}>
              <Bath size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {t('floor.addRestroom')}
            </button>
            <button className={`${styles.secondaryBtn} ${styles.btnResetRooms}`} onClick={handleResetDefaultRooms} title={t('floor.resetRoomsTitle')}>
              <RotateCcw size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              {t('floor.resetRooms')}
            </button>
          </div>
        )}
      </div>

      {/* Floor plan viewport */}
      <div
        className={styles.viewport}
        style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})` }}
      >
        <div
          ref={planRef}
          className={styles.floorPlan}
          style={{ width: PLAN_W, height: PLAN_H }}
        >
          {bgImage
            ? <img src={bgImage} className={styles.bgImg} alt="floor plan" draggable={false} />
            : <div className={styles.gridInner} />
          }

          {/* Empty Building Frame Placeholder (แสดงเมื่อล้างห้องทั้งหมดจนเป็นกรอบว่าง) */}
          {!bgImage && roomList.length === 0 && (
            <div className={styles.emptyBuildingFrame}>
              <div className={styles.emptyBuildingIcon}><Building2 size={36} /></div>
              <div className={styles.emptyBuildingTitle}>{t('floor.emptyFrameTitle')}</div>
              <div className={styles.emptyBuildingSub}>
                {isEditingRooms ? t('floor.emptyFrameEditHint') : t('floor.emptyFrameHint')}
              </div>
            </div>
          )}

          {/* Rooms Layer */}
          {!bgImage && (
            <RoomsLayer
              roomList={roomList}
              isEditingRooms={isEditingRooms}
              activeRoomIndex={activeRoomIndex}
              editingRoomIdx={editingRoomIdx}
              editNameText={editNameText}
              currentFloor={currentFloor}
              onFloorChange={onFloorChange}
              onRoomMouseDown={handleRoomMouseDown}
              onStartRename={handleStartRename}
              onDeleteRoom={handleDeleteRoom}
              onEditNameChange={setEditNameText}
              onSaveRename={handleSaveRename}
              onCancelRename={() => setEditingRoomIdx(null)}
              t={t}
            />
          )}

          {/* Device Pins Layer - ซ่อนในขณะกำลังปรับแต่งผังห้อง */}
          {!isEditingRooms && devices.map(device => (
            <DevicePin
              key={device.id}
              device={device}
              isDragging={draggingDeviceId === device.id}
              isPopupOpen={openPopup?.kind === 'pin' && openPopup.id === device.id}
              isFading={fading && openPopup?.kind === 'pin' && openPopup.id === device.id}
              popupPlacement={getPopupPlacement(device.x, device.y, PLAN_W, PLAN_H)}
              onPinMouseDown={handlePinMouseDown}
              onHoverStart={handleHoverStart}
              onHoverEnd={handleHoverEnd}
              onToggleLock={onToggleLock}
              onDeviceInfo={onDeviceInfo}
            />
          ))}
        </div>
      </div>

      {/* Zoom controls */}
      <div className={styles.zoomCtrl}>
        <button className={styles.zoomBtn} onClick={() => zoom(0.1)} aria-label={t('floor.zoomIn')} title={t('floor.zoomIn')}>
          <ZoomIn size={14} />
        </button>
        <span className={styles.zoomLevel}>{Math.round(scale * 100)}%</span>
        <button className={styles.zoomBtn} onClick={() => zoom(-0.1)} aria-label={t('floor.zoomOut')} title={t('floor.zoomOut')}>
          <ZoomOut size={14} />
        </button>
        <button className={styles.zoomBtn} onClick={fitToViewport} title={t('floor.resetView')}>
          <RotateCcw size={14} />
        </button>
      </div>

      <div className={styles.hint}>
        {isEditingRooms ? t('floor.editRoomsHint') : t('floor.hint')}
      </div>
    </div>
  )
}
