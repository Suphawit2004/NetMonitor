import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, AlertCircle, Info, Check } from 'lucide-react'
import type { Alert } from '../../types'
import { formatTimeAgo } from '../../i18n/format'
import styles from './AlertList.module.css'

interface Props {
  alerts: Alert[]
  onViewAll?: () => void
  onAcknowledge?: (alertId: string | number) => void
}

const SEV_CLASS: Record<Alert['severity'], string> = {
  warn: styles.warn,
  info: styles.info,
  crit: styles.crit,
}

function renderSeverityIcon(severity: Alert['severity']) {
  if (severity === 'crit') return <AlertCircle size={16} />
  if (severity === 'warn') return <AlertTriangle size={16} />
  return <Info size={16} />
}

export default function AlertList({ alerts, onViewAll, onAcknowledge }: Props) {
  const { t } = useTranslation()
  const [ackedIds, setAckedIds] = useState<Set<string | number>>(() => new Set())

  const handleAck = (id: string | number) => {
    setAckedIds(prev => new Set(prev).add(id))
    onAcknowledge?.(id)
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{t('alerts.title')}</span>
        {onViewAll && (
          <button className={styles.viewAll} onClick={onViewAll}>{t('alerts.viewAll')}</button>
        )}
      </div>
      {alerts.map(alert => {
        const msg = alert.messageKey ? t(alert.messageKey, alert.params) : (alert.title || 'Alert')
        const minutesAgo = alert.timeMinutesAgo !== undefined
          ? alert.timeMinutesAgo
          : alert.createdAt
            // eslint-disable-next-line react-hooks/purity
            ? Math.max(1, Math.round((Date.now() - new Date(alert.createdAt).getTime()) / 60000))
            : 0

        const isAckable = alert.severity === 'warn' || alert.severity === 'crit'
        const isAcked = Boolean(alert.acknowledged || ackedIds.has(alert.id))

        return (
          <div key={String(alert.id)} className={styles.item}>
            <span className={styles.icon} aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {renderSeverityIcon(alert.severity)}
            </span>
            <div className={styles.body}>
              <div className={styles.msg}>{msg}</div>
              {alert.description && (
                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 3 }}>
                  {alert.description}
                </div>
              )}
              <div className={styles.time}>{formatTimeAgo(minutesAgo, t)}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className={`${styles.sev} ${SEV_CLASS[alert.severity]}`}>
                {alert.severity.toUpperCase()}
              </span>
              {isAckable && isAcked && (
                <span style={{ fontSize: 12, color: 'var(--status-online)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Check size={13} />
                  <span>{t('alerts.ackDone')}</span>
                </span>
              )}
              {isAckable && onAcknowledge && !isAcked && (
                <button
                  onClick={() => handleAck(alert.id)}
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {t('alerts.ackButton')}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
