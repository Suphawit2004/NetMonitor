import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BlastRadiusReport, Device, Port, TimeRange } from '../types'
import { useNetwork } from '../context/networkContext'
import { useSimulation } from '../context/simulationContext'
import { useFaultSimOptional } from '../context/faultSimContext'
import { useToast } from '../components/ui/toast-context'
import { useDeviceDetail } from '../hooks/useDeviceDetail'
import { VLAN_NAMES } from '../services/detailFactory'
import * as api from '../services/api'
import { TIME_RANGES } from '../services/traffic'
import { portName } from '../i18n/format'
import { levelColor } from '../components/detail/metricColors'
import MetricCard from '../components/detail/MetricCard'
import TrafficChart from '../components/detail/TrafficChart'
import AlertList from '../components/detail/AlertList'
import ServiceTagsEditor from '../components/detail/ServiceTagsEditor'
import { acknowledgeAlert } from '../services/api'
import { DEVICE_ICON } from '../constants/deviceMeta'
import { Activity, Zap, Loader2, Copy, Check, AlertCircle, AlertTriangle, ArrowRight, FlaskConical } from 'lucide-react'
import styles from './DeviceDetailPage.module.css'

const STATUS_META = {
  online:  { labelKey: 'status.online',      pill: 'pillOnline',  dot: 'dotOnline',  icon: 'iconOnline'  },
  warning: { labelKey: 'status.warningFull', pill: 'pillWarning', dot: 'dotWarning', icon: 'iconWarning' },
  offline: { labelKey: 'status.offline',      pill: 'pillOffline', dot: 'dotOffline', icon: 'iconOffline' },
} as const

type Tab = 'ports' | 'vlan' | 'neighbors'

interface Props {
  device: Device | null
  onBack: () => void
  onNavigateDevice: (device: Device) => void
  onNavigateFloor?: (floor: 1 | 2) => void
  onViewAllAlerts: () => void
}

export default function DeviceDetailPage({
  device,
  onBack,
  onNavigateDevice,
  onNavigateFloor,
  onViewAllAlerts,
}: Props) {
  const { t } = useTranslation()
  const { devices, connectDevice, retryDevices, updateDevice } = useNetwork()
  const { live, intervalSec } = useSimulation()
  const faultSim = useFaultSimOptional()
  const { showToast } = useToast()
  const [tab, setTab] = useState<Tab>('ports')
  const [timeRange, setTimeRange] = useState<TimeRange>('15m')
  const [connecting, setConnecting] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  function copyText(text: string, fieldName: string) {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    showToast(t('detail.copied'), 'success')
    setTimeout(() => setCopiedField(null), 2000)
  }

  const {
    detail,
    series,
    interfaces,
    selectedInterface,
    setSelectedInterface,
    isPolling,
  } = useDeviceDetail(device, timeRange)

  // ── Ports tab: top 5 by utilization ──────────────────────
  const topPorts = useMemo(() => {
    if (!detail) return []
    return detail.ports
      .filter(p => p.status === 'up' && (p.utilization ?? 0) > 0)
      .sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))
      .slice(0, 5)
  }, [detail])

  // ── VLAN tab ─────────────────────────────────────────────
  const vlanGroups = useMemo(() => {
    if (!detail) return []
    const map = new Map<string, Port[]>()
    for (const p of detail.ports) {
      if (!p.vlan) continue
      const list = map.get(p.vlan) ?? []
      list.push(p)
      map.set(p.vlan, list)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([vlan, ports]) => ({
        vlan,
        name: VLAN_NAMES[vlan] ?? '—',
        ports,
        up: ports.filter(p => p.status === 'up').length,
      }))
  }, [detail])

  // ── Neighbors tab ────────────────────────────────────────
  const neighbors = useMemo(() => {
    if (!detail) return []
    return detail.ports
      .filter(p => p.peerId)
      .map(p => ({ port: p, peer: devices.find(d => d.id === p.peerId) }))
      .filter((x): x is { port: Port; peer: Device } => !!x.peer)
  }, [detail, devices])

  const [blastPreviewState, setBlastPreviewState] = useState<{
    deviceId: string
    report: BlastRadiusReport
  } | null>(null)
  const deviceId = device?.id
  const linksCount = faultSim?.links.length ?? 0
  const linksList = faultSim?.links ?? []

  useEffect(() => {
    if (!deviceId || !faultSim) return
    let cancelled = false
    api.simulateImpact([deviceId], [], false, devices, linksList)
      .then(report => {
        if (!cancelled) setBlastPreviewState({ deviceId, report })
      })
      .catch(err => console.warn('Failed to fetch device blast preview', err))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, devices.length, linksCount])

  const blastPreview = deviceId && blastPreviewState?.deviceId === deviceId
    ? blastPreviewState.report
    : null

  const downstreamImpacted = useMemo(() => {
    if (!blastPreview) return []
    return blastPreview.device_impacts.filter(
      x => x.impact_state === 'unreachable' || x.impact_state === 'degraded',
    )
  }, [blastPreview])

  if (!device || !detail || !series) {
    return (
      <div className={styles.page}>
        <div className={styles.breadcrumb}>
          <button className={styles.crumbLink} onClick={onBack}>{t('detail.crumbFloorPlan')}</button>
        </div>
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>{t('detail.noSelectionTitle')}</div>
          <div className={styles.emptySub}>{t('detail.noSelectionSub')}</div>
          <button className={styles.emptyBack} onClick={onBack}>{t('detail.backToFloorPlan')}</button>
        </div>
      </div>
    )
  }

  const effectiveStatus = faultSim ? faultSim.getEffectiveStatus(device) : device.status
  const status = STATUS_META[effectiveStatus]
  const uptimeText = effectiveStatus === 'offline' ? t('detail.notResponding') : `Uptime ${detail.uptime}`

  // capture ค่าที่ผ่าน null-check แล้ว — closure ไม่รับการ narrow ของ parameter
  const dev = device

  async function handleConnectDevice() {
    if (!dev || connecting) return
    setConnecting(true)
    showToast(t('detail.connectingDevice', { name: dev.name }), 'info')
    try {
      const res = await connectDevice(dev.id)
      if (res.success) {
        showToast(t('detail.connectSuccess', { name: dev.name }), 'success')
      } else {
        showToast(t('detail.connectFailed', { message: res.message }), 'error')
      }
    } catch {
      showToast(t('common.error'), 'error')
    } finally {
      setConnecting(false)
    }
  }

  async function handleAcknowledgeAlert(alertId: string | number) {
    const ok = await acknowledgeAlert(alertId)
    if (ok) {
      showToast(t('alerts.ackSuccess'), 'success')
      retryDevices()
    }
  }

  const cleanDeviceName = device.name.replace(/^["']+|["']+$/g, '').trim()

  const locationText = t('detail.location', {
    floor: detail.location.floor,
    room: detail.location.room ?? t('detail.buildingA'),
  })

  const infoFields: {
    label: string
    value: React.ReactNode
    mono?: boolean
    copyValue?: string
    fieldKey?: string
  }[] = [
    {
      label: 'IP Address',
      value: device.ip ?? '—',
      copyValue: device.ip,
      fieldKey: 'ip',
    },
    {
      label: 'MAC Address',
      value: detail.mac,
      mono: true,
      copyValue: detail.mac,
      fieldKey: 'mac',
    },
    { label: 'OS / Firmware', value: detail.iosVersion, mono: true },
    {
      label: 'Ping (RTT)',
      value: effectiveStatus === 'offline' ? 'Request Timeout (100% loss)' : typeof detail.ping.value === 'number' ? `${detail.ping.value} ms (Online)` : detail.ping.value,
    },
  ]

  const pingColors   = effectiveStatus === 'offline'
    ? { text: '#ef4444', fill: 'red' as const }
    : levelColor(detail.ping.value, 40, 80)
  const cpuColors    = levelColor(detail.cpu.value, 60, 85)
  const memColors    = levelColor(detail.memory.value, 70, 90)
  const tempColors   = levelColor(detail.temperature.value, 48, 55)
  const lossColors   = levelColor(detail.packetLoss.value, 0.5, 1)

  return (
    <div className={styles.page}>
      {/* Breadcrumb row */}
      <div className={styles.breadcrumb}>
        <button className={styles.crumbLink} onClick={onBack}>{t('detail.crumbFloorPlan')}</button>
        <span className={styles.sep}>›</span>
        <button
          className={styles.crumbLink}
          onClick={() => (onNavigateFloor ? onNavigateFloor(device.floor) : onBack())}
          title={`ไปยัง ${t('floor.tab', { floor: device.floor })}`}
        >
          {t('search.floor', { floor: device.floor })}
        </button>
        <span className={styles.sep}>›</span>
        <span className={styles.current}>{cleanDeviceName}</span>
      </div>

      <div className={styles.body}>
        {/* ── Left panel ── */}
        <div className={styles.leftPanel}>
          {/* Hero */}
          <div className={styles.hero}>
            <div className={`${styles.iconWrap} ${styles[status.icon]}`}>
              {DEVICE_ICON[device.dtype]}
            </div>
            <div className={styles.deviceName}>{cleanDeviceName}</div>
            <div className={styles.deviceModel}>{device.model ?? t(`deviceType.${device.dtype}`)}</div>
            <div className={`${styles.statusPill} ${styles[status.pill]}`}>
              <span className={`${styles.pulseDot} ${styles[status.dot]}`} />
              {t(status.labelKey)} · {device.status === 'offline' ? 'Ping: Timeout' : `Ping: ${typeof detail.ping.value === 'number' ? `${detail.ping.value}ms` : detail.ping.value}`} · {uptimeText}
            </div>
          </div>

          {/* Diagnostic Suggestion Banner for Offline/Warning Devices */}
          {device.status === 'offline' && (
            <div className={`${styles.diagBanner} ${styles.diagOffline}`} role="alert">
              <AlertCircle size={16} className={styles.diagIcon} />
              <div>
                <strong>{t('detail.offlineDevice')}: </strong>
                {t('detail.offlineTip')}
              </div>
            </div>
          )}
          {device.status === 'warning' && (
            <div className={`${styles.diagBanner} ${styles.diagWarning}`} role="alert">
              <AlertTriangle size={16} className={styles.diagIcon} />
              <div>
                <strong>{t('status.warningFull')}: </strong>
                {t('detail.warningTip')}
              </div>
            </div>
          )}

          {/* Info grid */}
          <div className={styles.infoGrid}>
            <div
              className={`${styles.infoCard} ${onNavigateFloor ? styles.infoCardInteractive : ''}`}
              onClick={() => onNavigateFloor?.(device.floor)}
              role={onNavigateFloor ? 'button' : undefined}
              tabIndex={onNavigateFloor ? 0 : undefined}
              title={onNavigateFloor ? `คลิกเพื่อไปยัง ${t('floor.tab', { floor: device.floor })}` : undefined}
              style={{ cursor: onNavigateFloor ? 'pointer' : 'default' }}
            >
              <div className={styles.infoLabel} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <span>Location</span>
                {onNavigateFloor && (
                  <span style={{ fontSize: 12, color: 'var(--accent-primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {t('floor.tab', { floor: device.floor })} <ArrowRight size={12} />
                  </span>
                )}
              </div>
              <div className={styles.infoValue} style={{ color: onNavigateFloor ? 'var(--accent-primary)' : undefined }}>
                {locationText}
              </div>
            </div>

            {infoFields.map(({ label, value, mono, copyValue, fieldKey }) => (
              <div key={label} className={styles.infoCard}>
                <div className={styles.infoLabel} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{label}</span>
                  {copyValue && fieldKey && (
                    <button
                      type="button"
                      className={`${styles.copyBtn} ${copiedField === fieldKey ? styles.copySuccess : ''}`}
                      onClick={() => copyText(copyValue, fieldKey)}
                      title={`Copy ${label}`}
                    >
                      {copiedField === fieldKey ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  )}
                </div>
                <div className={`${styles.infoValue} ${mono ? styles.infoMono : ''}`}>{value}</div>
              </div>
            ))}
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>{t('detail.portsUsed')}</div>
              <div className={styles.infoValue} style={{ color: 'var(--status-online)' }}>
                {detail.portsUsed} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/ {detail.portsTotal}</span>
              </div>
            </div>
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>VLAN</div>
              <div className={styles.infoValue}>{detail.vlanCount} VLANs</div>
            </div>
          </div>

          <ServiceTagsEditor
            device={device}
            editable
            onSave={services => updateDevice(device.id, { services })}
          />

          {/* Tabs */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === 'ports' ? styles.tabActive : ''}`}
              onClick={() => setTab('ports')}
            >
              {t('detail.tabPorts')} ({detail.ports.length})
            </button>
            <button
              className={`${styles.tab} ${tab === 'vlan' ? styles.tabActive : ''}`}
              onClick={() => setTab('vlan')}
            >
              {t('detail.tabVlan')} ({vlanGroups.length})
            </button>
            <button
              className={`${styles.tab} ${tab === 'neighbors' ? styles.tabActive : ''}`}
              onClick={() => setTab('neighbors')}
            >
              {t('detail.tabNeighbors')} ({neighbors.length})
            </button>
          </div>

          <div className={styles.portWrap}>
            {tab === 'ports' && (
              <>
                <div className={styles.sectionTitle}>
                  {t('detail.interfacesUp', { used: detail.portsUsed, total: detail.portsTotal })}
                </div>
                {detail.ports.map((port, idx) => (
                  <div key={`${port.num}-${idx}`} className={styles.portItem}>
                    <span className={styles.portNum}>{port.num}</span>
                    <span className={`${styles.portBadge} ${styles[port.status]}`}>
                      {port.status.toUpperCase()}
                    </span>
                    <span className={styles.portName}>{portName(port, t)}</span>
                    {port.vlan && <span className={styles.portVlan}>{port.vlan}</span>}
                    <span className={styles.portSpeed}>{port.speed}</span>
                  </div>
                ))}
              </>
            )}

            {tab === 'vlan' && (
              <>
                <div className={styles.sectionTitle}>{t('detail.vlanTitle', { count: vlanGroups.length })}</div>
                {vlanGroups.length === 0 && (
                  <div className={styles.noneText}>{t('detail.noVlan')}</div>
                )}
                {vlanGroups.map(g => (
                  <div key={g.vlan} className={styles.vlanItem}>
                    <span className={styles.portVlan}>{g.vlan}</span>
                    <div className={styles.vlanBody}>
                      <div className={styles.vlanName}>{g.name}</div>
                      <div className={styles.vlanMeta}>{t('detail.vlanMeta', { ports: g.ports.length, up: g.up })}</div>
                    </div>
                    <div className={styles.vlanPorts} title={g.ports.map(p => p.num).join(', ')}>
                      {g.ports.slice(0, 6).map(p => p.num).join(', ')}
                      {g.ports.length > 6 ? ` +${g.ports.length - 6}` : ''}
                    </div>
                  </div>
                ))}
              </>
            )}

            {tab === 'neighbors' && (
              <>
                <div className={styles.sectionTitle}>{t('detail.neighborsTitle', { count: neighbors.length })}</div>
                {neighbors.length === 0 && (
                  <div className={styles.noneText}>{t('detail.noNeighbors')}</div>
                )}
                {neighbors.map(({ port, peer }, idx) => (
                  <button
                    key={`${port.num}-${peer.id}-${idx}`}
                    className={styles.neighborItem}
                    onClick={() => onNavigateDevice(peer)}
                    title={t('detail.viewPeer', { name: peer.name })}
                  >
                    <span className={`${styles.neighborIcon} ${styles[`n_${peer.status}`]}`}>
                      {DEVICE_ICON[peer.dtype]}
                    </span>
                    <div className={styles.neighborBody}>
                      <div className={styles.neighborName}>{peer.name}</div>
                      <div className={styles.neighborMeta}>
                        {t(`deviceType.${peer.dtype}`)} · {port.num}
                        {port.vlan ? ` · ${port.vlan}` : ''}
                        {port.speed ? ` · ${port.speed}` : ''}
                      </div>
                    </div>
                    <span className={`${styles.neighborStatus} ${styles[`ns_${peer.status}`]}`}>
                      {t(`status.${peer.status}`)}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className={styles.rightPanel}>
          {/* Action bar / Toolbar */}
          <div className={styles.actionBar}>
            {/* Live Ping Status Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '5px 12px',
                borderRadius: '6px',
                background: device.status === 'offline' ? 'var(--status-critical-bg)' : 'var(--status-online-bg)',
                border: `1px solid ${device.status === 'offline' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`,
                fontSize: 12,
                fontWeight: 600,
                color: device.status === 'offline' ? 'var(--status-critical)' : 'var(--status-online)',
              }}
            >
              <Activity size={14} style={{ color: device.status === 'offline' ? 'var(--status-critical)' : 'var(--status-online)' }} />
              <span>
                Ping: {device.status === 'offline' ? 'Request Timeout (100% loss)' : typeof detail.ping.value === 'number' ? `${detail.ping.value} ms` : detail.ping.value}
              </span>
              {device.status !== 'offline' && (
                <span style={{ fontSize: 12, opacity: 0.85, color: detail.ping.tone === 'good' ? 'var(--status-online)' : 'var(--status-warning)' }}>
                  ({detail.ping.change})
                </span>
              )}
            </div>

            {device.status === 'offline' && (
              <button
                className={styles.actionBtn}
                onClick={handleConnectDevice}
                disabled={connecting}
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  border: 'none',
                  boxShadow: '0 0 10px rgba(16, 185, 129, 0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {connecting ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>กำลังเชื่อมต่อ...</span>
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    <span>{t('detail.connectBtn')}</span>
                  </>
                )}
              </button>
            )}

            <div className={styles.timeRange}>
              {live && (
                <span className={styles.liveBadge} title={t('detail.liveTitle')}>
                  <span className={styles.liveDot} />
                  LIVE {intervalSec}s
                </span>
              )}
              {TIME_RANGES.map(r => (
                <button
                  key={r}
                  className={`${styles.trBtn} ${timeRange === r ? styles.trActive : ''}`}
                  onClick={() => setTimeRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Charts area */}
          <div className={styles.chartsArea}>
            {/* Metrics row */}
            <div className={styles.metricRow}>
              <MetricCard
                label="Ping (RTT)"
                value={device.status === 'offline' ? 'Timeout' : detail.ping.value}
                unit={device.status === 'offline' || typeof detail.ping.value !== 'number' ? '' : 'ms'}
                change={device.status === 'offline' ? 'No response' : detail.ping.change}
                tone={device.status === 'offline' ? 'bad' : detail.ping.tone}
                fillColor={pingColors.fill}
                fillPercent={device.status === 'offline' ? 100 : typeof detail.ping.value === 'number' ? Math.min(Math.round(detail.ping.value * 1.5), 100) : 0}
                valueColor={pingColors.text}
              />
              <MetricCard
                label="CPU Usage"
                value={detail.cpu.value}
                unit={typeof detail.cpu.value === 'number' ? '%' : ''}
                change={detail.cpu.change}
                tone={detail.cpu.tone}
                fillColor={cpuColors.fill}
                fillPercent={typeof detail.cpu.value === 'number' ? detail.cpu.value : 0}
                valueColor={cpuColors.text}
              />
              <MetricCard
                label="Memory"
                value={detail.memory.value}
                unit={typeof detail.memory.value === 'number' ? '%' : ''}
                change={detail.memory.change}
                tone={detail.memory.tone}
                fillColor={memColors.fill}
                fillPercent={typeof detail.memory.value === 'number' ? detail.memory.value : 0}
                valueColor={memColors.text}
              />
              <MetricCard
                label="Temperature"
                value={detail.temperature.value}
                unit={typeof detail.temperature.value === 'number' ? '°C' : ''}
                change={detail.temperature.change}
                tone={detail.temperature.tone}
                fillColor={tempColors.fill}
                fillPercent={typeof detail.temperature.value === 'number' ? detail.temperature.value : 0}
                valueColor={tempColors.text}
              />
              <MetricCard
                label="Packet Loss"
                value={detail.packetLoss.value}
                unit={typeof detail.packetLoss.value === 'number' ? '%' : ''}
                change={detail.packetLoss.change}
                tone={detail.packetLoss.tone}
                fillColor={lossColors.fill}
                fillPercent={typeof detail.packetLoss.value === 'number' ? detail.packetLoss.value * 10 : 0}
                valueColor={lossColors.text}
              />
            </div>

            <TrafficChart
              series={series}
              interfaces={interfaces}
              selectedInterface={selectedInterface}
              onSelectInterface={setSelectedInterface}
              isPolling={isPolling}
              timeRange={timeRange}
            />

            {/* Port util + Alerts */}
            <div className={styles.bottomRow}>
              {/* Port utilization bar chart */}
              <div className={styles.portChart}>
                <div className={styles.chartTitle}>Port Utilization</div>
                <div className={styles.chartSub}>Top 5 ports by traffic</div>
                {topPorts.length === 0 ? (
                  <div className={styles.noneText}>{t('detail.noUtilData')}</div>
                ) : (
                  <svg viewBox="0 0 280 120" width="100%" height="120" aria-label="Port utilization chart">
                    {topPorts.map((p, i) => {
                      const pct = Math.min(p.utilization ?? 0, 100)
                      const width = (pct / 100) * 200
                      const color = pct >= 80 ? 'var(--status-warning)' : pct >= 50 ? 'var(--accent-primary)' : 'var(--status-online)'
                      const y = 12 + i * 20
                      return (
                        <g key={`${p.num}-${i}`}>
                          <text x="8" y={y + 10} fontSize="12" fill="var(--text-muted)">{p.num}</text>
                          <rect x="34" y={y} width="200" height="12" rx="3" fill="var(--bg-elevated)" />
                          <rect x="34" y={y} width={width} height="12" rx="3" fill={color} />
                          <text x={width + 38} y={y + 10} fontSize="12" fill={color}>{pct}%</text>
                        </g>
                      )
                    })}
                  </svg>
                )}
              </div>

              <AlertList alerts={detail.alerts} onViewAll={onViewAllAlerts} onAcknowledge={handleAcknowledgeAlert} />
            </div>

            {blastPreview && faultSim && (
              <div className={styles.blastCard} data-testid="device-blast-card">
                <div className={styles.blastHeader}>
                  <div>
                    <div className={styles.chartTitle}>{t('sim.deviceBlastTitle')}</div>
                    <div className={styles.chartSub}>{t('sim.deviceBlastSub')}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.blastSimBtn}
                    onClick={() => {
                      faultSim.simulateSingleDeviceDown(dev.id)
                      if (onNavigateFloor) onNavigateFloor(dev.floor)
                      else onBack()
                    }}
                  >
                    <FlaskConical size={13} />
                    <span>{t('sim.simulateOnMap')}</span>
                  </button>
                </div>
                <div className={styles.blastMetrics}>
                  <div className={styles.blastStat}>
                    <span className={styles.blastVal}>{blastPreview.summary.unreachable_count}</span>
                    <span className={styles.blastLbl}>{t('sim.kpiUnreachable')}</span>
                  </div>
                  <div className={styles.blastStat}>
                    <span className={styles.blastVal}>{blastPreview.summary.degraded_count}</span>
                    <span className={styles.blastLbl}>{t('sim.kpiDegraded')}</span>
                  </div>
                </div>
                <div className={styles.blastPeersWrap}>
                  <div className={styles.blastPeersLabel}>{t('sim.affectedDevicesList')}</div>
                  {downstreamImpacted.length === 0 ? (
                    <div className={styles.noneText}>{t('sim.noDownstreamImpact')}</div>
                  ) : (
                    <div className={styles.blastPeerList}>
                      {downstreamImpacted.map(item => {
                        const targetDev = devices.find(d => d.id === item.device_id)
                        const chain = item.dependency_path.join(' ➔ ')
                        return (
                          <button
                            key={item.device_id}
                            type="button"
                            className={`${styles.blastPeerChip} ${
                              item.impact_state === 'unreachable' || item.impact_state === 'degraded'
                                ? styles.blastPeerWarn
                                : styles.blastPeerCrit
                            }`}
                            onClick={() => targetDev && onNavigateDevice(targetDev)}
                            title={chain}
                          >
                            <span>{DEVICE_ICON[item.dtype]}</span>
                            <span>{item.name}</span>
                            <span className={styles.blastPeerState}>
                              ({t(`sim.state_${item.impact_state}`)})
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
