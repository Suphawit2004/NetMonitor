import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Alert, Device, DeviceStatus, DeviceType } from '../types'
import { useNetwork } from '../context/networkContext'
import { useSimulation } from '../context/simulationContext'
import { useFaultSim } from '../context/faultSimContext'
import { useToast } from '../components/ui/toast-context'
import { buildDeviceDetail } from '../services/detailFactory'
import { fetchAlerts, acknowledgeAlert } from '../services/api'
import { formatTimeAgo } from '../i18n/format'
import { DEVICE_ICON } from '../constants/deviceMeta'
import BusinessImpactSummary from '../components/simulation/BusinessImpactSummary'
import {
  BarChart3,
  Download,
  AlertOctagon,
  AlertTriangle,
  Info,
  Check,
  ServerCrash,
  GitFork,
  RotateCcw,
  FlaskConical,
} from 'lucide-react'
import styles from './ReportsPage.module.css'

const TYPE_LABEL_KEYS: Record<DeviceType, string> = {
  switch: 'deviceType.switch', ap: 'deviceType.ap', router: 'deviceType.router', server: 'deviceType.server',
}

const TYPE_COLOR: Record<DeviceType, string> = {
  switch: 'var(--accent-primary)',
  ap: '#5b4b8a',
  router: 'var(--status-warning)',
  server: 'var(--status-online)',
}

const STATUS_META: { key: DeviceStatus; color: string }[] = [
  { key: 'online',  color: 'var(--status-online)' },
  { key: 'warning', color: 'var(--status-warning)' },
  { key: 'offline', color: 'var(--status-critical)' },
]

interface Props {
  onDeviceInfo: (device: Device) => void
  onOpenFullDetail?: (device: Device) => void
}

export default function ReportsPage({ onDeviceInfo, onOpenFullDetail }: Props) {
  const { t } = useTranslation()
  const { devices, retryDevices } = useNetwork()
  const { tick } = useSimulation()
  const {
    isSimMode,
    downDeviceIds,
    downLinkIds,
    effectiveReport,
    effectiveDevices,
    simulateSingleDeviceDown,
    toggleDeviceDown,
    resetSimulation,
    setSimMode,
  } = useFaultSim()
  const { showToast } = useToast()
  const [dbAlerts, setDbAlerts] = useState<Alert[]>([])

  // Determine whether sandbox faults are active for UI counts & labels; effectiveReport handles live fallback.
  const hasSimFaults = isSimMode && (downDeviceIds.size > 0 || downLinkIds.size > 0)

  const impactedDevices = useMemo(() => {
    const order = { root_down: 0, unreachable: 1, degraded: 2, healthy: 3 }
    return effectiveReport.device_impacts
      .filter(d => d.impact_state !== 'healthy')
      .sort(
        (a, b) =>
          order[a.impact_state] - order[b.impact_state] ||
          a.dependency_path.length - b.dependency_path.length ||
          a.name.localeCompare(b.name),
      )
  }, [effectiveReport.device_impacts])

  async function handleAcknowledge(e: React.MouseEvent, alertId: string | number) {
    e.stopPropagation()
    const ok = await acknowledgeAlert(alertId)
    if (ok) {
      showToast(t('alerts.ackSuccess'), 'success')
      setDbAlerts(prev => prev.filter(a => String(a.id) !== String(alertId)))
      retryDevices()
    } else {
      showToast(t('reports.ackFailed'), 'error')
    }
  }

  useEffect(() => {
    let active = true
    fetchAlerts().then(list => {
      if (active) setDbAlerts(list)
    })
    return () => { active = false }
  }, [devices, tick])

  const total = devices.length
  const counts = useMemo<Record<DeviceStatus, number>>(() => ({
    online:  effectiveDevices.filter(d => d.status === 'online').length,
    warning: effectiveDevices.filter(d => d.status === 'warning').length,
    offline: effectiveDevices.filter(d => d.status === 'offline').length,
  }), [effectiveDevices])

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
                    minWidth: tc.count > 0 ? 2 : 0,
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
              <text x="60" y="71" textAnchor="middle" fontSize="10" fontWeight="500" fill="var(--text-muted)">
                {t('reports.devicesLabel')}
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

      {/* Outage & Device-to-Device Impact Section */}
      <div className={styles.cols} data-testid="reports-outage-section">
        {/* Left: Active Outages & Cascading Chains */}
        <div className={styles.card}>
          <div className={styles.outageHeader}>
            <div>
              <div className={styles.cardTitle} style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <ServerCrash size={16} style={{ color: 'var(--status-critical)' }} />
                <span>{t('reports.outageChainTitle')}</span>
              </div>
              <div className={styles.outageSub}>
                {hasSimFaults ? t('reports.outageChainSimSub') : t('reports.outageChainLiveSub')}
              </div>
            </div>
            {hasSimFaults && (
              <button
                type="button"
                className={styles.resetSimBtn}
                onClick={() => {
                  resetSimulation()
                  setSimMode(false)
                }}
              >
                <RotateCcw size={12} />
                <span>{t('sim.resetSandbox')}</span>
              </button>
            )}
          </div>

          <div className={styles.outageMiniKpis}>
            <div className={styles.miniKpi}>
              <span className={styles.miniKpiVal} style={{ color: 'var(--status-critical)' }}>
                {effectiveReport.summary.root_down_count}
              </span>
              <span className={styles.miniKpiLbl}>{t('sim.kpiRootDown')}</span>
            </div>
            <div className={styles.miniKpi}>
              <span className={styles.miniKpiVal} style={{ color: 'var(--status-warning)' }}>
                {effectiveReport.summary.unreachable_count}
              </span>
              <span className={styles.miniKpiLbl}>{t('sim.kpiUnreachable')}</span>
            </div>
            <div className={styles.miniKpi}>
              <span className={styles.miniKpiVal} style={{ color: 'var(--status-warning)' }}>
                {effectiveReport.summary.degraded_count}
              </span>
              <span className={styles.miniKpiLbl}>{t('sim.kpiDegraded')}</span>
            </div>
          </div>

          <BusinessImpactSummary
            zones={effectiveReport.affected_zones}
            services={effectiveReport.affected_services}
            variant="report"
            testId="reports-business-impact"
          />

          {impactedDevices.length === 0 ? (
            <div className={styles.emptyText}>{t('reports.noOutageImpact')}</div>
          ) : (
            <div className={styles.outageList}>
              {impactedDevices.map(item => {
                const dev = devices.find(d => d.id === item.device_id)
                const chainText =
                  item.dependency_path.length > 1
                    ? item.dependency_path.join(' ➔ ')
                    : t(`sim.reason_${item.impact_state}`)
                return (
                  <button
                    key={item.device_id}
                    type="button"
                    className={styles.outageRow}
                    onClick={() => dev && (onOpenFullDetail ? onOpenFullDetail(dev) : onDeviceInfo(dev))}
                  >
                    <span className={styles.outageIcon}>{DEVICE_ICON[item.dtype]}</span>
                    <div className={styles.outageInfo}>
                      <div className={styles.outageName}>
                        <span>{item.name}</span>
                        <span className={styles.floorBadge}>{`F${item.floor}`}</span>
                      </div>
                      <div className={styles.outageChain} data-testid="report-dependency-chain">
                        {chainText}
                      </div>
                    </div>
                    <span
                      className={`${styles.sev} ${
                        item.impact_state === 'degraded' || item.impact_state === 'unreachable'
                          ? styles.warn
                          : styles.crit
                      }`}
                    >
                      {t(`sim.state_${item.impact_state}`)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Device-by-Device Impact Matrix (What happens if Device X goes down) */}
        <div className={`${styles.card} ${styles.matrixCard}`}>
          <div className={styles.matrixHead}>
            <div>
              <div className={styles.cardTitle} style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <GitFork size={16} style={{ color: 'var(--accent-primary)' }} />
                <span>{t('reports.impactMatrixTitle')}</span>
              </div>
              <div className={styles.outageSub}>{t('reports.impactMatrixSub')}</div>
            </div>
            <span className={styles.matrixBadgeCount}>{`${effectiveReport.spof_ranking.length} / ${devices.length}`}</span>
          </div>

          <div className={styles.matrixFullList}>
            {effectiveReport.spof_ranking.map(cand => {
              const isSelectedDown = downDeviceIds.has(cand.device_id)
              const candDev = devices.find(d => d.id === cand.device_id)
              const isAlreadyOffline = candDev?.status === 'offline'
              return (
                <div key={cand.device_id} className={`${styles.matrixRow} ${styles.matrixRowCompact}`}>
                  <span className={styles.outageIcon}>{DEVICE_ICON[cand.dtype]}</span>
                  <div
                    className={styles.outageInfo}
                    style={{ cursor: 'pointer' }}
                    onClick={() => candDev && (onOpenFullDetail ? onOpenFullDetail(candDev) : onDeviceInfo(candDev))}
                  >
                    <div className={styles.outageName}>
                      <span>{cand.name}</span>
                      <span className={styles.floorBadge}>{`F${cand.floor}`}</span>
                      <span className={styles.matrixCountBadge}>
                        {t('sim.spofMeta', {
                          unreachable: cand.unreachable_count,
                          degraded: cand.degraded_count,
                        })}
                      </span>
                    </div>
                    <div className={styles.outageChain}>
                      {cand.affected_device_names.length > 0
                        ? `${t('reports.affectsLabel')}: ${cand.affected_device_names.join(', ')}`
                        : t('sim.noDownstreamImpact')}
                    </div>
                  </div>
                  {isAlreadyOffline ? (
                    <span className={`${styles.sev} ${styles.crit}`}>{t('status.offline')}</span>
                  ) : (
                    <button
                      type="button"
                      className={`${styles.simTriggerBtn} ${isSelectedDown ? styles.simTriggerActive : ''}`}
                      onClick={() => {
                        if (isSelectedDown) toggleDeviceDown(cand.device_id)
                        else simulateSingleDeviceDown(cand.device_id)
                      }}
                    >
                      <FlaskConical size={12} />
                      <span>{isSelectedDown ? t('sim.restoreDevice') : t('sim.failDevice')}</span>
                    </button>
                  )}
                </div>
              )
            })}
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
              <div
                key={`${device.id}-${alert.id}`}
                role="button"
                tabIndex={0}
                className={styles.alertItem}
                onClick={() => onDeviceInfo(device)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onDeviceInfo(device)
                  }
                }}
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
                {alert.id && (
                  <button
                    type="button"
                    className={styles.ackBtn}
                    onClick={e => handleAcknowledge(e, alert.id)}
                    title={t('alerts.ackTitle')}
                  >
                    <Check size={12} />
                    <span>{t('alerts.ackButton')}</span>
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
