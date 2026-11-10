import type { Port } from '../types'

// รูปแบบ t ที่ใช้ใน helper — เลี่ยงพาดพิง type เต็มของ i18next
export type Translate = (key: string, options?: Record<string, unknown>) => string

// เวลาแบบ relative ("5 นาทีที่แล้ว" / "5 minutes ago") — แปลตอน render ไม่ใช่ตอนสร้างข้อมูล
export function formatTimeAgo(minutes: number, t: Translate): string {
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minutesAgo', { count: minutes })
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60)
    return t('time.hoursAgo', { count: hours })
  }
  const days = Math.round(minutes / 1440)
  return t('time.daysAgo', { count: days })
}

// ชื่อพอร์ต — nameKey (i18n key) มีลำดับความสำคัญเหนือ name (ข้อความตรง)
export function portName(port: Pick<Port, 'name' | 'nameKey'>, t: Translate): string {
  return port.nameKey ? t(port.nameKey) : port.name
}
