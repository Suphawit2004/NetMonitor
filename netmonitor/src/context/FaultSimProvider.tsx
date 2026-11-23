import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BlastRadiusReport, Device, DeviceStatus, ImpactState, LinkType, TopologyLink } from '../types'
import { useNetwork } from './networkContext'
import * as api from '../services/api'
import { FaultSimContext, resolveEffectiveDeviceStatus, type FaultSimContextValue, type SimulationPreset } from './faultSimContext'

const EMPTY_REPORT: BlastRadiusReport = {
  down_device_ids: [],
  down_link_ids: [],
  summary: {
    total_devices: 0,
    root_down_count: 0,
    unreachable_count: 0,
    degraded_count: 0,
    healthy_count: 0,
  },
  device_impacts: [],
  link_states: {},
  affected_floors: [],
  spof_ranking: [],
  affected_zones: [],
  affected_services: [],
}

export default function FaultSimProvider({ children }: { children: ReactNode }) {
  const { devices, retryDevices } = useNetwork()
  const [links, setLinks] = useState<TopologyLink[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [linksTopologyKey, setLinksTopologyKey] = useState<string | null>(null)

  const [isSimMode, setIsSimMode] = useState(false)
  const [isLinkEditMode, setIsLinkEditMode] = useState(false)
  const [showLinks, setShowLinks] = useState(true)
  const [downDeviceIds, setDownDeviceIds] = useState<Set<string>>(() => new Set())
  const [downLinkIds, setDownLinkIds] = useState<Set<string>>(() => new Set())
  const [impactReport, setImpactReport] = useState<BlastRadiusReport>(EMPTY_REPORT)
  const [liveImpactReport, setLiveImpactReport] = useState<BlastRadiusReport>(EMPTY_REPORT)

  const devicesRef = useRef(devices)
  useEffect(() => {
    devicesRef.current = devices
  }, [devices])

  const deviceTopologyKey = useMemo(
    () => devices.map(d => `${d.id}:${d.floor}`).join(','),
    [devices],
  )

  const deviceStatusKey = useMemo(
    () =>
      devices
        .map(d => `${d.id}:${d.dtype}:${d.floor}:${d.status}:${d.target_room ?? ''}:${(d.services ?? []).join(',')}`)
        .join('|'),
    [devices],
  )

  // Load topology links from backend (backend auto-infers if DB has none)
  useEffect(() => {
    const snapshot = devicesRef.current
    if (snapshot.length === 0) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setLinksLoading(true)
    })
    api.fetchTopologyLinks(snapshot)
      .then(fetched => {
        if (!cancelled) {
          setLinks(fetched)
          setLinksTopologyKey(deviceTopologyKey)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinksTopologyKey(deviceTopologyKey)
        }
      })
      .finally(() => {
        if (!cancelled) setLinksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [deviceTopologyKey])

  const activeLinks = useMemo(
    () => (devices.length === 0 ? [] : links),
    [devices.length, links],
  )

  const activeLinksRef = useRef(activeLinks)
  useEffect(() => {
    activeLinksRef.current = activeLinks
  }, [activeLinks])

  const linksKey = useMemo(
    () =>
      activeLinks
        .map(l => `${l.id}:${l.source_device_id}:${l.target_device_id}:${l.link_type}:${l.is_redundant ? 1 : 0}`)
        .join('|'),
    [activeLinks],
  )

  // Compute live outage & baseline SPOF report from backend engine when statuses or links change
  useEffect(() => {
    const curDevices = devicesRef.current
    const curLinks = activeLinksRef.current
    if (curDevices.length === 0) {
      setLiveImpactReport(EMPTY_REPORT)
      return
    }
    if (linksTopologyKey !== deviceTopologyKey) return
    let cancelled = false
    const offlineIds = curDevices.filter(d => d.status === 'offline').map(d => d.id)
    api.simulateImpact(offlineIds, [], true, curDevices, curLinks)
      .then(report => {
        if (!cancelled) setLiveImpactReport(report)
      })
      .catch(err => console.warn('Failed to compute live impact report', err))
    return () => {
      cancelled = true
    }
  }, [deviceStatusKey, linksKey, linksTopologyKey, deviceTopologyKey])

  const downDevicesKey = useMemo(() => [...downDeviceIds].sort().join(','), [downDeviceIds])
  const downLinksKey = useMemo(() => [...downLinkIds].sort().join(','), [downLinkIds])

  // Compute interactive sandbox impact report from backend engine when faults or links change
  useEffect(() => {
    if (!isSimMode) return
    const curDevices = devicesRef.current
    const curLinks = activeLinksRef.current
    if (curDevices.length === 0) {
      setImpactReport(EMPTY_REPORT)
      return
    }
    let cancelled = false
    const dIds = downDevicesKey ? downDevicesKey.split(',') : []
    const lIds = downLinksKey ? downLinksKey.split(',') : []
    api.simulateImpact(dIds, lIds, true, curDevices, curLinks)
      .then(report => {
        if (!cancelled) setImpactReport(report)
      })
      .catch(err => console.warn('Failed to compute sandbox impact report', err))
    return () => {
      cancelled = true
    }
  }, [isSimMode, deviceStatusKey, linksKey, downDevicesKey, downLinksKey])

  const hasActiveSimulation = isSimMode && (downDeviceIds.size > 0 || downLinkIds.size > 0)

  const effectiveReport = useMemo(
    () => (hasActiveSimulation ? impactReport : liveImpactReport),
    [hasActiveSimulation, impactReport, liveImpactReport],
  )

  const impactMap = useMemo(() => {
    const map = new Map<string, ImpactState>()
    for (const item of impactReport.device_impacts) {
      map.set(item.device_id, item.impact_state)
    }
    return map
  }, [impactReport])

  const effectiveImpactMap = useMemo(() => {
    const map = new Map<string, ImpactState>()
    for (const item of effectiveReport.device_impacts) {
      map.set(item.device_id, item.impact_state)
    }
    return map
  }, [effectiveReport])

  const getEffectiveStatus = useCallback(
    (device: Pick<Device, 'id' | 'status'>): DeviceStatus =>
      resolveEffectiveDeviceStatus(device.status, effectiveImpactMap.get(device.id), hasActiveSimulation),
    [effectiveImpactMap, hasActiveSimulation],
  )

  const effectiveDevices = useMemo(
    () =>
      devices.map(d => {
        const nextStatus = getEffectiveStatus(d)
        return nextStatus === d.status ? d : { ...d, status: nextStatus }
      }),
    [devices, getEffectiveStatus],
  )

  const setSimMode = useCallback((active: boolean) => {
    setIsSimMode(active)
    if (active) {
      setIsLinkEditMode(false)
      setShowLinks(true)
    }
  }, [])

  const toggleSimMode = useCallback(() => {
    setIsSimMode(prev => {
      const next = !prev
      if (next) {
        setIsLinkEditMode(false)
        setShowLinks(true)
      }
      return next
    })
  }, [])

  const setLinkEditMode = useCallback((active: boolean) => {
    setIsLinkEditMode(active)
    if (active) {
      setIsSimMode(false)
      setShowLinks(true)
    }
  }, [])

  const toggleLinkEditMode = useCallback(() => {
    setIsLinkEditMode(prev => {
      const next = !prev
      if (next) {
        setIsSimMode(false)
        setShowLinks(true)
      }
      return next
    })
  }, [])

  const toggleShowLinks = useCallback(() => {
    setShowLinks(prev => !prev)
  }, [])

  const toggleDeviceDown = useCallback((deviceId: string) => {
    setDownDeviceIds(prev => {
      const next = new Set(prev)
      if (next.has(deviceId)) next.delete(deviceId)
      else next.add(deviceId)
      return next
    })
  }, [])

  const simulateSingleDeviceDown = useCallback((deviceId: string) => {
    setIsLinkEditMode(false)
    setShowLinks(true)
    setIsSimMode(true)
    setDownLinkIds(new Set())
    setDownDeviceIds(new Set([deviceId]))
  }, [])

  const toggleLinkDown = useCallback((linkId: string) => {
    setDownLinkIds(prev => {
      const next = new Set(prev)
      if (next.has(linkId)) next.delete(linkId)
      else next.add(linkId)
      return next
    })
  }, [])

  const applyPreset = useCallback(
    (preset: SimulationPreset) => {
      setDownLinkIds(new Set())
      if (preset === 'core-router') {
        const routers = devices.filter(d => d.dtype === 'router' && d.status !== 'offline')
        const targets = routers.length > 0 ? routers : devices.filter(d => d.dtype === 'router')
        setDownDeviceIds(new Set(targets.slice(0, 1).map(d => d.id)))
      } else if (preset === 'core-switch') {
        const core =
          devices.find(d => d.dtype === 'switch' && d.name.toLowerCase().includes('core')) ??
          devices.find(d => d.dtype === 'switch' && d.floor === 1)
        if (core) setDownDeviceIds(new Set([core.id]))
      } else if (preset === 'floor1-power') {
        const f1 = devices.filter(d => d.floor === 1)
        setDownDeviceIds(new Set(f1.map(d => d.id)))
      } else if (preset === 'top-spof') {
        const top = impactReport.spof_ranking[0] ?? liveImpactReport.spof_ranking[0]
        if (top) setDownDeviceIds(new Set([top.device_id]))
      }
    },
    [devices, impactReport.spof_ranking, liveImpactReport.spof_ranking],
  )

  const resetSimulation = useCallback(() => {
    setDownDeviceIds(new Set())
    setDownLinkIds(new Set())
  }, [])

  const createLink = useCallback(
    async (input: {
      source_device_id: string
      target_device_id: string
      source_port?: string
      target_port?: string
      link_type: LinkType
      bandwidth_mbps: number
      is_redundant: boolean
    }) => {
      const created = await api.createTopologyLink(input)
      setLinks(prev => [...prev, created])
      return created
    },
    [],
  )

  const removeLink = useCallback(async (linkId: string) => {
    const ok = await api.deleteTopologyLink(linkId)
    if (ok) {
      setLinks(prev => prev.filter(l => l.id !== linkId))
      setDownLinkIds(prev => {
        const next = new Set(prev)
        next.delete(linkId)
        return next
      })
    }
  }, [])

  const reInferLinks = useCallback(async () => {
    setLinksLoading(true)
    try {
      const refreshed = await api.inferTopologyLinks(devices)
      setLinks(refreshed)
    } finally {
      setLinksLoading(false)
    }
  }, [devices])

  const commitSimulationToDb = useCallback(async () => {
    const ok = await api.applySimulatedFaults([...downDeviceIds], [...downLinkIds])
    if (ok) {
      retryDevices()
    }
    return ok
  }, [downDeviceIds, downLinkIds, retryDevices])

  const value = useMemo<FaultSimContextValue>(
    () => ({
      links: activeLinks,
      linksLoading,
      isSimMode,
      isLinkEditMode,
      showLinks,
      downDeviceIds,
      downLinkIds,
      impactReport,
      liveImpactReport,
      effectiveReport,
      impactMap,
      effectiveDevices,
      getEffectiveStatus,
      setSimMode,
      toggleSimMode,
      setLinkEditMode,
      toggleLinkEditMode,
      setShowLinks,
      toggleShowLinks,
      toggleDeviceDown,
      simulateSingleDeviceDown,
      toggleLinkDown,
      applyPreset,
      resetSimulation,
      createLink,
      removeLink,
      reInferLinks,
      commitSimulationToDb,
    }),
    [
      activeLinks,
      linksLoading,
      isSimMode,
      isLinkEditMode,
      showLinks,
      downDeviceIds,
      downLinkIds,
      impactReport,
      liveImpactReport,
      effectiveReport,
      impactMap,
      effectiveDevices,
      getEffectiveStatus,
      setSimMode,
      toggleSimMode,
      setLinkEditMode,
      toggleLinkEditMode,
      toggleShowLinks,
      toggleDeviceDown,
      simulateSingleDeviceDown,
      toggleLinkDown,
      applyPreset,
      resetSimulation,
      createLink,
      removeLink,
      reInferLinks,
      commitSimulationToDb,
    ],
  )

  return <FaultSimContext.Provider value={value}>{children}</FaultSimContext.Provider>
}
