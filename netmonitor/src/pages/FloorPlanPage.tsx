import { useMemo, useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device, DeviceType, Room } from '../types'
import { getStoredRooms, saveStoredRooms } from '../services/roomStore'
import { useNetwork } from '../context/networkContext'
import { useToast } from '../components/ui/toast-context'
import FloorSidebar from '../components/floor/FloorSidebar'
import FloorCanvas from '../components/floor/FloorCanvas'
import {
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Layers,
  Map,
  LayoutGrid,
  Lock,
  Unlock,
  Scan,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react'
import styles from './FloorPlanPage.module.css'

// Lazy-loaded heavy components (Leaflet map and network scanner)
const FloorMapOverlay = lazy(() => import('../components/floor/FloorMapOverlay'))
const NetworkScanModal = lazy(() => import('../components/discovery/NetworkScanModal'))

interface Props {
  onDeviceInfo: (device: Device) => void
  currentFloor?: 1 | 2
  onFloorChange?: (floor: 1 | 2) => void
}

type StatusFilter = 'all' | 'online' | 'warning' | 'offline'

export default function FloorPlanPage({
  onDeviceInfo,
  currentFloor: controlledFloor,
  onFloorChange,
}: Props) {
  const { t } = useTranslation()
  const {
    devices, loading,
    moveDevice, commitDevicePosition, toggleLock, setFloorLockAll,
  } = useNetwork()
  const { showToast } = useToast()

  const [localFloor, setLocalFloor] = useState<1 | 2>(() => {
    const saved = localStorage.getItem('netmonitor_floor')
    return saved === '2' ? 2 : 1
  })
  const currentFloor = controlledFloor ?? localFloor

  const handleFloorChange = useCallback((f: 1 | 2) => {
    setLocalFloor(f)
    localStorage.setItem('netmonitor_floor', String(f))
    onFloorChange?.(f)
  }, [onFloorChange])

  const [viewMode, setViewMode] = useState<'map' | 'canvas'>(() => {
    const saved = localStorage.getItem('netmonitor_view_mode')
    return saved === 'canvas' ? 'canvas' : 'map'
  })

  const handleViewModeChange = useCallback((mode: 'map' | 'canvas') => {
    setViewMode(mode)
    localStorage.setItem('netmonitor_view_mode', mode)
  }, [])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<Set<DeviceType>>(() => new Set())
  const [scanOpen, setScanOpen] = useState(false)
  const [isEditingRooms, setIsEditingRooms] = useState(false)
  const [moveModeActive, setMoveModeActive] = useState(false)

  const floorDevices = useMemo(
    () => devices.filter(d => d.floor === currentFloor),
    [devices, currentFloor],
  )

  const floorCounts = useMemo(() => ({
    online: floorDevices.filter(d => d.status === 'online').length,
    warning: floorDevices.filter(d => d.status === 'warning').length,
    offline: floorDevices.filter(d => d.status === 'offline').length,
  }), [floorDevices])

  const isMoveMode = moveModeActive || (floorDevices.length > 0 && floorDevices.some(d => !d.locked))

  const handleToggleMoveMode = useCallback(() => {
    if (isMoveMode) {
      setFloorLockAll(currentFloor, true)
      setMoveModeActive(false)
      showToast(t('floor.lockedAllToast') || 'ล็อคตำแหน่งอุปกรณ์ทั้งหมดแล้ว', 'info')
    } else {
      setFloorLockAll(currentFloor, false)
      setMoveModeActive(true)
      showToast(t('floor.unlockedAllToast') || 'ปลดล็อคอุปกรณ์: สามารถคลิกลากย้ายตำแหน่งได้ทันที', 'success')
    }
  }, [isMoveMode, currentFloor, setFloorLockAll, showToast, t])
  const [floorRooms, setFloorRooms] = useState<Room[]>(() => getStoredRooms(currentFloor))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFloorRooms(getStoredRooms(currentFloor))
  }, [currentFloor])

  const handleRoomsChange = useCallback((updated: Room[]) => {
    setFloorRooms(updated)
    saveStoredRooms(currentFloor, updated)
  }, [currentFloor])

  const visibleDevices = floorDevices.filter(d =>
    (filterStatus === 'all' || d.status === filterStatus) &&
    (typeFilter.size === 0 || typeFilter.has(d.dtype))
  )

  const hasActiveFilter = filterStatus !== 'all' || typeFilter.size > 0

  // ── Type filter (multi-select) ────────────────────────────
  function handleTypeToggle(dtype: DeviceType) {
    setTypeFilter(prev => {
      const next = new Set(prev)
      if (next.has(dtype)) next.delete(dtype)
      else next.add(dtype)
      return next
    })
  }

  function handleTypeClear() {
    setTypeFilter(new Set())
  }

  function handleClearFilters() {
    setFilterStatus('all')
    setTypeFilter(new Set())
  }

  return (
    <div className={styles.layout}>
      <FloorSidebar
        devices={devices}
        floorDevices={floorDevices}
        filterStatus={filterStatus}
        onFilter={setFilterStatus}
        typeFilter={typeFilter}
        onTypeToggle={handleTypeToggle}
        onTypeClear={handleTypeClear}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(prev => !prev)}
        onSelectDevice={onDeviceInfo}
      />

      <div className={styles.main}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          {/* Toggle Sidebar Button */}
          <button
            className={`${styles.sidebarToggle} ${sidebarOpen ? styles.sidebarToggleOpen : styles.sidebarToggleCollapsed}`}
            onClick={() => setSidebarOpen(prev => !prev)}
            title={sidebarOpen ? t('floor.collapseSidebar') : t('floor.expandSidebar')}
            aria-label={sidebarOpen ? t('floor.collapseSidebar') : t('floor.expandSidebar')}
          >
            <SlidersHorizontal size={16} className={styles.filterIconImg} />
            <span className={styles.toggleArrow}>{sidebarOpen ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}</span>
          </button>

          <span className={styles.toolLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Layers size={16} />
            <span>{t('floor.title')}</span>
          </span>
          <div className={styles.divider} />

          {/* Floor switcher */}
          <div className={styles.floorTabs}>
            {([1, 2] as const).map(f => (
              <button
                key={f}
                className={`${styles.floorTab} ${currentFloor === f ? styles.floorTabActive : ''}`}
                onClick={() => handleFloorChange(f)}
              >
                {t('floor.tab', { floor: f })}
              </button>
            ))}
          </div>

          {/* View mode switcher */}
          <div className={styles.viewModeToggle}>
            <button
              className={`${styles.viewBtn} ${viewMode === 'map' ? styles.viewBtnActive : ''}`}
              onClick={() => handleViewModeChange('map')}
              title={t('floor.viewMap')}
            >
              <Map size={15} />
              <span>{t('floor.viewMap')}</span>
            </button>
            <button
              className={`${styles.viewBtn} ${viewMode === 'canvas' ? styles.viewBtnActive : ''}`}
              onClick={() => handleViewModeChange('canvas')}
              title={t('floor.viewCanvas')}
            >
              <LayoutGrid size={15} />
              <span>{t('floor.viewCanvas')}</span>
            </button>
          </div>

          <button
            className={`${styles.moveModeBtn} ${isMoveMode ? styles.moveModeActive : ''}`}
            onClick={handleToggleMoveMode}
            title={isMoveMode ? t('floor.lockPositionsTitle') : t('floor.moveModeTitle')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {isMoveMode ? <Lock size={14} /> : <Unlock size={14} />}
            <span>{isMoveMode ? t('floor.lockPositions') : t('floor.moveMode')}</span>
          </button>

          <button
            className={styles.scanBtn}
            onClick={() => setScanOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Scan size={14} />
            <span>{t('scan.button')}</span>
          </button>
        </div>

        {/* Floor badge & Quick Status Filter */}
        <div className={styles.floorBadge}>
          <span>{t('floor.buildingA', { floor: currentFloor })}</span>

          {floorDevices.length > 0 && (
            <div className={styles.floorStatusPillGroup}>
              <button
                type="button"
                className={`${styles.floorStatusPill} ${filterStatus === 'online' ? styles.pillActiveOnline : ''}`}
                onClick={() => setFilterStatus(filterStatus === 'online' ? 'all' : 'online')}
                title="กรองเฉพาะอุปกรณ์ออนไลน์"
              >
                <CheckCircle2 size={12} style={{ color: 'var(--status-online)' }} />
                <span>{floorCounts.online} {t('status.online')}</span>
              </button>
              {floorCounts.warning > 0 && (
                <button
                  type="button"
                  className={`${styles.floorStatusPill} ${filterStatus === 'warning' ? styles.pillActiveWarning : ''}`}
                  onClick={() => setFilterStatus(filterStatus === 'warning' ? 'all' : 'warning')}
                  title="กรองเฉพาะอุปกรณ์เตือน"
                >
                  <AlertTriangle size={12} style={{ color: 'var(--status-warning)' }} />
                  <span>{floorCounts.warning} {t('status.warning')}</span>
                </button>
              )}
              {floorCounts.offline > 0 && (
                <button
                  type="button"
                  className={`${styles.floorStatusPill} ${filterStatus === 'offline' ? styles.pillActiveOffline : ''}`}
                  onClick={() => setFilterStatus(filterStatus === 'offline' ? 'all' : 'offline')}
                  title="กรองเฉพาะอุปกรณ์ออฟไลน์"
                >
                  <XCircle size={12} style={{ color: 'var(--status-critical)' }} />
                  <span>{floorCounts.offline} {t('status.offline')}</span>
                </button>
              )}
            </div>
          )}

          {isMoveMode && (
            <span className={styles.moveModeHintBadge}>
              {t('floor.moveModeHint')}
            </span>
          )}
          {loading && <span className={styles.emptyHint}>{t('common.loading')}</span>}
          {hasActiveFilter && (
            <>
              <span className={styles.resultBadge}>
                {t('common.showing', { shown: visibleDevices.length, total: floorDevices.length })}
              </span>
              <button className={styles.clearFilters} onClick={handleClearFilters}>
                {t('floor.clearFilters')}
              </button>
            </>
          )}
          {!loading && floorDevices.length === 0 && (
            <span className={styles.emptyHint}> {t('floor.noDevicesHint')}</span>
          )}
        </div>

        <div className={styles.canvasArea}>
          {viewMode === 'map' ? (
            <Suspense fallback={<div className={styles.mapLoading}>{t('common.loading')}</div>}>
              <FloorMapOverlay
                devices={visibleDevices}
                rooms={floorRooms}
                currentFloor={currentFloor}
                onFloorChange={handleFloorChange}
                onDeviceInfo={onDeviceInfo}
                onDeviceMove={moveDevice}
                onDeviceMoveEnd={commitDevicePosition}
                onToggleLock={toggleLock}
              />
            </Suspense>
          ) : (
            <FloorCanvas
              devices={visibleDevices}
              rooms={floorRooms}
              currentFloor={currentFloor}
              onFloorChange={handleFloorChange}
              onDeviceInfo={onDeviceInfo}
              onDeviceMove={moveDevice}
              onDeviceMoveEnd={commitDevicePosition}
              onToggleLock={toggleLock}
              onRoomsChange={handleRoomsChange}
              onEditingRoomsChange={setIsEditingRooms}
            />
          )}

          {viewMode === 'canvas' && !loading && !isEditingRooms && visibleDevices.length === 0 && (
            <div className={styles.emptyOverlay}>
              <div className={styles.emptyCard}>
                {floorDevices.length === 0 ? (
                  <>
                    <div className={styles.emptyTitle}>{t('floor.emptyTitle')}</div>
                    <div className={styles.emptySub}>{t('floor.emptySub')}</div>
                  </>
                ) : (
                  <>
                    <div className={styles.emptyTitle}>{t('floor.noMatchTitle')}</div>
                    <button className={styles.emptyClear} onClick={handleClearFilters}>
                      {t('floor.clearFiltersShort')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {scanOpen && (
        <Suspense fallback={null}>
          <NetworkScanModal
            open={scanOpen}
            defaultFloor={currentFloor}
            onClose={() => setScanOpen(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
