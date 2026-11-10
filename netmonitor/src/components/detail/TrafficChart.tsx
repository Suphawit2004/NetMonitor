import { memo, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Radio, Info } from 'lucide-react'
import type { InterfaceTrafficItem, TrafficSeries, TimeRange } from '../../types'
import styles from './TrafficChart.module.css'

interface Props {
  series: TrafficSeries
  interfaces?: InterfaceTrafficItem[]
  selectedInterface?: string
  onSelectInterface?: (id: string) => void
  isPolling?: boolean
  timeRange?: TimeRange
}

interface HoverState {
  index: number
  svgX: number
  inY: number
  outY: number
  inVal: number
  outVal: number
  totalVal: number
  timeLabel: string
  pixelX: number
  pixelY: number
  isFlippedLeft: boolean
}

const VIEW_W = 680
const VIEW_H = 140
const X0 = 30
const X1 = 650
const Y_TOP = 20
const Y_BOTTOM = 120

function getPointTimeLabel(
  index: number,
  total: number,
  timeRange: string | undefined,
  labels: string[],
  t: (key: string, opt?: Record<string, unknown>) => string
): string {
  if (total <= 1 || index === total - 1) return t('chart.now')
  const ratio = (total - 1 - index) / Math.max(total - 1, 1)
  const range = timeRange || (labels[0] ? labels[0].replace(/^-/, '') : '')

  if (range.includes('15m')) {
    const totalSecs = 15 * 60
    const secs = Math.round(ratio * totalSecs)
    if (secs < 60) return t('chart.secondsAgo', { count: secs })
    return t('chart.minutesAgo', { count: Math.floor(secs / 60) })
  }

  if (range.includes('1h') || range.includes('60m')) {
    const mins = Math.max(1, Math.round(ratio * 60))
    return t('chart.minutesAgo', { count: mins })
  }

  if (range.includes('6h')) {
    const h = Math.round((ratio * 360) / 60)
    return t('chart.hoursAgo', { count: h })
  }

  if (range.includes('24h')) {
    const hours = Number((ratio * 24).toFixed(1))
    return t('chart.hoursAgo', { count: hours })
  }

  if (range.includes('7d')) {
    const days = Number((ratio * 7).toFixed(1))
    return t('chart.daysAgo', { count: days })
  }

  return t('chart.timeSlot', { current: index + 1, total })
}

function TrafficChart({
  series,
  interfaces = [],
  selectedInterface = 'all',
  onSelectInterface,
  isPolling = false,
  timeRange,
}: Props) {
  const { t } = useTranslation()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const gInId = `${uid}-gIn`
  const gOutId = `${uid}-gOut`

  const svgRef = useRef<SVGSVGElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const isInitialLoading = Boolean(series.isInitialLoading)

  const paths = useMemo(() => {
    const max = Math.max(series.peak, 1)
    const n = series.inbound.length
    const step = n > 1 ? (X1 - X0) / (n - 1) : 0
    const y = (v: number) => Y_BOTTOM - (v / max) * (Y_BOTTOM - Y_TOP)

    const toLine = (values: number[]) =>
      values
        .map((v, i) => `${i === 0 ? 'M' : 'L'}${(X0 + i * step).toFixed(1)},${y(v).toFixed(1)}`)
        .join(' ')

    const toArea = (values: number[]) =>
      values.length === 0 ? '' : `${toLine(values)} L${X1},${Y_BOTTOM} L${X0},${Y_BOTTOM} Z`

    return {
      max,
      midValue: Math.floor(max / 2),
      areaIn: toArea(series.inbound),
      lineIn: toLine(series.inbound),
      areaOut: toArea(series.outbound),
      lineOut: toLine(series.outbound),
      calcY: y,
    }
  }, [series])

  const midY = (Y_TOP + Y_BOTTOM) / 2

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || !wrapperRef.current) return
    const svgRect = svgRef.current.getBoundingClientRect()
    if (svgRect.width === 0) return

    const clientX = e.clientX
    const clientY = e.clientY

    // Convert mouse to SVG viewBox coordinate (0..VIEW_W)
    const svgX = ((clientX - svgRect.left) / svgRect.width) * VIEW_W

    // Ignore if completely outside graph horizontal boundaries
    if (svgX < X0 - 15 || svgX > X1 + 15) {
      setHover(null)
      return
    }

    const n = series.inbound.length
    if (n === 0) return

    const step = n > 1 ? (X1 - X0) / (n - 1) : 0
    const clampedX = Math.max(X0, Math.min(X1, svgX))
    const index = Math.round((clampedX - X0) / (step || 1))
    const snappedIndex = Math.max(0, Math.min(n - 1, index))

    const inVal = series.inbound[snappedIndex] ?? 0
    const outVal = series.outbound[snappedIndex] ?? 0
    const snappedSvgX = X0 + snappedIndex * step

    const inY = paths.calcY(inVal)
    const outY = paths.calcY(outVal)

    // Calculate position relative to chartWrapper
    const wrapperRect = wrapperRef.current.getBoundingClientRect()
    const pixelX = clientX - wrapperRect.left
    const pixelY = clientY - wrapperRect.top

    // Flip tooltip left if mouse is within 180px of wrapper right edge
    const isFlippedLeft = pixelX > wrapperRect.width - 180

    setHover({
      index: snappedIndex,
      svgX: snappedSvgX,
      inY,
      outY,
      inVal,
      outVal,
      totalVal: Math.round((inVal + outVal) * 100) / 100,
      timeLabel: getPointTimeLabel(snappedIndex, n, timeRange, series.labels, t),
      pixelX,
      pixelY,
      isFlippedLeft,
    })
  }

  const handlePointerLeave = () => {
    setHover(null)
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{t('detail.trafficTitle')}</span>
            {isInitialLoading ? (
              <span className={styles.badgePolling} title="Actively querying SNMP hardware">
                <span className={styles.spinnerIcon} />
                POLLING SNMP...
              </span>
            ) : series.hasSnmp === true ? (
              <span className={styles.badgeSnmp} title="Live SNMP Metrics from Hardware">
                <span className={styles.pulseDot} />
                LIVE (SNMP)
              </span>
            ) : isPolling ? (
              <span className={styles.badgePolling} title="Actively updating metrics">
                <span className={styles.spinnerIcon} />
                {t('detail.updatingTraffic')}
              </span>
            ) : series.hasSnmp === false ? (
              <span className={styles.badgeIcmp} title="Device responds to ICMP only (No SNMP MIB)" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Info size={11} /> No SNMP Data (ICMP Only)
              </span>
            ) : (
              <span
                className={styles.badgeSnmp}
                style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  borderColor: 'rgba(59, 130, 246, 0.4)',
                  color: '#60a5fa',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Radio size={11} /> LIVE
              </span>
            )}
          </div>
          <div className={styles.sub}>
            {isInitialLoading ? (
              t('detail.snmpQuerying')
            ) : (
              <>
                Peak: <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{series.peak}</span> Mbps · Avg: <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{series.avg}</span> Mbps
                {series.hasSnmp === false && ' · ICMP Node (No OIDs)'}
                {series.hasSnmp !== false && series.peak === 0 && ` · ${t('detail.offlineDevice')}`}
              </>
            )}
          </div>
        </div>

        <div className={styles.headerRight}>
          {interfaces.length > 0 && onSelectInterface && (
            <select
              className={styles.interfaceSelect}
              value={selectedInterface}
              onChange={e => onSelectInterface(e.target.value)}
              title="Select Interface / Port"
              disabled={isInitialLoading}
            >
              <option value="all">Total (All {interfaces.length} Ports)</option>
              {interfaces.map(iface => (
                <option key={iface.id} value={String(iface.id)}>
                  Port {iface.name} ({iface.oper_status})
                </option>
              ))}
            </select>
          )}

          <div className={styles.legend}>
            <span className={styles.legItem}>
              <span className={styles.legDot} style={{ background: 'var(--chart-inbound)' }} />{t('chart.inbound')}
            </span>
            <span className={styles.legItem}>
              <span className={styles.legDot} style={{ background: 'var(--chart-outbound)' }} />{t('chart.outbound')}
            </span>
          </div>
        </div>
      </div>

      <div ref={wrapperRef} className={styles.chartWrapper}>
        {isInitialLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.loadingSpinner} />
            <div className={styles.loadingText}>{t('detail.snmpConnectingOverlay')}</div>
          </div>
        )}
        <svg
          ref={svgRef}
          className={styles.chart}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          aria-label="Traffic chart"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            <linearGradient id={gInId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-inbound)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--chart-inbound)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={gOutId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-outbound)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--chart-outbound)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[Y_TOP, midY, Y_BOTTOM].map(gy => (
            <line key={gy} x1="0" y1={gy} x2={VIEW_W} y2={gy} stroke="var(--border-subtle)" strokeWidth="1" />
          ))}
          <text x="4" y={Y_BOTTOM + 4} fontSize="12" fill="var(--text-muted)">0</text>
          {series.peak > 0 && (
            <>
              <text x="4" y={Y_TOP + 4} fontSize="12" fill="var(--text-muted)">{paths.max}M</text>
              {paths.midValue > 0 && (
                <text x="4" y={midY + 4} fontSize="12" fill="var(--text-muted)">{paths.midValue}M</text>
              )}
            </>
          )}

          {/* Inbound Area & Line */}
          <path d={paths.areaIn} fill={`url(#${gInId})`} />
          <path d={paths.lineIn} fill="none" stroke="var(--chart-inbound)" strokeWidth="2" />

          {/* Outbound Area & Line */}
          <path d={paths.areaOut} fill={`url(#${gOutId})`} />
          <path d={paths.lineOut} fill="none" stroke="var(--chart-outbound)" strokeWidth="2" />

          {/* X-axis labels */}
          {series.labels.map((label, i) => (
            <text
              key={`${label}-${i}`}
              x={X0 + (i * (X1 - X0)) / Math.max(series.labels.length - 1, 1)}
              y={VIEW_H - 5}
              fontSize="12"
              fill="var(--text-muted)"
              textAnchor={i === 0 ? 'start' : i === series.labels.length - 1 ? 'end' : 'middle'}
            >
              {label}
            </text>
          ))}

          {/* Interactive Crosshair & Highlight Dots */}
          {hover && (
            <g className={styles.hoverGroup}>
              {/* Vertical Guide Line */}
              <line
                x1={hover.svgX}
                y1={Y_TOP}
                x2={hover.svgX}
                y2={Y_BOTTOM}
                stroke="#64748b"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity="0.8"
              />
              {/* Inbound Highlight Dot */}
              <circle
                cx={hover.svgX}
                cy={hover.inY}
                r="4.5"
                fill="var(--chart-inbound)"
                stroke="var(--bg-canvas)"
                strokeWidth="2"
              />
              {/* Outbound Highlight Dot */}
              <circle
                cx={hover.svgX}
                cy={hover.outY}
                r="4.5"
                fill="var(--chart-outbound)"
                stroke="var(--bg-canvas)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Floating Tooltip Card */}
        {hover && (
          <div
            className={styles.tooltipBox}
            style={{
              left: hover.isFlippedLeft ? hover.pixelX - 12 : hover.pixelX + 12,
              top: Math.max(8, hover.pixelY - 75),
              transform: hover.isFlippedLeft ? 'translateX(-100%)' : 'none',
            }}
          >
            <div className={styles.tooltipHeader} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock size={11} className={styles.tooltipClock} />
              <span>{hover.timeLabel}</span>
            </div>
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipDot} style={{ background: 'var(--chart-inbound)' }} />
              <span className={styles.tooltipLabel}>Inbound:</span>
              <span className={styles.tooltipVal}>{hover.inVal} Mbps</span>
            </div>
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipDot} style={{ background: 'var(--chart-outbound)' }} />
              <span className={styles.tooltipLabel}>Outbound:</span>
              <span className={styles.tooltipVal}>{hover.outVal} Mbps</span>
            </div>
            <div className={styles.tooltipDivider} />
            <div className={styles.tooltipTotal}>
              <span className={styles.tooltipTotalLabel}>Total Traffic:</span>
              <span className={styles.tooltipTotalVal}>{hover.totalVal} Mbps</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(TrafficChart)
