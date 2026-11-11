import { createContext, useContext } from 'react'
import type { Device, RawDevice, ConnectResult, DeviceType } from '../types'

export interface NetworkContextValue {
  devices: Device[]
  loading: boolean
  error: string | null
  selectedDeviceId: string | null
  selectedDevice: Device | null
  selectDevice: (id: string | null) => void
  retryDevices: () => void
  addDevice: (input: Omit<RawDevice, 'id'>) => Promise<Device>
  updateDevice: (id: string, patch: Partial<Omit<Device, 'id'>>) => Promise<Device | null>
  moveDevice: (id: string, x: number, y: number, lat?: number, lon?: number) => void
  commitDevicePosition: (id: string) => void
  toggleLock: (id: string) => void
  setLockMany: (ids: string[], locked: boolean) => void
  setFloorLockAll: (floor: 1 | 2, locked: boolean) => void
  removeDevice: (id: string) => Promise<void>
  resetDevices: () => Promise<void>
  clearDevices: () => Promise<void>
  simulateSampleStatuses: () => Promise<void>
  connectDevice: (id: string) => Promise<ConnectResult>
  importDiscovered: (items: Array<{
    name: string
    ip: string
    dtype: DeviceType
    floor: 1 | 2
    x?: number
    y?: number
    model?: string
    community?: string | null
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
  }>) => Promise<Device[]>
}

export const NetworkContext = createContext<NetworkContextValue | null>(null)

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork ต้องใช้ภายใน <NetworkProvider>')
  return ctx
}
