import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import styles from './MetricCard.module.css'

interface Props {
  label: string
  value: number | string
  unit: string
  change?: string
  tone?: 'good' | 'bad' | 'neutral'
  fillColor: 'green' | 'yellow' | 'red'
  fillPercent: number
  valueColor?: string
}

const TONE_CLASS = {
  good: 'changeGood',
  bad: 'changeBad',
  neutral: 'changeNeutral',
} as const

export default function MetricCard({
  label, value, unit, change, tone = 'neutral',
  fillColor, fillPercent, valueColor,
}: Props) {
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {change && (
          <span className={`${styles.change} ${styles[TONE_CLASS[tone]]}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {change.startsWith('▲') ? (
              <TrendingUp size={11} aria-hidden="true" />
            ) : change.startsWith('▼') ? (
              <TrendingDown size={11} aria-hidden="true" />
            ) : (
              <Minus size={11} aria-hidden="true" />
            )}
            <span>{change.replace(/^[▲▼—]\s*/, '')}</span>
          </span>
        )}
      </div>
      <div>
        <span className={styles.value} style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </span>
        <span className={styles.unit}>{unit}</span>
      </div>
      <div className={styles.progBar}>
        <div
          className={`${styles.progFill} ${styles[fillColor]}`}
          style={{ width: `${Math.min(fillPercent, 100)}%` }}
        />
      </div>
    </div>
  )
}
