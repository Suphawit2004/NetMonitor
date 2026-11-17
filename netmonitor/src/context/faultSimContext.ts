import { createContext, useContext } from 'react'
import type { BlastRadiusReport, ImpactState, LinkType, TopologyLink } from '../types'

export type SimulationPreset = 'core-router' | 'core-switch' | 'floor1-power' | 'top-spof'

export interface FaultSimContextValue {
  links: TopologyLink[]
  linksLoading: boolean
  isSimMode: boolean
  isLinkEditMode: boolean
  showLinks: boolean
  downDeviceIds: Set<string>
  downLinkIds: Set<string>
  impactReport: BlastRadiusReport
  liveImpactReport: BlastRadiusReport
  effectiveReport: BlastRadiusReport
  impactMap: Map<string, ImpactState>
  setSimMode: (active: boolean) => void
  toggleSimMode: () => void
  setLinkEditMode: (active: boolean) => void
  toggleLinkEditMode: () => void
  setShowLinks: (show: boolean) => void
  toggleShowLinks: () => void
  toggleDeviceDown: (deviceId: string) => void
  simulateSingleDeviceDown: (deviceId: string) => void
  toggleLinkDown: (linkId: string) => void
  applyPreset: (preset: SimulationPreset) => void
  resetSimulation: () => void
  createLink: (input: {
    source_device_id: string
    target_device_id: string
    source_port?: string
    target_port?: string
    link_type: LinkType
    bandwidth_mbps: number
    is_redundant: boolean
  }) => Promise<TopologyLink>
  removeLink: (linkId: string) => Promise<void>
  reInferLinks: () => Promise<void>
  commitSimulationToDb: () => Promise<boolean>
}

export const FaultSimContext = createContext<FaultSimContextValue | null>(null)

export function useFaultSim(): FaultSimContextValue {
  const ctx = useContext(FaultSimContext)
  if (!ctx) throw new Error('useFaultSim must be used inside <FaultSimProvider>')
  return ctx
}

export function useFaultSimOptional(): FaultSimContextValue | null {
  return useContext(FaultSimContext)
}
