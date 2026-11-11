import { createContext, useContext } from 'react'

export type Language = 'th' | 'en'
export type Theme = 'dark' | 'light'
export type UiScale = '100%' | '125%' | '150%'

export interface AppSettings {
  simEnabled: boolean
  simIntervalSec: number
  language: Language
  theme: Theme
  uiScale: UiScale
}

export const DEFAULT_SETTINGS: AppSettings = {
  simEnabled: false,
  simIntervalSec: 5,
  language: 'th',
  theme: 'dark',
  uiScale: '100%',
}

export interface SettingsContextValue {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void
  resetSettings: () => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings ต้องใช้ภายใน <SettingsProvider>')
  return ctx
}
