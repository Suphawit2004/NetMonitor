import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { BlastRadiusReport, Device, LinkImpactState, TopologyLink } from '../../types'
import { buildFailureDirectionResolver, computeBlastRadius } from '../../services/topologyEngine'
import styles from './TopologyLinksLayer.module.css'

interface Props {
  allDevices: Device[]
  currentFloor: 1 | 2
  planW: number
  planH: number
  links: TopologyLink[]
  linkStates: Record<string, LinkImpactState>
  impactReport?: BlastRadiusReport
  downLinkIds?: Set<string>
  isSimMode: boolean
  isLinkEditMode: boolean
  onToggleLinkDown: (linkId: string) => void
  onDeleteLink: (linkId: string) => void
  onFloorChange?: (floor: 1 | 2) => void
}

const BADGE_T_CANDIDATES = [0.5, 0.32, 0.68, 0.22, 0.78]
const CHEVRON_T_CANDIDATES = [0.5, 0.34, 0.66, 0.24, 0.76]
const PIN_CLEARANCE_PX = 26

function pickClearBadgePoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  floorPins: Device[],
  srcId: string,
  dstId: string,
): { mx: number; my: number } {
  let best = { mx: (x1 + x2) / 2, my: (y1 + y2) / 2 }
  let bestMinDist = -1

  for (const tFrac of BADGE_T_CANDIDATES) {
    const cx = x1 + (x2 - x1) * tFrac
    const cy = y1 + (y2 - y1) * tFrac
    let minDist = Infinity
    for (const pin of floorPins) {
      if (pin.id === srcId || pin.id === dstId) continue
      const d = Math.hypot(cx - pin.x, cy - pin.y)
      if (d < minDist) minDist = d
    }
    if (minDist >= PIN_CLEARANCE_PX) {
      return { mx: cx, my: cy }
    }
    if (minDist > bestMinDist) {
      bestMinDist = minDist
      best = { mx: cx, my: cy }
    }
  }
  return best
}

function pickClearChevronPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  floorPins: Device[],
  srcId: string,
  dstId: string,
  avoidBadge: { mx: number; my: number } | null,
): { x: number; y: number } {
  let best = { x: x1 + (x2 - x1) * 0.5, y: y1 + (y2 - y1) * 0.5 }
  let bestScore = -1

  for (const tFrac of CHEVRON_T_CANDIDATES) {
    const cx = x1 + (x2 - x1) * tFrac
    const cy = y1 + (y2 - y1) * tFrac
    let minDist = Infinity
    for (const pin of floorPins) {
      if (pin.id === srcId || pin.id === dstId) continue
      minDist = Math.min(minDist, Math.hypot(cx - pin.x, cy - pin.y))
    }
    if (avoidBadge) {
      minDist = Math.min(minDist, Math.hypot(cx - avoidBadge.mx, cy - avoidBadge.my))
    }
    if (minDist >= 22) {
      return { x: cx, y: cy }
    }
    if (minDist > bestScore) {
      bestScore = minDist
      best = { x: cx, y: cy }
    }
  }
  return best
}

function TopologyLinksLayer({
  allDevices,
  currentFloor,
  planW,
  planH,
  links,
  linkStates,
  impactReport,
  downLinkIds,
  isSimMode,
  isLinkEditMode,
  onToggleLinkDown,
  onDeleteLink,
}: Props) {
  const { t } = useTranslation()

  const deviceById = useMemo(
    () => new Map(allDevices.map(d => [d.id, d])),
    [allDevices],
  )

  const floorPins = useMemo(
    () => allDevices.filter(d => d.floor === currentFloor),
    [allDevices, currentFloor],
  )

  const dirResolver = useMemo(() => {
    const empty = new Set<string>()
    const report =
      impactReport ?? computeBlastRadius(allDevices, links, empty, empty, false)
    return buildFailureDirectionResolver(
      allDevices,
      links,
      report,
      downLinkIds ?? empty,
      isSimMode,
    )
  }, [allDevices, links, impactReport, downLinkIds, isSimMode])

  const renderedLinks = useMemo(() => {
    return links
      .map(link => {
        const src = deviceById.get(link.source_device_id)
        const dst = deviceById.get(link.target_device_id)
        if (!src || !dst) return null
        // Render only same-floor physical lines on the 2D canvas to avoid floating stub artifacts
        if (src.floor !== currentFloor || dst.floor !== currentFloor) return null

        let state: LinkImpactState = linkStates[link.id] ?? 'active'
        if (!isSimMode && state === 'active' && (src.status === 'offline' || dst.status === 'offline')) {
          state = 'isolated'
        }

        const isFailureFlow = state === 'severed' || state === 'isolated'
        const [flowSrc, flowDst] = isFailureFlow
          ? dirResolver.orientEndpoints(link, src, dst)
          : [src, dst]

        const x1 = flowSrc.x
        const y1 = flowSrc.y
        const x2 = flowDst.x
        const y2 = flowDst.y
        const len = Math.hypot(x2 - x1, y2 - y1)
        const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
        const { mx, my } = pickClearBadgePoint(x1, y1, x2, y2, floorPins, src.id, dst.id)
        const hasBadge = state === 'severed' || (isLinkEditMode && state !== 'severed')
        const chevron =
          isFailureFlow && len >= 44
            ? pickClearChevronPoint(x1, y1, x2, y2, floorPins, src.id, dst.id, hasBadge ? { mx, my } : null)
            : null

        return {
          link,
          src,
          dst,
          flowSrc,
          flowDst,
          state,
          isFailureFlow,
          x1,
          y1,
          x2,
          y2,
          angleDeg,
          mx,
          my,
          chevron,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [links, deviceById, floorPins, currentFloor, linkStates, isSimMode, isLinkEditMode, dirResolver])

  if (renderedLinks.length === 0) return null

  return (
    <svg
      className={styles.svgLayer}
      width={planW}
      height={planH}
      viewBox={`0 0 ${planW} ${planH}`}
      aria-label="Network topology links"
    >
      {renderedLinks.map(item => {
        const { link, src, dst, flowSrc, flowDst, state, isFailureFlow, x1, y1, x2, y2, angleDeg, mx, my, chevron } = item
        const stateClass =
          state === 'severed'
            ? styles.lineSevered
            : state === 'isolated'
              ? styles.lineIsolated
              : state === 'failover_active'
                ? styles.lineFailover
                : link.is_redundant
                  ? styles.lineRedundant
                  : link.link_type === 'wan'
                    ? styles.lineWan
                    : link.link_type === 'trunk'
                      ? styles.lineTrunk
                      : styles.lineAccess

        const trackClass =
          state === 'severed'
            ? styles.lineTrackSevered
            : state === 'isolated'
              ? styles.lineTrackIsolated
              : state === 'failover_active'
                ? styles.lineTrackFailover
                : ''

        const interactive = isSimMode || isLinkEditMode
        const title = isSimMode
          ? t('sim.clickLinkToToggle', { src: src.name, dst: dst.name })
          : isLinkEditMode
            ? t('topology.clickLinkToDelete', { src: src.name, dst: dst.name })
            : `${src.name} ↔ ${dst.name} (${link.bandwidth_mbps} Mbps)`

        return (
          <g key={link.id} className={interactive ? styles.interactiveGroup : styles.passiveGroup}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={styles.lineCasing}
            />

            {trackClass && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={trackClass}
              />
            )}

            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`${styles.lineBase} ${stateClass}`}
              data-flow-dir={isFailureFlow ? `${flowSrc.id}->${flowDst.id}` : undefined}
            />

            {chevron && (
              <g
                transform={`translate(${chevron.x}, ${chevron.y}) rotate(${angleDeg})`}
                className={state === 'severed' ? styles.flowArrowSevered : styles.flowArrowIsolated}
                aria-hidden="true"
              >
                <circle r={5.5} className={styles.flowArrowBg} />
                <path d="M-2.2,-2.6 L2.4,0 L-2.2,2.6" className={styles.flowArrowPath} />
              </g>
            )}

            {interactive && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={styles.hitArea}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation()
                  if (isSimMode) onToggleLinkDown(link.id)
                  else if (isLinkEditMode) onDeleteLink(link.id)
                }}
              >
                <title>{title}</title>
              </line>
            )}

            {state === 'severed' && (
              <g
                transform={`translate(${mx}, ${my})`}
                className={styles.severBadge}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  if (isSimMode) {
                    e.stopPropagation()
                    onToggleLinkDown(link.id)
                  }
                }}
              >
                <circle r={8} className={styles.severCircle} />
                <path d="M-3,-3 L3,3 M3,-3 L-3,3" className={styles.severCross} />
              </g>
            )}

            {isLinkEditMode && state !== 'severed' && (
              <g
                transform={`translate(${mx}, ${my})`}
                className={styles.deleteBadge}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation()
                  onDeleteLink(link.id)
                }}
              >
                <title>{title}</title>
                <circle r={8} className={styles.deleteCircle} />
                <path d="M-3,-3 L3,3 M3,-3 L-3,3" className={styles.severCross} />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default memo(TopologyLinksLayer)
