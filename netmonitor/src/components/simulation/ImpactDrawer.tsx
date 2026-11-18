import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device } from '../../types'
import { useNetwork } from '../../context/networkContext'
import { useFaultSim } from '../../context/faultSimContext'
import { useToast } from '../ui/toast-context'
import ConfirmDialog from '../ui/ConfirmDialog'
import BusinessImpactSummary from './BusinessImpactSummary'
import { DEVICE_ICON } from '../../constants/deviceMeta'
import {
  FlaskConical,
  X,
  RotateCcw,
  Database,
  ServerCrash,
  Link2Off,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import styles from './ImpactDrawer.module.css'

interface Props {
  onFocusDevice?: (device: Device) => void
}

export default function ImpactDrawer({ onFocusDevice }: Props) {
  const { t } = useTranslation()
  const { devices } = useNetwork()
  const {
    isSimMode,
    links,
    downDeviceIds,
    downLinkIds,
    impactReport,
    toggleDeviceDown,
    toggleLinkDown,
    simulateSingleDeviceDown,
    resetSimulation,
    setSimMode,
    commitSimulationToDb,
  } = useFaultSim()
  const { showToast } = useToast()

  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [applying, setApplying] = useState(false)

  const deviceById = useMemo(() => new Map(devices.map(d => [d.id, d])), [devices])
  const linkById = useMemo(() => new Map(links.map(l => [l.id, l])), [links])

  const quickCandidates = useMemo(
    () => impactReport.spof_ranking.filter(c => c.unreachable_count + c.degraded_count > 0).slice(0, 3),
    [impactReport.spof_ranking],
  )

  const impactedDevices = useMemo(() => {
    const order = { root_down: 0, unreachable: 1, degraded: 2, healthy: 3 }
    return impactReport.device_impacts
      .filter(d => d.impact_state !== 'healthy')
      .sort(
        (a, b) =>
          order[a.impact_state] - order[b.impact_state] ||
          a.dependency_path.length - b.dependency_path.length ||
          a.floor - b.floor ||
          a.name.localeCompare(b.name),
      )
  }, [impactReport.device_impacts])

  if (!isSimMode) return null

  const hasFaults = downDeviceIds.size > 0 || downLinkIds.size > 0
  const { summary } = impactReport

  async function handleConfirmApply() {
    setConfirmApplyOpen(false)
    setApplying(true)
    try {
      const ok = await commitSimulationToDb()
      if (ok) {
        showToast(t('sim.applySuccess'), 'success')
      } else {
        showToast(t('sim.applyError'), 'error')
      }
    } finally {
      setApplying(false)
    }
  }

  return (
    <aside className={styles.drawer} aria-label={t('sim.drawerTitle')} data-testid="impact-drawer">
      <div className={styles.header} data-testid="sim-sandbox-banner">
        <div className={styles.headerTitle}>
          <FlaskConical size={16} className={styles.headerIcon} />
          <span>{t('sim.drawerTitle')}</span>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => {
            resetSimulation()
            setSimMode(false)
          }}
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X size={15} />
        </button>
      </div>

      {/* Step 1: Pick device to fail (Dropdown + Top Quick Chips + Active Faults) */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>{t('sim.pickDeviceLabel')}</div>
        <select
          className={styles.deviceSelect}
          value=""
          aria-label={t('sim.pickDeviceLabel')}
          onChange={e => {
            if (e.target.value) simulateSingleDeviceDown(e.target.value)
          }}
        >
          <option value="">{t('sim.selectDevicePlaceholder')}</option>
          {impactReport.spof_ranking.map(c => (
            <option key={c.device_id} value={c.device_id}>
              {`${c.name} (${t('sim.affectsCountShort', { count: c.unreachable_count + c.degraded_count })})`}
            </option>
          ))}
          {devices
            .filter(d => d.dtype !== 'router' && d.dtype !== 'switch')
            .map(d => (
              <option key={d.id} value={d.id}>
                {`${d.name} (F${d.floor})`}
              </option>
            ))}
        </select>

        {quickCandidates.length > 0 && (
          <div className={styles.quickRow}>
            {quickCandidates.map(cand => {
              const active = downDeviceIds.has(cand.device_id)
              return (
                <button
                  key={cand.device_id}
                  type="button"
                  className={`${styles.quickBtn} ${active ? styles.quickBtnActive : ''}`}
                  onClick={() => toggleDeviceDown(cand.device_id)}
                >
                  <span>{cand.name}</span>
                  <span className={styles.quickCount}>{cand.unreachable_count + cand.degraded_count}</span>
                </button>
              )
            })}
          </div>
        )}

        {hasFaults && (
          <div className={styles.chips}>
            {[...downDeviceIds].map(id => {
              const dev = deviceById.get(id)
              if (!dev) return null
              return (
                <button
                  key={`dev-${id}`}
                  type="button"
                  className={styles.faultChip}
                  onClick={() => toggleDeviceDown(id)}
                  title={t('sim.restoreDevice')}
                >
                  <ServerCrash size={12} />
                  <span>{dev.name}</span>
                  <X size={11} />
                </button>
              )
            })}
            {[...downLinkIds].map(lid => {
              const l = linkById.get(lid)
              if (!l) return null
              const sName = deviceById.get(l.source_device_id)?.name ?? l.source_device_id
              const tName = deviceById.get(l.target_device_id)?.name ?? l.target_device_id
              return (
                <button
                  key={`lnk-${lid}`}
                  type="button"
                  className={styles.faultChip}
                  onClick={() => toggleLinkDown(lid)}
                  title={t('sim.restoreLink')}
                >
                  <Link2Off size={12} />
                  <span>{`${sName} ↔ ${tName}`}</span>
                  <X size={11} />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Step 2: Compact Summary Strip */}
      {hasFaults && (
        <>
          <div className={styles.summaryStrip}>
            <span className={styles.sumCrit}>
              {`${t('sim.kpiRootDown')} ${summary.root_down_count}`}
            </span>
            <span className={styles.sumDot}>·</span>
            <span className={styles.sumWarn}>
              {`${t('sim.kpiUnreachable')} ${summary.unreachable_count}`}
            </span>
            {summary.degraded_count > 0 && (
              <>
                <span className={styles.sumDot}>·</span>
                <span className={styles.sumWarn}>
                  {`${t('sim.kpiDegraded')} ${summary.degraded_count}`}
                </span>
              </>
            )}
          </div>
          <BusinessImpactSummary
            zones={impactReport.affected_zones}
            services={impactReport.affected_services}
            variant="drawer"
            testId="sim-business-impact"
          />
        </>
      )}

      {/* Affected Devices List */}
      <div className={styles.body}>
        {impactedDevices.length === 0 ? (
          <div className={styles.emptyState}>
            <CheckCircle2 size={22} style={{ color: 'var(--status-online)' }} />
            <div className={styles.emptyText}>{t('sim.clickToFailHint')}</div>
          </div>
        ) : (
          <div className={styles.list}>
            {impactedDevices.map(item => {
              const dev = deviceById.get(item.device_id)
              const badgeClass =
                item.impact_state === 'root_down'
                  ? styles.badgeRoot
                  : item.impact_state === 'unreachable'
                    ? styles.badgeUnreach
                    : styles.badgeDegraded

              const chainText =
                item.dependency_path.length > 1
                  ? item.dependency_path.join(' ➔ ')
                  : t(`sim.reason_${item.impact_state}`, { defaultValue: item.reason })

              return (
                <button
                  key={item.device_id}
                  type="button"
                  className={styles.listRow}
                  onClick={() => dev && onFocusDevice?.(dev)}
                  title={t('sim.openDeviceDetailHint')}
                >
                  <span className={styles.rowIcon}>{DEVICE_ICON[item.dtype]}</span>
                  <div className={styles.rowInfo}>
                    <div className={styles.rowTitle}>
                      <span>{item.name}</span>
                      <span className={styles.rowFloor}>{`F${item.floor}`}</span>
                    </div>
                    <div className={styles.chainText} data-testid="dependency-chain">
                      {chainText}
                    </div>
                  </div>
                  <span className={`${styles.stateBadge} ${badgeClass}`}>
                    {t(`sim.state_${item.impact_state}`)}
                  </span>
                  <ArrowRight size={12} className={styles.rowArrow} />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Simple Footer */}
      <div className={styles.footer}>
        <div className={styles.footerRow}>
          <button
            type="button"
            className={styles.resetBtn}
            disabled={!hasFaults}
            onClick={resetSimulation}
          >
            <RotateCcw size={13} />
            <span>{t('sim.resetSandbox')}</span>
          </button>
          <button
            type="button"
            className={styles.doneBtn}
            onClick={() => {
              resetSimulation()
              setSimMode(false)
            }}
          >
            <span>{t('sim.exitSim')}</span>
          </button>
        </div>

        {hasFaults && (
          <button
            type="button"
            className={styles.applyLinkBtn}
            disabled={applying}
            onClick={() => setConfirmApplyOpen(true)}
          >
            <Database size={12} />
            <span>{applying ? t('sim.applying') : t('sim.applyToDb')}</span>
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmApplyOpen}
        title={t('sim.applyConfirmTitle')}
        message={t('sim.applyConfirmMsg', {
          down: summary.root_down_count,
          unreachable: summary.unreachable_count,
          degraded: summary.degraded_count,
        })}
        confirmLabel={t('sim.applyToDb')}
        danger
        onConfirm={handleConfirmApply}
        onCancel={() => setConfirmApplyOpen(false)}
      />
    </aside>
  )
}
