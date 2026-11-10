import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSettings } from './settingsContext'
import { SimulationContext, type SimulationContextValue } from './simulationContext'

export default function SimulationProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!settings.simEnabled) return
    const id = window.setInterval(() => {
      setTick(t => t + 1)
    }, settings.simIntervalSec * 1000)
    return () => window.clearInterval(id)
  }, [settings.simEnabled, settings.simIntervalSec])

  const value = useMemo<SimulationContextValue>(() => ({
    tick: settings.simEnabled ? tick : 0,
    live: settings.simEnabled,
    intervalSec: settings.simIntervalSec,
  }), [tick, settings.simEnabled, settings.simIntervalSec])

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>
}
