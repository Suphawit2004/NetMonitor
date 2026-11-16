import { useTranslation } from 'react-i18next'
import type { ServiceImpactDetail, ZoneImpactDetail } from '../../types'
import { Building2, Layers } from 'lucide-react'
import styles from './BusinessImpactSummary.module.css'

interface Props {
  zones: ZoneImpactDetail[]
  services: ServiceImpactDetail[]
  variant: 'drawer' | 'report'
  testId?: string
}

export default function BusinessImpactSummary({ zones, services, variant, testId }: Props) {
  const { t } = useTranslation()

  if (zones.length === 0 && services.length === 0) return null

  return (
    <div
      className={`${styles.wrap} ${variant === 'drawer' ? styles.drawerMode : styles.reportMode}`}
      data-testid={testId}
    >
      {zones.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupLabel}>{t('sim.affectedZonesLabel')}</div>
          <div className={styles.pillList}>
            {zones.slice(0, variant === 'drawer' ? 4 : 8).map(z => (
              <span
                key={`${z.floor}-${z.zone}`}
                className={`${styles.pill} ${z.impact_state === 'outage' ? styles.outage : styles.degraded}`}
                title={z.affected_devices.join(', ')}
              >
                <Building2 size={11} />
                <span>{z.zone}</span>
                <span className={styles.meta}>
                  {`${z.down_count}/${z.total_count}`}
                </span>
              </span>
            ))}
            {variant === 'drawer' && zones.length > 4 && (
              <span className={`${styles.pill} ${styles.degraded}`}>+{zones.length - 4}</span>
            )}
          </div>
        </div>
      )}

      {services.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupLabel}>{t('sim.affectedServicesLabel')}</div>
          <div className={styles.pillList}>
            {services.slice(0, variant === 'drawer' ? 6 : 10).map(s => (
              <span
                key={s.service}
                className={`${styles.pill} ${s.impact_state === 'outage' ? styles.outage : styles.degraded}`}
                title={`${s.source_devices.join(', ')} (${s.zones.join(', ')})`}
              >
                <Layers size={11} />
                <span>{s.service}</span>
              </span>
            ))}
            {variant === 'drawer' && services.length > 6 && (
              <span className={`${styles.pill} ${styles.degraded}`}>+{services.length - 6}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
