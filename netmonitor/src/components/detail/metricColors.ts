// สีตามระดับค่า (ใช้ร่วมกันระหว่างหน้ารายละเอียดและ more-info modal)
export function levelColor(
  value: number,
  warn: number,
  crit: number,
): { text: string; fill: 'green' | 'yellow' | 'red' } {
  if (value >= crit) return { text: '#ef4444', fill: 'red' }
  if (value >= warn) return { text: '#fbbf24', fill: 'yellow' }
  return { text: '#22c55e', fill: 'green' }
}
