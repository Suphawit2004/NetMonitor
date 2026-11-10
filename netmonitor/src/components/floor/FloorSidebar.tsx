import { memo, useState, useMemo, type ReactNode } from 'react'
import type { Device, DeviceType } from '../../types'
import { useTranslation } from 'react-i18next'
import { DEVICE_ICON } from '../../constants/deviceMeta'
import {
  LayoutGrid,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Server,
  Search,
  Lock,
  SlidersHorizontal,
  List,
} from 'lucide-react'
import styles from './FloorSidebar.module.css'

type StatusFilter = 'all' | 'online' | 'warning' | 'offline'

interface Props {
  devices: Device[]        // ALL devices (ทุกชั้น) — ใช้แสดงรวม
  floorDevices: Device[]   // devices ชั้นที่กำลังดูอยู่
  filterStatus: StatusFilter
  onFilter: (s: StatusFilter) => void
  typeFilter: Set<DeviceType>
  onTypeToggle: (dtype: DeviceType) => void
  onTypeClear: () => void
  isOpen?: boolean
  onToggle?: () => void
  onSelectDevice?: (device: Device) => void
}

const STATUS_FILTERS: { key: StatusFilter; icon: ReactNode; labelKey: string }[] = [
  { key: 'all',     icon: <LayoutGrid size={13} />, labelKey: 'common.all' },
  { key: 'online',  icon: <CheckCircle2 size={13} style={{ color: 'var(--status-online)' }} />, labelKey: 'status.online' },
  { key: 'warning', icon: <AlertTriangle size={13} style={{ color: 'var(--status-warning)' }} />, labelKey: 'status.warning' },
  { key: 'offline', icon: <XCircle size={13} style={{ color: 'var(--status-critical)' }} />, labelKey: 'status.offline' },
]

const DEVICE_TYPES: DeviceType[] = ['switch', 'ap', 'router', 'server']

function FloorSidebar({
  devices, floorDevices, filterStatus, onFilter,
  typeFilter, onTypeToggle, onTypeClear,
  isOpen = true,
  onSelectDevice,
}: Props) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'filters' | 'devices'>('filters')
  const [searchQuery, setSearchQuery] = useState('')

  // facet: อุปกรณ์ที่ผ่านตัวกรองอีกแกน (type → ใช้กับสถานะ)
  const byType = typeFilter.size === 0
    ? floorDevices
    : floorDevices.filter(d => typeFilter.has(d.dtype))

  // counts for current floor (ภายใต้ type filter)
  const counts: Record<StatusFilter, number> = {
    all:     byType.length,
    online:  byType.filter(d => d.status === 'online').length,
    warning: byType.filter(d => d.status === 'warning').length,
    offline: byType.filter(d => d.status === 'offline').length,
  }

  // facet: อุปกรณ์ที่ผ่านตัวกรองสถานะ (status → ใช้กับประเภท)
  const byStatus = filterStatus === 'all'
    ? floorDevices
    : floorDevices.filter(d => d.status === filterStatus)

  // Matching devices under BOTH status and type filters
  const filteredDevices = useMemo(() => {
    return floorDevices.filter(d =>
      (filterStatus === 'all' || d.status === filterStatus) &&
      (typeFilter.size === 0 || typeFilter.has(d.dtype))
    )
  }, [floorDevices, filterStatus, typeFilter])

  // Searched devices in the "Devices" tab
  const searchedDevices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return floorDevices
    return floorDevices.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.ip ?? '').toLowerCase().includes(q) ||
      (d.model ?? '').toLowerCase().includes(q) ||
      d.dtype.includes(q)
    )
  }, [floorDevices, searchQuery])

  // total across all floors
  const totalAll     = devices.length
  const totalOnline  = devices.filter(d => d.status === 'online').length
  const totalWarning = devices.filter(d => d.status === 'warning').length
  const totalOffline = devices.filter(d => d.status === 'offline').length

  return (
    <div className={`${styles.sidebarWrapper} ${isOpen ? styles.wrapperOpen : styles.wrapperCollapsed}`}>
      <aside className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : styles.sidebarCollapsed}`}>
        {/* หัวข้อ Sidebar */}
        <div className={styles.sidebarHeader}>
          <div className={styles.headerTitle}>
            <span>{t('floor.sidebarTitle')}</span>
          </div>
        </div>

        {/* Tab Switcher: Filters vs Devices */}
        <div className={styles.tabRow} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'filters'}
            className={`${styles.tabBtn} ${activeTab === 'filters' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('filters')}
          >
            <SlidersHorizontal size={13} />
            <span>{t('floor.tabFilters')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'devices'}
            className={`${styles.tabBtn} ${activeTab === 'devices' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('devices')}
          >
            <List size={13} />
            <span>{t('floor.tabDevices', { count: floorDevices.length })}</span>
          </button>
        </div>

        <div className={styles.sidebarContent}>
          {activeTab === 'filters' && (
            <>
              <div className={styles.section}>{t('floor.statusFilterThisFloor')}</div>

              {STATUS_FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`${styles.item} ${filterStatus === f.key ? styles.active : ''}`}
                  onClick={() => onFilter(f.key)}
                >
                  <span className={styles.icon}>{f.icon}</span>
                  <span className={styles.label}>{f.labelKey ? t(f.labelKey) : f.key}</span>
                  <span className={`${styles.badge} ${f.key === 'warning' ? styles.badgeWarn : f.key === 'offline' ? styles.badgeErr : ''}`}>
                    {counts[f.key]}
                  </span>
                </button>
              ))}

              {/* รวมทุกชั้น */}
              <div className={`${styles.section} ${styles.sectionGap}`}>{t('floor.allFloors')}</div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryItem} style={{ color: 'var(--status-online)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={13} /> {totalOnline}
                </span>
                <span className={styles.summaryItem} style={{ color: 'var(--status-warning)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={13} /> {totalWarning}
                </span>
                <span className={styles.summaryItem} style={{ color: 'var(--status-critical)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <XCircle size={13} /> {totalOffline}
                </span>
                <span className={styles.summaryItem} style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Server size={13} />
                  {totalAll}
                </span>
              </div>

              <div className={`${styles.section} ${styles.sectionGap}`}>{t('floor.typeFilterThisFloor')}</div>
              <button
                className={`${styles.item} ${typeFilter.size === 0 ? styles.active : ''}`}
                onClick={onTypeClear}
                aria-pressed={typeFilter.size === 0}
                title={t('floor.showAllTypes')}
              >
                <span className={styles.icon} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <LayoutGrid size={14} />
                </span>
                <span className={styles.label}>{t('common.all')}</span>
                <span className={styles.badge}>{byStatus.length}</span>
              </button>

              {DEVICE_TYPES.map(dtype => {
                const selected = typeFilter.has(dtype)
                return (
                  <button
                    key={dtype}
                    className={`${styles.item} ${styles.typeBtn} ${styles[`type_${dtype}`]} ${selected ? styles.typeActive : ''}`}
                    onClick={() => onTypeToggle(dtype)}
                    aria-pressed={selected}
                    title={selected ? t('floor.filterOn') : t('floor.filterOff')}
                  >
                    <span className={styles.typeDot} aria-hidden="true" />
                    <span className={styles.label}>{DEVICE_ICON[dtype]} {t(`deviceType.${dtype}`)}</span>
                    <span className={styles.badge}>
                      {byStatus.filter(d => d.dtype === dtype).length}
                    </span>
                  </button>
                )
              })}

              {/* Fast Jump to filtered devices */}
              {onSelectDevice && filteredDevices.length > 0 && (
                <>
                  <div className={`${styles.section} ${styles.sectionGap}`}>
                    {t('floor.filterResults', { count: filteredDevices.length })}
                  </div>
                  <div className={styles.deviceList}>
                    {filteredDevices.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        className={styles.deviceRow}
                        onClick={() => onSelectDevice(d)}
                        title={t('floor.locateOnPlan')}
                      >
                        <span className={`${styles.deviceStatusDot} ${styles[`dot_${d.status}`]}`} />
                        <span className={styles.deviceRowIcon}>{DEVICE_ICON[d.dtype]}</span>
                        <div className={styles.deviceRowInfo}>
                          <span className={styles.deviceRowName}>{d.name}</span>
                          <span className={styles.deviceRowMeta}>{d.ip ?? '—'}</span>
                        </div>
                        {d.locked && <Lock size={11} style={{ color: 'var(--text-muted)' }} />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === 'devices' && (
            <>
              <div className={styles.searchWrap}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder={t('floor.searchDevicesPlaceholder')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              <div className={styles.deviceList}>
                {searchedDevices.length === 0 ? (
                  <div className={styles.emptyList}>{t('floor.noDevicesFound')}</div>
                ) : (
                  searchedDevices.map(d => (
                    <button
                      key={d.id}
                      type="button"
                      className={styles.deviceRow}
                      onClick={() => onSelectDevice?.(d)}
                      title={t('floor.locateOnPlan')}
                    >
                      <span className={`${styles.deviceStatusDot} ${styles[`dot_${d.status}`]}`} />
                      <span className={styles.deviceRowIcon}>{DEVICE_ICON[d.dtype]}</span>
                      <div className={styles.deviceRowInfo}>
                        <span className={styles.deviceRowName}>{d.name}</span>
                        <span className={styles.deviceRowMeta}>{d.ip ?? '—'}</span>
                      </div>
                      {d.locked && <Lock size={11} style={{ color: 'var(--text-muted)' }} />}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function areSidebarPropsEqual(prev: Props, next: Props): boolean {
  if (prev.isOpen !== next.isOpen) return false
  if (prev.filterStatus !== next.filterStatus) return false
  if (prev.typeFilter !== next.typeFilter) return false
  if (prev.devices.length !== next.devices.length) return false
  if (prev.floorDevices.length !== next.floorDevices.length) return false
  if (prev.onSelectDevice !== next.onSelectDevice) return false

  // Fast check: skipping re-render if device movement (x, y) is the only difference
  for (let i = 0; i < prev.devices.length; i++) {
    const p = prev.devices[i]
    const n = next.devices[i]
    if (p.id !== n.id || p.status !== n.status || p.dtype !== n.dtype || p.floor !== n.floor || p.locked !== n.locked) {
      return false
    }
  }
  for (let i = 0; i < prev.floorDevices.length; i++) {
    const p = prev.floorDevices[i]
    const n = next.floorDevices[i]
    if (p.id !== n.id || p.status !== n.status || p.dtype !== n.dtype || p.locked !== n.locked) {
      return false
    }
  }
  return true
}

export default memo(FloorSidebar, areSidebarPropsEqual)
