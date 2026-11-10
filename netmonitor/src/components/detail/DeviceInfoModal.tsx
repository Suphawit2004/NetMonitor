import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device, TimeRange } from '../../types'
import { useSimulation } from '../../context/simulationContext'
import { useDeviceDetail } from '../../hooks/useDeviceDetail'
import { useToast } from '../ui/toast-context'
import { TIME_RANGES } from '../../services/traffic'
import Modal from '../ui/Modal'
import MetricCard from './MetricCard'
import TrafficChart from './TrafficChart'
import AlertList from './AlertList'
import { levelColor } from './metricColors'
import { DEVICE_ICON } from '../../constants/deviceMeta'
import {
  Info,
  Zap,
  XCircle,
  Copy,
  Check,
  AlertCircle,
  AlertTriangle,
  Building2,
  ArrowRight,
  Radio,
} from 'lucide-react'
import styles from './DeviceInfoModal.module.css'

const STATUS_META = {
  online:  { labelKey: 'status.online', pill: 'pillOnline',  icon: 'iconOnline'  },
  warning: { labelKey: 'status.warningFull', pill: 'pillWarning', icon: 'iconWarning' },
  offline: { labelKey: 'status.offline', pill: 'pillOffline', icon: 'iconOffline' },
} as const

interface Props {
  device: Device
  onClose: () => void
  onOpenFullDetail: (device: Device) => void
  onNavigateFloor?: (floor: 1 | 2) => void
}

export default function DeviceInfoModal({ device, onClose, onOpenFullDetail, onNavigateFloor }: Props) {
  const { t } = useTranslation()
  const { live } = useSimulation()
  const { showToast } = useToast()
  const [timeRange, setTimeRange] = useState<TimeRange>('15m')
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const cleanName = device.name.replace(/^["']+|["']+$/g, '').trim()

  const {
    detail,
    series,
    interfaces,
    selectedInterface,
    setSelectedInterface,
    isPolling,
  } = useDeviceDetail(device, timeRange)
  const status = STATUS_META[device.status]

  function copyText(text: string, fieldName: string) {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldName)
    showToast(t('detail.copied'), 'success')
    setTimeout(() => setCopiedField(null), 2000)
  }

  if (!detail || !series) return null

  const pingColors = device.status === 'offline'
    ? { text: 'var(--status-critical)', fill: 'red' as const }
    : levelColor(detail.ping.value, 40, 80)
  const cpuColors  = levelColor(detail.cpu.value, 60, 85)
  const memColors  = levelColor(detail.memory.value, 70, 90)
  const tempColors = levelColor(detail.temperature.value, 48, 55)
  const lossColors = levelColor(detail.packetLoss.value, 0.5, 1)

  const locationText = t('detail.location', {
    floor: detail.location.floor,
    room: detail.location.room ?? t('detail.buildingA'),
  })

  const facts: Array<{ key: string; value: React.ReactNode; tooltip?: string }> = [
    {
      key: 'IP Address',
      value: (
        <div className={styles.factCopyWrap}>
          <span>{device.ip ?? '—'}</span>
          {device.ip && (
            <button
              type="button"
              className={`${styles.copyBtn} ${copiedField === 'ip' ? styles.copySuccess : ''}`}
              onClick={() => copyText(device.ip!, 'ip')}
              title={t('detail.copyIp')}
            >
              {copiedField === 'ip' ? <Check size={12} /> : <Copy size={12} />}
            </button>
          )}
        </div>
      ),
      tooltip: device.ip,
    },
    {
      key: 'MAC',
      value: (
        <div className={styles.factCopyWrap}>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{detail.mac}</span>
          {detail.mac && (
            <button
              type="button"
              className={`${styles.copyBtn} ${copiedField === 'mac' ? styles.copySuccess : ''}`}
              onClick={() => copyText(detail.mac, 'mac')}
              title={t('detail.copyMac')}
            >
              {copiedField === 'mac' ? <Check size={12} /> : <Copy size={12} />}
            </button>
          )}
        </div>
      ),
      tooltip: detail.mac,
    },
    { key: 'Uptime', value: detail.uptime, tooltip: detail.uptime },
    {
      key: 'Ping (RTT)',
      value: device.status === 'offline' ? (
        <span style={{ color: 'var(--status-critical)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <XCircle size={13} /> Timeout (100% loss)
        </span>
      ) : (
        <span style={{ color: 'var(--status-online)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Zap size={13} /> {detail.ping.value} ms
        </span>
      ),
      tooltip: device.status === 'offline' ? 'Device not responding to ICMP ping' : `Ping response time: ${detail.ping.value} ms`,
    },
    {
      key: 'Location',
      value: onNavigateFloor ? (
        <button
          onClick={() => onNavigateFloor(device.floor)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--accent-primary)',
            cursor: 'pointer',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            textAlign: 'right',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
          title={`ไปยัง ${t('floor.tab', { floor: device.floor })}`}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Building2 size={13} />
            <span>{locationText}</span>
          </span>
          <ArrowRight size={12} />
        </button>
      ) : (
        locationText
      ),
      tooltip: locationText,
    },
    { key: t('detail.portsUsed'), value: `${detail.portsUsed} / ${detail.portsTotal}` },
    { key: t('detail.vlan'),      value: String(detail.vlanCount) },
  ]

  const identity = (
    <div className={styles.identity}>
      <div className={`${styles.iconWrap} ${styles[status.icon]}`}>
        {DEVICE_ICON[device.dtype]}
      </div>
      <div className={styles.idText}>
        <div className={styles.name}>{cleanName}</div>
        <div className={styles.model}>{device.model ?? t(`deviceType.${device.dtype}`)}</div>
      </div>
      {live && (
        <span className={styles.liveMini} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Radio size={11} /> LIVE
        </span>
      )}
      <span className={`${styles.pill} ${styles[status.pill]}`}>{t(status.labelKey)}</span>
    </div>
  )

  return (
    <>
      <Modal
        open
        title={t('detail.infoTitle', { name: cleanName })}
        header={identity}
        onClose={onClose}
        width={680}
        footer={
          <>
            <div className={styles.spacer} />
            <button
              className={styles.footerPrimary}
              onClick={() => onOpenFullDetail(device)}
            >
              {t('detail.openFull')}
            </button>
          </>
        }
      >
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

        {/* Quick facts */}
        <div className={styles.section}>
          <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Info size={14} />
            <span>{t('detail.infoSection')}</span>
          </div>
          <div className={styles.facts}>
            {facts.map(f => (
              <div key={f.key} className={styles.fact}>
                <div className={styles.factKey}>{f.key}</div>
                <div className={styles.factVal} title={f.tooltip || (typeof f.value === 'string' ? f.value : undefined)}>{f.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Metrics */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('detail.currentValues')}</div>
          <div className={styles.metricRow}>
            <MetricCard
              label="Ping (RTT)"
              value={device.status === 'offline' ? 'Timeout' : detail.ping.value}
              unit={device.status === 'offline' ? '' : 'ms'}
              change={device.status === 'offline' ? 'No response' : detail.ping.change}
              tone={device.status === 'offline' ? 'bad' : detail.ping.tone}
              fillColor={pingColors.fill}
              fillPercent={device.status === 'offline' ? 100 : Math.min(Math.round(detail.ping.value * 1.5), 100)}
              valueColor={pingColors.text}
            />
            <MetricCard
              label="CPU"
              value={detail.cpu.value}
              unit="%"
              change={detail.cpu.change}
              tone={detail.cpu.tone}
              fillColor={cpuColors.fill}
              fillPercent={detail.cpu.value}
              valueColor={cpuColors.text}
            />
            <MetricCard
              label="Memory"
              value={detail.memory.value}
              unit="%"
              change={detail.memory.change}
              tone={detail.memory.tone}
              fillColor={memColors.fill}
              fillPercent={detail.memory.value}
              valueColor={memColors.text}
            />
            <MetricCard
              label="Temperature"
              value={detail.temperature.value}
              unit="°C"
              change={detail.temperature.change}
              tone={detail.temperature.tone}
              fillColor={tempColors.fill}
              fillPercent={detail.temperature.value}
              valueColor={tempColors.text}
            />
            <MetricCard
              label="Packet Loss"
              value={detail.packetLoss.value}
              unit="%"
              change={detail.packetLoss.change}
              tone={detail.packetLoss.tone}
              fillColor={lossColors.fill}
              fillPercent={detail.packetLoss.value * 10}
              valueColor={lossColors.text}
            />
          </div>
        </div>

        {/* Bandwidth chart */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{t('detail.trafficTitle')}</div>
          <div className={styles.rangeRow}>
            {TIME_RANGES.map(r => (
              <button
                key={r}
                className={`${styles.chip} ${timeRange === r ? styles.chipActive : ''}`}
                onClick={() => setTimeRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <TrafficChart
            series={series}
            timeRange={timeRange}
            interfaces={interfaces}
            selectedInterface={selectedInterface}
            onSelectInterface={setSelectedInterface}
            isPolling={isPolling}
          />
        </div>

        {/* Alerts */}
        <div className={styles.section}>
          <AlertList alerts={detail.alerts} />
        </div>
      </Modal>
    </>
  )
}
