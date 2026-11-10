import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Alert, Device, DeviceStatus, DeviceType } from '../types'
import { useNetwork } from '../context/networkContext'
import { useSimulation } from '../context/simulationContext'
import { useToast } from '../components/ui/toast-context'
import { buildDeviceDetail } from '../services/detailFactory'
import { fetchAlerts } from '../services/api'
import { formatTimeAgo } from '../i18n/format'
import { DEVICE_ICON } from '../constants/deviceMeta'
import { BarChart3, Download, AlertOctagon, AlertTriangle, Info } from 'lucide-react'
import styles from './ReportsPage.module.css'

const TYPE_LABEL_KEYS: Record<DeviceType, string> = {
  switch: 'deviceType.switch', ap: 'deviceType.ap', router: 'deviceType.router', server: 'deviceType.server',
}

const TYPE_COLOR: Record<DeviceType, string> = {
  switch: '#4f9eff', ap: '#a78bfa', router: '#f59e0b', server: '#22c55e',
}

const STATUS_META: { key: DeviceStatus; color: string }[] = [
  { key: 'online',  color: '#22c55e' },
  { key: 'warning', color: '#fbbf24' },
  { key: 'offline', color: '#ef4444' },
]

interface Props {
  onDeviceInfo: (device: Device) => void
}

export default function ReportsPage({ onDeviceInfo }: Props) {
  const { t } = useTranslation()
  const { devices } = useNetwork()
  const { tick } = useSimulation()
  const { showToast } = useToast()
  const [dbAlerts, setDbAlerts] = useState<Alert[]>([])

  useEffect(() => {
    fetchAlerts().then(list => {
      if (list && list.length > 0) setDbAlerts(list)
    })
  }, [tick])

  const total = devices.length
  const counts = useMemo<Record<DeviceStatus, number>>(() => ({
    online:  devices.filter(d => d.status === 'online').length,
    warning: devices.filter(d => d.status === 'warning').length,
    offline: devices.filter(d => d.status === 'offline').length,
  }), [devices])

  const typeCounts = useMemo(() => {
    const list: { type: DeviceType; count: number }[] = (Object.keys(TYPE_LABEL_KEYS) as DeviceType[])
      .map(type => ({ type, count: devices.filter(d => d.dtype === type).length }))
    return list
  }, [devices])

  const maxTypeCount = Math.max(...typeCounts.map(t => t.count), 1)

  // การแจ้งเตือนที่ต้องดำเนินการ (รวม alert จาก DB และ alert จำลองของอุปกรณ์ที่ไม่ปกติ)
  const activeAlerts = useMemo(() => {
    const out: { device: Device; alert: Alert }[] = []
    const seenDevices = new Set<string>()

    // 1. ดึง Alert จริงที่มีระดับ warn หรือ crit จากฐานข้อมูล
    for (const a of dbAlerts) {
      if (a.severity === 'info') continue
      const dev = devices.find(d => String(d.id) === String(a.deviceId))
      if (dev) {
        out.push({ device: dev, alert: a })
        seenDevices.add(String(a.deviceId))
      }
    }

    // 2. เติม Alert จาก Detail ของอุปกรณ์ที่เป็น Warning / Offline ที่ยังไม่มีใน DB
    for (const d of devices) {
      if (d.status === 'online' || seenDevices.has(String(d.id))) continue
      const detail = buildDeviceDetail(d, devices, tick)
      for (const a of detail.alerts) {
        if (a.severity !== 'info') out.push({ device: d, alert: a })
      }
    }
    return out.slice(0, 10)
  }, [devices, dbAlerts, tick])

  // ── Donut ──
  const R = 42
  const C = 2 * Math.PI * R
  const donutSegments = useMemo(() => {
    const lens = STATUS_META.map(m => (total > 0 ? (counts[m.key] / total) * C : 0))
    return STATUS_META.map((m, i) => {
      const offset = lens.slice(0, i).reduce((sum, v) => sum + v, 0)
      return { ...m, len: lens[i], offset }
    })
  }, [counts, total, C])

  // quote field เมื่อมีตัวอักษรที่ทำ CSV เสียโครงสร้าง (comma, quote, newline)
  function csvEscape(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  }

  function handleExport() {
    const header = ['name', 'type', 'status', 'floor', 'ip', 'model']
    const lines = devices.map(d =>
      [d.name, d.dtype, d.status, String(d.floor), d.ip ?? '', d.model ?? '']
        .map(csvEscape)
        .join(','),
    )
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'netmonitor-devices.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    showToast(t('reports.exportDone'), 'success')
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart3 size={24} />
            <span>{t('reports.title')}</span>
          </div>
          <div className={styles.sub}>{t('reports.sub', { total })}</div>
        </div>
        <button className={styles.exportBtn} onClick={handleExport} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={14} />
          <span>{t('reports.export')}</span>
        </button>
      </div>

      {/* Summary cards */}
      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <div className={styles.statNum}>{total}</div>
          <div className={styles.statLbl}>{t('reports.total')}</div>
        </div>
        {STATUS_META.map(m => (
          <div key={m.key} className={styles.statCard}>
            <div className={styles.statNum} style={{ color: m.color }}>{counts[m.key]}</div>
            <div className={styles.statLbl}>
              {t(`status.${m.key}`)}
              <span className={styles.statPct}>
                {total > 0 ? Math.round((counts[m.key] / total) * 100) : 0}%
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.cols}>
        {/* By type */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>{t('reports.byType')}</div>
          {typeCounts.map(tc => (
            <div key={tc.type} className={styles.barRow}>
              <span className={styles.barLabel} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {DEVICE_ICON[tc.type]}
                <span>{t(TYPE_LABEL_KEYS[tc.type])}</span>
              </span>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{
                    width: `${(tc.count / maxTypeCount) * 100}%`,
                    background: TYPE_COLOR[tc.type],
                  }}
                />
              </div>
              <span className={styles.barValue}>{tc.count}</span>
            </div>
          ))}
        </div>

        {/* By status donut */}
        <div className={styles.card}>
          <div className={styles.cardTitle}>{t('reports.statusShare')}</div>
          <div className={styles.donutWrap}>
            <svg width="130" height="130" viewBox="0 0 120 120" aria-label="Status donut chart">
              <circle cx="60" cy="60" r={R} fill="none" stroke="var(--bg-elevated)" strokeWidth="14" />
              {donutSegments.map(s => (
                s.len > 0 && (
                  <circle
                    key={s.key}
                    cx="60" cy="60" r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="14"
                    strokeDasharray={`${s.len} ${C - s.len}`}
                    strokeDashoffset={-s.offset}
                    transform="rotate(-90 60 60)"
                  />
                )
              ))}
              <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--text-primary)">
                {total}
              </text>
              <text x="60" y="74" textAnchor="middle" fontSize="12" fill="var(--text-muted)">
                {t('nav.list')}
              </text>
            </svg>

            <div className={styles.legend}>
              {STATUS_META.map(m => (
                <span key={m.key} className={styles.legItem}>
                  <span className={styles.legDot} style={{ background: m.color }} />
                  {t(`status.${m.key}`)} · {counts[m.key]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Active alerts */}
      <div className={styles.card}>
        <div className={styles.cardTitle}>{t('reports.activeAlerts', { count: activeAlerts.length })}</div>
        {activeAlerts.length === 0 ? (
          <div className={styles.emptyText}>{t('reports.noAlerts')}</div>
        ) : (
          activeAlerts.map(({ device, alert }) => {
            const msg = alert.messageKey ? t(alert.messageKey, alert.params) : (alert.title || 'Alert')
            // eslint-disable-next-line react-hooks/purity
            const minutesAgo = alert.timeMinutesAgo ?? (alert.createdAt ? Math.max(1, Math.round((Date.now() - new Date(alert.createdAt).getTime()) / 60000)) : 0)
            return (
              <button
                key={`${device.id}-${alert.id}`}
                type="button"
                className={styles.alertItem}
                onClick={() => onDeviceInfo(device)}
                title={t('reports.openInfo', { name: device.name })}
              >
                <span className={styles.alertIcon} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {alert.severity === 'crit' ? (
                    <AlertOctagon size={16} style={{ color: 'var(--status-critical)' }} />
                  ) : alert.severity === 'warn' ? (
                    <AlertTriangle size={16} style={{ color: 'var(--status-warning)' }} />
                  ) : (
                    <Info size={16} style={{ color: 'var(--accent-primary)' }} />
                  )}
                </span>
                <div className={styles.alertBody}>
                  <div className={styles.alertMsg}>{msg}</div>
                  <div className={styles.alertMeta}>{device.name} · {formatTimeAgo(minutesAgo, t)}</div>
                </div>
                <span className={`${styles.sev} ${alert.severity === 'crit' ? styles.crit : styles.warn}`}>
                  {alert.severity.toUpperCase()}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
