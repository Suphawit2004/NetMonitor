import type { ReactNode } from 'react'
import type { DeviceStatus, DeviceType } from '../types'
import { Network, Router, Wifi, Server } from 'lucide-react'

// ไอคอน Lucide component ต่อประเภทอุปกรณ์
export const DEVICE_ICON: Record<DeviceType, ReactNode> = {
  switch: <Network size={16} aria-label="Switch" style={{ verticalAlign: '-0.15em', display: 'inline-block' }} />,
  router: <Router size={16} aria-label="Router" style={{ verticalAlign: '-0.15em', display: 'inline-block' }} />,
  ap:     <Wifi size={16} aria-label="AP" style={{ verticalAlign: '-0.15em', display: 'inline-block' }} />,
  server: <Server size={16} aria-label="Server" style={{ verticalAlign: '-0.15em', display: 'inline-block' }} />,
}

// คำค้นหาของแต่ละประเภท — ครอบคลุมทั้งไทย/อังกฤษ ไม่ขึ้นกับภาษาที่เลือกอยู่
export const TYPE_SEARCH: Record<DeviceType, string[]> = {
  switch: ['switch', 'สวิตช์'],
  ap: ['ap', 'access point', 'แอ็กเซสพอยต์'],
  router: ['router', 'เราเตอร์'],
  server: ['server', 'เซิร์ฟเวอร์'],
}

export const STATUS_SEARCH: Record<DeviceStatus, string[]> = {
  online: ['online', 'ออนไลน์', 'ปกติ'],
  warning: ['warning', 'warn', 'เตือน', 'มีคำเตือน'],
  offline: ['offline', 'ออฟไลน์', 'ล่ม'],
}

export const FLOOR_KEYWORDS = ['floor', 'ชั้น']

