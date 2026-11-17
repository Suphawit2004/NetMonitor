import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Device, RawDevice, ConnectResult, DeviceType } from '../types'
import * as api from '../services/api'
import { getStoredBuildingBounds, canvasToGps } from '../services/mapGeo'
import { NetworkContext, type NetworkContextValue } from './networkContext'

const LIVE_POLL_INTERVAL_MS = 15_000
const MUTATION_GUARD_MS = 2_500

function deviceSnapshotKey(list: Device[]): string {
  return list
    .map(d => [
      d.id,
      d.name,
      d.dtype,
      d.status,
      d.floor,
      d.x,
      d.y,
      d.locked ? 1 : 0,
      d.ip ?? '',
      d.model ?? '',
      d.latitude ?? '',
      d.longitude ?? '',
      d.altitude ?? '',
      d.target_room ?? '',
      (d.services ?? []).join('\u0001'),
    ].join('|'))
    .join('\n')
}

export default function NetworkProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

  const devicesRef = useRef(devices)
  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  const loadSeq = useRef(0)
  const mountedRef = useRef(true)
  const lastMutationAtRef = useRef(0)
  const bgPollInFlightRef = useRef(false)
  // StrictMode จะ unmount/remount จำลอง — ต้อง set กลับเป็น true ทุกครั้งที่ mount
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const cancelled = useCallback((seq: number): boolean => {
    return !mountedRef.current || seq !== loadSeq.current
  }, [])

  // โหลดอุปกรณ์จาก mock API — เรียกซ้ำได้ (ใช้เป็น retry)
  const loadDevices = useCallback(() => {
    const seq = ++loadSeq.current
    api.fetchDevices()
      .then(list => {
        if (cancelled(seq)) return
        setDevices(list)
        setError(null)
      })
      .catch(() => {
        if (cancelled(seq)) return
        // เก็บเป็น i18n key — แปลตอน render เพื่อรองรับการเปลี่ยนภาษา
        setError('errors.loadFailed')
      })
      .finally(() => {
        if (cancelled(seq)) return
        setLoading(false)
      })
  }, [cancelled])

  const silentRefreshDevices = useCallback(() => {
    if (bgPollInFlightRef.current) return
    if (Date.now() - lastMutationAtRef.current < MUTATION_GUARD_MS) return

    const seq = loadSeq.current
    bgPollInFlightRef.current = true
    api.fetchDevices()
      .then(list => {
        if (cancelled(seq)) return
        if (Date.now() - lastMutationAtRef.current < MUTATION_GUARD_MS) return
        if (deviceSnapshotKey(list) !== deviceSnapshotKey(devicesRef.current)) {
          setDevices(list)
        }
        setError(null)
      })
      .catch(() => {
        // Keep current UI state untouched during silent background sync failure
      })
      .finally(() => {
        bgPollInFlightRef.current = false
      })
  }, [cancelled])

  useEffect(() => { loadDevices() }, [loadDevices])

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        silentRefreshDevices()
      }
    }, LIVE_POLL_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        silentRefreshDevices()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [silentRefreshDevices])

  const retryDevices = useCallback(() => {
    setLoading(true)
    loadDevices()
  }, [loadDevices])

  const selectDevice = useCallback((id: string | null) => {
    setSelectedDeviceId(id)
  }, [])

  const addDevice = useCallback(async (input: Omit<RawDevice, 'id'>) => {
    lastMutationAtRef.current = Date.now()
    const created = await api.createDevice(input)
    lastMutationAtRef.current = Date.now()
    setDevices(prev => [...prev, created])
    return created
  }, [])

  const updateDevice = useCallback(async (id: string, patch: Partial<Omit<Device, 'id'>>) => {
    lastMutationAtRef.current = Date.now()
    const updated = await api.updateDevice(id, patch)
    lastMutationAtRef.current = Date.now()
    if (updated) setDevices(prev => prev.map(d => (d.id === id ? updated : d)))
    return updated
  }, [])

  // ระหว่างลาก pin อัปเดต state ทันที (optimistic) ทั้ง 2D canvas และ GPS (ถ้ามี)
  const moveDevice = useCallback((id: string, x: number, y: number, lat?: number, lon?: number) => {
    lastMutationAtRef.current = Date.now()
    setDevices(prev => prev.map(d => {
      if (d.id !== id) return d
      const updated: Device = { ...d, x, y }
      if (typeof lat === 'number' && typeof lon === 'number') {
        updated.latitude = lat
        updated.longitude = lon
      }
      return updated
    }))
  }, [])

  // ลากจบ → sync ตำแหน่งล่าสุดทั้ง (x, y) และ (latitude, longitude) โดยคงสถานะ locked เดิมไว้
  const commitDevicePosition = useCallback((id: string) => {
    lastMutationAtRef.current = Date.now()
    const target = devicesRef.current.find(d => d.id === id)
    if (!target || target.x === undefined || target.y === undefined) return

    const bounds = getStoredBuildingBounds()
    const [calcLat, calcLon] = canvasToGps(target.x, target.y, bounds)
    const finalLat = Number(calcLat.toFixed(7))
    const finalLon = Number(calcLon.toFixed(7))

    api.updateDevice(id, {
      x: target.x,
      y: target.y,
      latitude: finalLat,
      longitude: finalLon,
      locked: target.locked,
    }).catch(err => console.warn('Failed to commit device position', err))

    setDevices(prev => prev.map(d => (d.id === id ? { ...d, latitude: finalLat, longitude: finalLon } : d)))
  }, [])

  const toggleLock = useCallback((id: string) => {
    lastMutationAtRef.current = Date.now()
    const target = devicesRef.current.find(d => d.id === id)
    if (!target) return
    const nextLocked = !target.locked
    api.updateDevice(id, { locked: nextLocked }).catch(err => console.warn('Failed to update lock', err))
    setDevices(prev => prev.map(d => (d.id === id ? { ...d, locked: nextLocked } : d)))
  }, [])

  const setLockMany = useCallback((ids: string[], locked: boolean) => {
    lastMutationAtRef.current = Date.now()
    const idSet = new Set(ids)
    ids.forEach(id => {
      api.updateDevice(id, { locked }).catch(err => console.warn('Failed to batch lock', err))
    })
    setDevices(prev => prev.map(d => (idSet.has(d.id) ? { ...d, locked } : d)))
  }, [])

  const setFloorLockAll = useCallback((floor: 1 | 2, locked: boolean) => {
    lastMutationAtRef.current = Date.now()
    const floorDevs = devicesRef.current.filter(d => d.floor === floor)
    floorDevs.forEach(d => {
      api.updateDevice(d.id, { locked }).catch(err => console.warn('Failed to update floor lock', err))
    })
    setDevices(prev => prev.map(d => (d.floor === floor ? { ...d, locked } : d)))
  }, [])

  const removeDevice = useCallback(async (id: string) => {
    lastMutationAtRef.current = Date.now()
    await api.deleteDevice(id)
    lastMutationAtRef.current = Date.now()
    setDevices(prev => prev.filter(d => d.id !== id))
    setSelectedDeviceId(prev => (prev === id ? null : prev))
  }, [])

  const resetDevices = useCallback(async () => {
    const list = await api.resetDevices()
    setDevices(list)
    setSelectedDeviceId(null)
  }, [])

  const clearDevices = useCallback(async () => {
    const list = await api.clearDevices()
    setDevices(list)
    setSelectedDeviceId(null)
  }, [])

  const simulateSampleStatuses = useCallback(async () => {
    const list = await api.simulateSampleStatuses()
    setDevices(list)
    setSelectedDeviceId(null)
  }, [])

  const connectDevice = useCallback(async (id: string): Promise<ConnectResult> => {
    const res = await api.connectDevice(id)
    if (res.success) {
      setDevices(prev => prev.map(d => (d.id === id ? { ...d, status: res.status } : d)))
    }
    return res
  }, [])

  const importDiscovered = useCallback(async (
    items: Array<{
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
    }>
  ) => {
    const imported = await api.importDiscoveredDevices(items)
    setDevices(prev => [...prev, ...imported])
    return imported
  }, [])

  const selectedDevice = useMemo(
    () => devices.find(d => d.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  )

  const value = useMemo<NetworkContextValue>(() => ({
    devices, loading, error,
    selectedDeviceId, selectedDevice,
    selectDevice, retryDevices, addDevice, updateDevice, moveDevice, commitDevicePosition,
    toggleLock, setLockMany, setFloorLockAll, removeDevice, resetDevices, clearDevices, simulateSampleStatuses, connectDevice, importDiscovered,
  }), [
    devices, loading, error,
    selectedDeviceId, selectedDevice,
    selectDevice, retryDevices, addDevice, updateDevice, moveDevice, commitDevicePosition,
    toggleLock, setLockMany, setFloorLockAll, removeDevice, resetDevices, clearDevices, simulateSampleStatuses, connectDevice, importDiscovered,
  ])

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}
