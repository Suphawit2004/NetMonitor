import { createContext, useContext } from 'react'

export interface SimulationContextValue {
  tick: number
  live: boolean
  intervalSec: number
}

export const SimulationContext = createContext<SimulationContextValue>({
  tick: 0,
  live: false,
  intervalSec: 5,
})

export function useSimulation(): SimulationContextValue {
  return useContext(SimulationContext)
}
