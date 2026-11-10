import { useEffect, useMemo, useState } from 'react'
import type { Alert, Device, InterfaceTrafficItem, TimeRange, TrafficSeries } from '../types'
import { useNetwork } from '../context/networkContext'
import { useSimulation } from '../context/simulationContext'
import { buildDeviceDetail } from '../services/detailFactory'
import { createEmptyTrafficSeries } from '../services/traffic'
import { fetchAlerts, fetchDeviceInterfaces, pollDeviceTraffic, fetchDeviceTraffic } from '../services/api'

// รวม logic สร้าง detail + traffic ต่ออุปกรณ์ (ใช้ร่วมกันระหว่างหน้า detail และ more-info modal)
export function useDeviceDetail(device: Device | null, timeRange: TimeRange) {
  const { devices } = useNetwork()
  const { tick } = useSimulation()
  const [dbAlerts, setDbAlerts] = useState<Alert[]>([])
  const [interfaces, setInterfaces] = useState<InterfaceTrafficItem[]>([])
  const [selectedInterface, setSelectedInterface] = useState<string>('all')
  const [realSeries, setRealSeries] = useState<TrafficSeries | null>(null)
  const [isPolling, setIsPolling] = useState<boolean>(true)

  // Clear realSeries immediately on device or filter switch to avoid showing stale or mock data
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealSeries(null)
    setIsPolling(true)
  }, [device?.id, selectedInterface, timeRange])

  // 1. Fetch Alerts periodically
  useEffect(() => {
    if (!device?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDbAlerts([])
      return
    }
    if (tick > 0 && tick % 5 !== 0 && dbAlerts.length > 0) {
      return
    }
    let cancelled = false
    fetchAlerts(device.id).then(alerts => {
      if (!cancelled && alerts.length > 0) {
        setDbAlerts(alerts)
      }
    })
    return () => {
      cancelled = true
    }
  }, [device?.id, device?.status, tick])

  // 2. Fetch Interface List on device change
  useEffect(() => {
    if (!device?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInterfaces([])
      return
    }
    let cancelled = false
    fetchDeviceInterfaces(device.id).then(list => {
      if (!cancelled) {
        setInterfaces(list)
      }
    })
    return () => {
      cancelled = true
    }
  }, [device?.id])

  // 3. Real SNMP Polling Loop (Every 5 seconds while mounted)
  useEffect(() => {
    if (!device?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRealSeries(null)
      setIsPolling(false)
      return
    }

    let cancelled = false
    const pollAndFetch = async () => {
      try {
        setIsPolling(true)
        // If device has an IP, trigger active SNMP poll
        if (device.ip) {
          const pollRes = await pollDeviceTraffic(device.id)
          if (!cancelled && pollRes?.interfaces && pollRes.interfaces.length > 0) {
            setInterfaces(pollRes.interfaces)
          }
        }
        // Fetch series from DB
        const seriesData = await fetchDeviceTraffic(device.id, selectedInterface, timeRange)
        if (!cancelled && seriesData) {
          setRealSeries(seriesData)
        }
      } catch (err) {
        console.warn('Real traffic poll error', err)
      } finally {
        if (!cancelled) setIsPolling(false)
      }
    }

    // Initial immediate poll
    pollAndFetch()

    // 30-second interval loop (avoids hammering physical devices with frequent SNMP queries)
    const timer = setInterval(pollAndFetch, 30000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [device?.id, device?.ip, selectedInterface, timeRange])

  const detail = useMemo(() => {
    if (!device) return null
    const base = buildDeviceDetail(device, devices, tick)
    if (dbAlerts.length > 0) {
      return { ...base, alerts: dbAlerts }
    }
    return base
  }, [device, devices, tick, dbAlerts])

  const series = useMemo<TrafficSeries | null>(() => {
    if (!device) return null
    // If real backend series is loaded, use it continuously without re-triggering initial load
    if (realSeries) {
      return {
        ...realSeries,
        isInitialLoading: false,
        isRefreshing: isPolling,
      }
    }
    // Only during the very first poll (before real data arrives)
    return {
      ...createEmptyTrafficSeries(timeRange),
      isInitialLoading: true,
      isRefreshing: isPolling,
    }
  }, [device, timeRange, realSeries, isPolling])

  return {
    detail,
    series,
    interfaces,
    selectedInterface,
    setSelectedInterface,
    isPolling,
    hasSnmp: realSeries?.hasSnmp,
  }
}
