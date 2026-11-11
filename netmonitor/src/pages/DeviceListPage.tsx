import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device, DeviceStatus } from '../types'
import { useNetwork } from '../context/networkContext'
import { useToast } from '../components/ui/toast-context'
import { DEVICE_ICON } from '../constants/deviceMeta'
import {
  Scan,
  Plus,
  Trash2,
  Search,
  X,
  Copy,
  Check,
  MapPin,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import AddDeviceModal from '../components/detail/AddDeviceModal'
import NetworkScanModal from '../components/discovery/NetworkScanModal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import styles from './DeviceListPage.module.css'

type SortKey = 'name' | 'dtype' | 'status' | 'ip' | 'floor'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'all' | DeviceStatus

const STATUS_ORDER: Record<DeviceStatus, number> = { online: 0, warning: 1, offline: 2 }

interface Props {
  onDeviceClick: (device: Device) => void
}

export default function DeviceListPage({ onDeviceClick }: Props) {
  const { t } = useTranslation()
  const { devices, loading, addDevice, removeDevice, clearDevices } = useNetwork()
  const { showToast } = useToast()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [floorFilter, setFloorFilter] = useState<'all' | '1' | '2'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [copiedIpId, setCopiedIpId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [deletingDevice, setDeletingDevice] = useState<Device | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  const onlineCount = useMemo(() => devices.filter(d => d.status === 'online').length, [devices])
  const warningCount = useMemo(() => devices.filter(d => d.status === 'warning').length, [devices])
  const offlineCount = useMemo(() => devices.filter(d => d.status === 'offline').length, [devices])

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = devices.filter(d => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false
      if (floorFilter !== 'all' && String(d.floor) !== floorFilter) return false
      if (q) {
        const matchName = d.name.toLowerCase().includes(q)
        const matchIp = (d.ip ?? '').toLowerCase().includes(q)
        const matchModel = (d.model ?? '').toLowerCase().includes(q)
        const matchType = d.dtype.toLowerCase().includes(q)
        if (!matchName && !matchIp && !matchModel && !matchType) return false
      }
      return true
    })

    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let cmp: number
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'dtype') cmp = a.dtype.localeCompare(b.dtype)
      else if (sortKey === 'status') cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      else if (sortKey === 'ip') cmp = (a.ip ?? '').localeCompare(b.ip ?? '')
      else cmp = a.floor - b.floor
      return cmp * dir || a.name.localeCompare(b.name)
    })
  }, [devices, statusFilter, floorFilter, searchQuery, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function renderSortIcon(key: SortKey) {
    if (sortKey !== key) return null
    return sortDir === 'asc' ? (
      <ChevronUp size={13} style={{ marginLeft: 4, verticalAlign: -2 }} />
    ) : (
      <ChevronDown size={13} style={{ marginLeft: 4, verticalAlign: -2 }} />
    )
  }

  function handleCopyIp(ip: string | undefined, id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!ip) return
    navigator.clipboard.writeText(ip)
    setCopiedIpId(id)
    showToast(t('list.copiedIp') || 'คัดลอก IP แล้ว', 'success')
    setTimeout(() => setCopiedIpId(null), 2000)
  }

  function handleViewOnFloor(device: Device, e: React.MouseEvent) {
    e.stopPropagation()
    localStorage.setItem('netmonitor_floor', String(device.floor))
    localStorage.setItem('netmonitor_page', 'floor')
    window.location.hash = `#/floor?floor=${device.floor}`
  }

  async function handleAddDevice(input: Omit<Device, 'id' | 'x' | 'y'>) {
    const created = await addDevice(input)
    showToast(t('addDevice.success', { name: created.name }), 'success')
    return created
  }

  async function handleConfirmDelete() {
    if (!deletingDevice) return
    const name = deletingDevice.name
    try {
      await removeDevice(deletingDevice.id)
      showToast(t('deleteDevice.success', { name }), 'success')
    } catch {
      showToast(t('common.error'), 'error')
    } finally {
      setDeletingDevice(null)
    }
  }

  return (
    <div className={styles.page}>
      {/* ── Summary KPI Ribbon ── */}
      <div className={styles.kpiRibbon}>
        <button
          type="button"
          className={`${styles.kpiCard} ${statusFilter === 'all' ? styles.kpiCardActive : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>{t('common.all')}</span>
          </div>
          <div className={styles.kpiValue}>{devices.length}</div>
        </button>

        <button
          type="button"
          className={`${styles.kpiCard} ${statusFilter === 'online' ? styles.kpiCardActiveOnline : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'online' ? 'all' : 'online')}
        >
          <div className={styles.kpiHeader}>
            <span className={styles.kpiDot} style={{ background: 'var(--status-online)' }} />
            <span className={styles.kpiLabel}>{t('status.online')}</span>
          </div>
          <div className={styles.kpiValue} style={{ color: 'var(--status-online)' }}>
            {onlineCount}
          </div>
        </button>

        <button
          type="button"
          className={`${styles.kpiCard} ${statusFilter === 'warning' ? styles.kpiCardActiveWarning : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
        >
          <div className={styles.kpiHeader}>
            <span className={styles.kpiDot} style={{ background: 'var(--status-warning)' }} />
            <span className={styles.kpiLabel}>{t('status.warning')}</span>
          </div>
          <div className={styles.kpiValue} style={{ color: 'var(--status-warning)' }}>
            {warningCount}
          </div>
        </button>

        <button
          type="button"
          className={`${styles.kpiCard} ${statusFilter === 'offline' ? styles.kpiCardActiveOffline : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'offline' ? 'all' : 'offline')}
        >
          <div className={styles.kpiHeader}>
            <span className={styles.kpiDot} style={{ background: 'var(--status-critical)' }} />
            <span className={styles.kpiLabel}>{t('status.offline')}</span>
          </div>
          <div className={styles.kpiValue} style={{ color: 'var(--status-critical)' }}>
            {offlineCount}
          </div>
        </button>
      </div>

      {/* ── Action & Filter Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {/* Live Search Input */}
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder={t('list.searchPlaceholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className={styles.clearSearchBtn}
                onClick={() => setSearchQuery('')}
                title="ล้างคำค้นหา"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Floor Dropdown Filter */}
          <select
            className={styles.floorSelect}
            value={floorFilter}
            onChange={e => setFloorFilter(e.target.value as 'all' | '1' | '2')}
            title="กรองตามชั้น"
          >
            <option value="all">{t('list.filterFloorAll')}</option>
            <option value="1">{t('floor.tab', { floor: 1 })}</option>
            <option value="2">{t('floor.tab', { floor: 2 })}</option>
          </select>

          <span className={styles.count}>{t('common.showing', { shown: rows.length, total: devices.length })}</span>
        </div>

        <div className={styles.toolbarRight}>
          <button
            className={styles.scanBtn}
            onClick={() => setScanOpen(true)}
            type="button"
          >
            <Scan size={14} />
            <span>{t('scan.button')}</span>
          </button>

          <button className={styles.addBtn} onClick={() => setAddOpen(true)} type="button">
            <Plus size={14} />
            <span>{t('addDevice.title')}</span>
          </button>

          {devices.length > 0 && (
            <button
              className={styles.clearDevicesBtn}
              onClick={() => setConfirmClearOpen(true)}
              title={t('settings.clearDevicesHint') || 'เคลียร์อุปกรณ์ทั้งหมดออกจากระบบ'}
              type="button"
            >
              <Trash2 size={13} />
              <span>{t('settings.clearDevicesBtn') || 'เคลียร์อุปกรณ์'}</span>
            </button>
          )}
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.sortable} onClick={() => toggleSort('name')}>
                {t('list.colName')} {renderSortIcon('name')}
              </th>
              <th className={styles.sortable} onClick={() => toggleSort('dtype')}>
                {t('list.colType')} {renderSortIcon('dtype')}
              </th>
              <th className={styles.sortable} onClick={() => toggleSort('status')}>
                {t('list.colStatus')} {renderSortIcon('status')}
              </th>
              <th className={styles.sortable} onClick={() => toggleSort('ip')}>
                {t('list.colIp')} {renderSortIcon('ip')}
              </th>
              <th className={styles.sortable} onClick={() => toggleSort('floor')}>
                {t('list.colFloor')} {renderSortIcon('floor')}
              </th>
              <th>{t('list.colModel')}</th>
              <th style={{ width: 100, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr
                key={d.id}
                className={styles.row}
                onClick={() => onDeviceClick(d)}
                title={t('list.viewDetail', { name: d.name })}
              >
                <td className={styles.devName}>{DEVICE_ICON[d.dtype]} {d.name}</td>
                <td className={styles.muted}>{t(`deviceType.${d.dtype}`)}</td>
                <td>
                  <span className={`${styles.badge} ${styles[d.status]}`}>
                    {t(`status.${d.status}`)}
                  </span>
                </td>
                <td className={styles.mono}>{d.ip ?? '—'}</td>
                <td className={styles.muted}>{t('search.floor', { floor: d.floor })}</td>
                <td className={styles.muted}>{d.model ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className={styles.rowActions}>
                    {d.ip && (
                      <button
                        type="button"
                        className={`${styles.rowActionBtn} ${copiedIpId === d.id ? styles.rowActionSuccess : ''}`}
                        onClick={e => handleCopyIp(d.ip, d.id, e)}
                        title={t('list.copyIp')}
                      >
                        {copiedIpId === d.id ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={e => handleViewOnFloor(d, e)}
                      title={t('list.viewOnFloor')}
                    >
                      <MapPin size={13} />
                    </button>
                    <button
                      type="button"
                      className={styles.delBtn}
                      onClick={e => {
                        e.stopPropagation()
                        setDeletingDevice(d)
                      }}
                      title={t('deleteDevice.button')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && rows.length === 0 && (
          <div className={styles.empty}>{t('list.empty')}</div>
        )}
      </div>

      {addOpen && (
        <AddDeviceModal
          open={addOpen}
          existingDevices={devices}
          onClose={() => setAddOpen(false)}
          onAdd={handleAddDevice}
        />
      )}

      {scanOpen && (
        <NetworkScanModal
          open={scanOpen}
          onClose={() => setScanOpen(false)}
        />
      )}

      {deletingDevice && (
        <ConfirmDialog
          open={!!deletingDevice}
          title={t('deleteDevice.title', { name: deletingDevice.name })}
          message={t('deleteDevice.message')}
          confirmLabel={t('deleteDevice.button')}
          danger
          onCancel={() => setDeletingDevice(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      <ConfirmDialog
        open={confirmClearOpen}
        title={t('settings.confirmClearTitle') || 'ยืนยันการเคลียร์อุปกรณ์'}
        message={t('settings.confirmClearMsg') || 'คุณแน่ใจหรือไม่ว่าต้องการลบอุปกรณ์ทั้งหมดออกจากระบบ?'}
        confirmLabel={t('settings.clearDevicesBtn') || 'เคลียร์ทั้งหมด'}
        danger
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={async () => {
          setConfirmClearOpen(false)
          try {
            await clearDevices()
            showToast(t('settings.clearDone') || 'เคลียร์อุปกรณ์ทั้งหมดเรียบร้อยแล้ว', 'success')
          } catch {
            showToast(t('common.error'), 'error')
          }
        }}
      />
    </div>
  )
}
