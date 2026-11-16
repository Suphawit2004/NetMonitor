import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device } from '../../types'
import { useNetwork } from '../../context/networkContext'
import { useFaultSim } from '../../context/faultSimContext'
import { useToast } from '../ui/toast-context'
import ConfirmDialog from '../ui/ConfirmDialog'
import { DEVICE_ICON } from '../../constants/deviceMeta'
import {
  FlaskConical,
  X,
  RotateCcw,
  Database,
  ServerCrash,
  ShieldAlert,
  Link2Off,
  CheckCircle2,
} from 'lucide-react'
import styles from './ImpactDrawer.module.css'

type DrawerTab = 'devices' | 'spof'

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
    applyPreset,
    resetSimulation,
    setSimMode,
    commitSimulationToDb,
  } = useFaultSim()
  const { showToast } = useToast()

  const [tab, setTab] = useState<DrawerTab>('devices')
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false)
  const [applying, setApplying] = useState(false)

  const deviceById = useMemo(() => new Map(devices.map(d => [d.id, d])), [devices])
  const linkById = useMemo(() => new Map(links.map(l => [l.id, l])), [links])

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
      <div className={styles.header}>
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
          title={t('sim.exitSim')}
          aria-label={t('sim.exitSim')}
        >
          <X size={15} />
        </button>
      </div>

      {/* Quick Presets */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>{t('sim.presetsTitle')}</div>
        <div className={styles.presetGrid}>
          <button type="button" className={styles.presetBtn} onClick={() => applyPreset('core-router')}>
            {t('sim.presetCoreRouter')}
          </button>
          <button type="button" className={styles.presetBtn} onClick={() => applyPreset('core-switch')}>
            {t('sim.presetCoreSwitch')}
          </button>
          <button type="button" className={styles.presetBtn} onClick={() => applyPreset('floor1-power')}>
            {t('sim.presetFloor1Power')}
          </button>
          <button type="button" className={styles.presetBtn} onClick={() => applyPreset('top-spof')}>
            {t('sim.presetTopSpof')}
          </button>
        </div>
      </div>

      {/* Active Fault Chips */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          {t('sim.selectedFaults', { count: downDeviceIds.size + downLinkIds.size })}
        </div>
        {!hasFaults ? (
          <div className={styles.hintBox}>{t('sim.clickToFailHint')}</div>
        ) : (
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

      {/* Device-Only KPIs */}
      <div className={styles.kpiGrid}>
        <div className={`${styles.kpiCard} ${summary.root_down_count > 0 ? styles.kpiCrit : ''}`}>
          <div className={styles.kpiVal}>{summary.root_down_count}</div>
          <div className={styles.kpiLabel}>{t('sim.kpiRootDown')}</div>
        </div>
        <div className={`${styles.kpiCard} ${summary.unreachable_count > 0 ? styles.kpiCrit : ''}`}>
          <div className={styles.kpiVal}>{summary.unreachable_count}</div>
          <div className={styles.kpiLabel}>{t('sim.kpiUnreachable')}</div>
        </div>
        <div className={`${styles.kpiCard} ${summary.degraded_count > 0 ? styles.kpiWarn : ''}`}>
          <div className={styles.kpiVal}>{summary.degraded_count}</div>
          <div className={styles.kpiLabel}>{t('sim.kpiDegraded')}</div>
        </div>
      </div>

      {/* Detail Tabs (Strictly Devices & SPOF) */}
      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'devices'}
          className={`${styles.tabBtn} ${tab === 'devices' ? styles.tabActive : ''}`}
          onClick={() => setTab('devices')}
        >
          {t('sim.tabDevices')} ({impactedDevices.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'spof'}
          className={`${styles.tabBtn} ${tab === 'spof' ? styles.tabActive : ''}`}
          onClick={() => setTab('spof')}
        >
          {t('sim.tabSpof')}
        </button>
      </div>

      <div className={styles.body}>
        {tab === 'devices' && (
          impactedDevices.length === 0 ? (
            <div className={styles.emptyState}>
              <CheckCircle2 size={20} style={{ color: 'var(--status-online)' }} />
              <span>{t('sim.noImpactYet')}</span>
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
                    title={chainText}
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
                  </button>
                )
              })}
            </div>
          )
        )}

        {tab === 'spof' && (
          <div className={styles.list}>
            {impactReport.spof_ranking.map((cand, idx) => (
              <div key={cand.device_id} className={styles.spofRow}>
                <div className={styles.spofRank}>{`#${idx + 1}`}</div>
                <div className={styles.rowInfo}>
                  <div className={styles.rowTitle}>
                    <span>{cand.name}</span>
                    <span className={styles.rowFloor}>{`F${cand.floor}`}</span>
                  </div>
                  <div className={styles.rowSub}>
                    {t('sim.spofMeta', {
                      unreachable: cand.unreachable_count,
                      degraded: cand.degraded_count,
                    })}
                  </div>
                  {cand.affected_device_names.length > 0 && (
                    <div className={styles.spofPeers}>
                      {cand.affected_device_names.slice(0, 5).join(', ')}
                      {cand.affected_device_names.length > 5
                        ? ` +${cand.affected_device_names.length - 5}`
                        : ''}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={styles.spofTestBtn}
                  onClick={() => {
                    simulateSingleDeviceDown(cand.device_id)
                    setTab('devices')
                  }}
                  title={t('sim.testThisSpof')}
                >
                  <ShieldAlert size={12} />
                  <span>{t('sim.testBtn')}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className={styles.footer}>
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
          className={styles.applyBtn}
          disabled={!hasFaults || applying}
          onClick={() => setConfirmApplyOpen(true)}
        >
          <Database size={13} />
          <span>{applying ? t('sim.applying') : t('sim.applyToDb')}</span>
        </button>
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
