import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device, LinkImpactState, TopologyLink } from '../../types'
import styles from './TopologyLinksLayer.module.css'

interface Props {
  allDevices: Device[]
  currentFloor: 1 | 2
  planW: number
  planH: number
  links: TopologyLink[]
  linkStates: Record<string, LinkImpactState>
  isSimMode: boolean
  isLinkEditMode: boolean
  onToggleLinkDown: (linkId: string) => void
  onDeleteLink: (linkId: string) => void
  onFloorChange?: (floor: 1 | 2) => void
}

function TopologyLinksLayer({
  allDevices,
  currentFloor,
  planW,
  planH,
  links,
  linkStates,
  isSimMode,
  isLinkEditMode,
  onToggleLinkDown,
  onDeleteLink,
  onFloorChange,
}: Props) {
  const { t } = useTranslation()

  const deviceById = useMemo(
    () => new Map(allDevices.map(d => [d.id, d])),
    [allDevices],
  )

  const renderedLinks = useMemo(() => {
    return links
      .map(link => {
        const src = deviceById.get(link.source_device_id)
        const dst = deviceById.get(link.target_device_id)
        if (!src || !dst) return null
        const srcOnFloor = src.floor === currentFloor
        const dstOnFloor = dst.floor === currentFloor
        if (!srcOnFloor && !dstOnFloor) return null

        const state: LinkImpactState = linkStates[link.id] ?? 'active'
        const isCrossFloor = srcOnFloor !== dstOnFloor
        const localDev = srcOnFloor ? src : dst
        const remoteDev = srcOnFloor ? dst : src

        const x1 = localDev.x
        const y1 = localDev.y
        const x2 = isCrossFloor ? Math.min(planW - 24, localDev.x + 42) : remoteDev.x
        const y2 = isCrossFloor ? Math.max(24, localDev.y - 34) : remoteDev.y
        const mx = (x1 + x2) / 2
        const my = (y1 + y2) / 2

        return {
          link,
          src,
          dst,
          localDev,
          remoteDev,
          isCrossFloor,
          state,
          x1,
          y1,
          x2,
          y2,
          mx,
          my,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [links, deviceById, currentFloor, linkStates, planW])

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
        const { link, src, dst, remoteDev, isCrossFloor, state, x1, y1, x2, y2, mx, my } = item
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
              className={`${styles.lineBase} ${stateClass}`}
            />

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

            {isCrossFloor && (
              <g
                transform={`translate(${x2}, ${y2})`}
                className={styles.crossFloorPill}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation()
                  onFloorChange?.(remoteDev.floor)
                }}
              >
                <title>{`${remoteDev.name} (Floor ${remoteDev.floor})`}</title>
                <rect x={-16} y={-9} width={32} height={18} rx={5} className={styles.crossFloorRect} />
                <text textAnchor="middle" dominantBaseline="central" className={styles.crossFloorText}>
                  {`F${remoteDev.floor}`}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default memo(TopologyLinksLayer)
