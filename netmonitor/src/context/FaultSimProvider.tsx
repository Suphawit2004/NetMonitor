import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ImpactState, LinkType, TopologyLink } from '../types'
import { useNetwork } from './networkContext'
import * as api from '../services/api'
import { computeBlastRadius, inferTopologyLinks } from '../services/topologyEngine'
import { FaultSimContext, type FaultSimContextValue, type SimulationPreset } from './faultSimContext'

export default function FaultSimProvider({ children }: { children: ReactNode }) {
  const { devices, retryDevices } = useNetwork()
  const [links, setLinks] = useState<TopologyLink[]>([])
  const [linksLoading, setLinksLoading] = useState(false)

  const [isSimMode, setIsSimMode] = useState(false)
  const [isLinkEditMode, setIsLinkEditMode] = useState(false)
  const [showLinks, setShowLinks] = useState(true)
  const [downDeviceIds, setDownDeviceIds] = useState<Set<string>>(() => new Set())
  const [downLinkIds, setDownLinkIds] = useState<Set<string>>(() => new Set())

  // Load topology links whenever devices are available
  useEffect(() => {
    if (devices.length === 0) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setLinksLoading(true)
    })
    api.fetchTopologyLinks(devices)
      .then(fetched => {
        if (cancelled) return
        if (fetched.length > 0) {
          setLinks(fetched)
        } else {
          setLinks(inferTopologyLinks(devices))
        }
      })
      .finally(() => {
        if (!cancelled) setLinksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [devices])

  const activeLinks = useMemo(
    () => (devices.length === 0 ? [] : links),
    [devices.length, links],
  )

  const impactReport = useMemo(
    () => computeBlastRadius(devices, activeLinks, downDeviceIds, downLinkIds, true),
    [devices, activeLinks, downDeviceIds, downLinkIds],
  )

  const impactMap = useMemo(() => {
    const map = new Map<string, ImpactState>()
    for (const item of impactReport.device_impacts) {
      map.set(item.device_id, item.impact_state)
    }
    return map
  }, [impactReport])

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
        const top = impactReport.spof_ranking[0]
        if (top) setDownDeviceIds(new Set([top.device_id]))
      }
    },
    [devices, impactReport.spof_ranking],
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
      impactMap,
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
      impactMap,
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
