// สีตามระดับค่า (ใช้ร่วมกันระหว่างหน้ารายละเอียดและ more-info modal)
export function levelColor(
  value: number | string | null | undefined,
  warn: number,
  crit: number,
): { text: string; fill: 'green' | 'yellow' | 'red' } {
  if (typeof value !== 'number' || isNaN(value)) {
    return { text: 'var(--text-muted, #94a3b8)', fill: 'green' }
  }
  if (value >= crit) return { text: '#ef4444', fill: 'red' }
  if (value >= warn) return { text: '#fbbf24', fill: 'yellow' }
  return { text: '#22c55e', fill: 'green' }
}
