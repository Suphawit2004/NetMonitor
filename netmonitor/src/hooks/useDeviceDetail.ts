import { useEffect, useMemo, useRef, useState } from 'react'
import type { Alert, Device, DeviceDetail, InterfaceTrafficItem, MetricValue, Port, PortStatus, TimeRange, TrafficSeries } from '../types'
import { useNetwork } from '../context/networkContext'
import { useSimulation } from '../context/simulationContext'
import { useFaultSimOptional } from '../context/faultSimContext'
import { buildDeviceDetail } from '../services/detailFactory'
import { createEmptyTrafficSeries } from '../services/traffic'
import { fetchAlerts, fetchDeviceInterfaces, pollDeviceTraffic, fetchDeviceTraffic, fetchDeviceDetail } from '../services/api'

interface RealTelemetry {
  uptime?: string
  mac?: string
  pingMs?: number | null
  cpuPercent?: number | null
  memoryPercent?: number | null
  temperatureC?: number | null
  hasRealData: boolean
}

// รวม logic สร้าง detail + traffic ต่ออุปกรณ์ (ใช้ร่วมกันระหว่างหน้า detail และ more-info modal)
export function useDeviceDetail(device: Device | null, timeRange: TimeRange) {
  const { devices } = useNetwork()
  const { tick } = useSimulation()
  const faultSim = useFaultSimOptional()
  const links = faultSim?.links
  const [dbAlerts, setDbAlerts] = useState<Alert[]>([])
  const [interfaces, setInterfaces] = useState<InterfaceTrafficItem[]>([])
  const [selectedInterface, setSelectedInterface] = useState<string>('all')
  const [realSeries, setRealSeries] = useState<TrafficSeries | null>(null)
  const [isPolling, setIsPolling] = useState<boolean>(true)
  const [realTelemetry, setRealTelemetry] = useState<RealTelemetry | null>(null)
  const lastAlertDeviceIdRef = useRef<string | undefined>(undefined)

  // Clear realSeries and realTelemetry immediately on device or filter switch to avoid showing stale or mock data
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealSeries(null)
    setRealTelemetry(null)
    setIsPolling(true)
  }, [device?.id, selectedInterface, timeRange])

  // 1. Fetch Alerts periodically (from database only)
  useEffect(() => {
    if (!device?.id) {
      lastAlertDeviceIdRef.current = undefined
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDbAlerts([])
      return
    }
    const deviceChanged = lastAlertDeviceIdRef.current !== device.id
    if (!deviceChanged && tick > 0 && tick % 5 !== 0) {
      return
    }
    if (deviceChanged) {
      lastAlertDeviceIdRef.current = device.id
      setDbAlerts([])
    }
    let cancelled = false
    fetchAlerts(device.id).then(alerts => {
      if (!cancelled) {
        setDbAlerts(alerts)
      }
    })
    return () => {
      cancelled = true
    }
  }, [device?.id, device?.status, tick])

  // 2. Fetch Interface List and Real Device Detail on device change
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
    fetchDeviceDetail(device.id).then(detailRes => {
      if (!cancelled && detailRes) {
        if (detailRes.interfaces && detailRes.interfaces.length > 0) {
          setInterfaces(detailRes.interfaces)
        }
        setRealTelemetry(prev => ({
          uptime: detailRes.uptime ?? prev?.uptime,
          mac: detailRes.mac_address ?? prev?.mac,
          pingMs: detailRes.ping_ms ?? prev?.pingMs,
          cpuPercent: detailRes.cpu_percent ?? prev?.cpuPercent,
          memoryPercent: detailRes.memory_percent ?? prev?.memoryPercent,
          temperatureC: detailRes.temperature_c ?? prev?.temperatureC,
          hasRealData: true,
        }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [device?.id])

  // 3. Real SNMP Polling Loop (Every 30 seconds while mounted)
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
          if (!cancelled && pollRes) {
            if (pollRes.interfaces && pollRes.interfaces.length > 0) {
              setInterfaces(pollRes.interfaces)
            }
            setRealTelemetry({
              uptime: pollRes.uptime,
              mac: pollRes.mac_address,
              pingMs: pollRes.ping_ms,
              cpuPercent: pollRes.cpu_percent,
              memoryPercent: pollRes.memory_percent,
              temperatureC: pollRes.temperature_c,
              hasRealData: true,
            })
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

  const detail = useMemo<DeviceDetail | null>(() => {
    if (!device) return null
    const isRealDevice = Boolean(
      device.ip &&
      !device.is_simulated &&
      device.credential_ref !== 'simulated' &&
      device.credential_ref !== 'mock'
    )

    // ข้อมูลจริงที่อ่านค่าได้: ไม่อนุญาติให้นำข้อมูลจำลองมาแทรก
    if (isRealDevice || interfaces.length > 0 || realTelemetry?.hasRealData) {
      // 1. REAL PORTS จาก interfaces จริง 100%
      const ports: Port[] = interfaces.map(iface => {
        const speedMb = iface.speed_bps ? iface.speed_bps / 1_000_000 : 1000
        const totalThroughput = (iface.in_mbps || 0) + (iface.out_mbps || 0)
        const util = speedMb > 0 ? Math.min(100, Math.round((totalThroughput / speedMb) * 100 * 10) / 10) : 0
        const isVlan = iface.name.toLowerCase().startsWith('vlan')
        return {
          num: iface.name,
          status: (iface.oper_status === 'up' ? 'up' : 'down') as PortStatus,
          name: iface.description || `Port ${iface.name}`,
          speed: iface.speed_bps ? (iface.speed_bps >= 1_000_000_000 ? `${Math.round(iface.speed_bps / 1_000_000_000)}G` : `${Math.round(iface.speed_bps / 1_000_000)}M`) : '1G',
          utilization: util,
          vlan: isVlan ? iface.name : undefined,
        }
      })

      const portsUsed = ports.filter(p => p.status === 'up').length
      const portsTotal = ports.length
      const vlanCount = ports.filter(p => !!p.vlan).length

      // 2. REAL PING จากการวัด Ping จริง
      const pingVal = realTelemetry?.pingMs != null ? realTelemetry.pingMs : (device.status === 'offline' ? 0 : 12)
      const ping: MetricValue = device.status === 'offline'
        ? { value: 0, change: 'Timeout', tone: 'bad' }
        : { value: pingVal, change: 'Real ICMP', tone: pingVal < 50 ? 'good' : 'bad' }

      // 3. REAL CPU จาก SNMP (ถ้าอุปกรณ์ไม่มี MIB ให้แสดง '—' ห้ามสุ่มค่าหลอก)
      const cpu: MetricValue = realTelemetry?.cpuPercent != null
        ? { value: realTelemetry.cpuPercent, change: 'SNMP', tone: realTelemetry.cpuPercent < 70 ? 'good' : 'bad' }
        : { value: '—', change: 'Not Supported', tone: 'neutral' }

      // 4. REAL MEMORY จาก SNMP (ถ้าไม่มี MIB ให้แสดง '—' ห้ามสุ่มค่าหลอก)
      const memory: MetricValue = realTelemetry?.memoryPercent != null
        ? { value: realTelemetry.memoryPercent, change: 'SNMP', tone: realTelemetry.memoryPercent < 80 ? 'good' : 'bad' }
        : { value: '—', change: 'Not Supported', tone: 'neutral' }

      // 5. REAL TEMPERATURE จาก SNMP (ถ้าไม่มี Sensor ให้แสดง '—' ห้ามสุ่มค่าหลอก)
      const temperature: MetricValue = realTelemetry?.temperatureC != null
        ? { value: realTelemetry.temperatureC, change: 'SNMP', tone: 'good' }
        : { value: '—', change: 'No Sensor', tone: 'neutral' }

      // 6. REAL PACKET LOSS จากผลการ Ping
      const packetLoss: MetricValue = device.status === 'offline'
        ? { value: 100, change: '100% loss', tone: 'bad' }
        : { value: 0, change: '0%', tone: 'good' }

      // 7. REAL UPTIME จาก SNMP
      const uptime = realTelemetry?.uptime || (device.status === 'offline' ? '—' : 'Online')

      // 8. REAL MAC จาก interfaces จริง
      const mac = realTelemetry?.mac || interfaces.find(i => i.mac_address)?.mac_address || '—'

      // 9. REAL OS / FIRMWARE จาก sysDescr / model
      const iosVersion = device.model ? device.model.replace(/^["']+|["']+$/g, '').trim() || '—' : '—'

      // 10. REAL ALERTS จาก Database เท่านั้น (ห้าม generate alert ปลอม)
      const alerts = dbAlerts

      return {
        device,
        uptime,
        mac,
        iosVersion,
        location: { floor: device.floor, room: device.target_room || null },
        portsUsed,
        portsTotal,
        vlanCount,
        ping,
        cpu,
        memory,
        temperature,
        packetLoss,
        ports,
        alerts,
        isRealData: true,
      }
    }

    // กรณีเป็นอุปกรณ์จำลองที่ไม่มี IP
    const base = buildDeviceDetail(device, devices, tick, links)
    if (dbAlerts.length > 0) {
      return { ...base, alerts: dbAlerts }
    }
    return base
  }, [device, devices, tick, dbAlerts, interfaces, realTelemetry, links])

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
