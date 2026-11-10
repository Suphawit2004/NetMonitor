import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_SETTINGS, SettingsContext, type AppSettings, type SettingsContextValue,
} from './settingsContext'
import i18n from '../i18n'

const STORAGE_KEY = 'netmonitor:settings'

function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export default function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // localStorage ถูกปิด (เช่น โหมดส่วนตัว) — ใช้ค่าใน memory แทน
    }
  }, [settings])

  // sync ภาษากับ i18next + <html lang>
  useEffect(() => {
    if (i18n.language !== settings.language) void i18n.changeLanguage(settings.language)
    document.documentElement.lang = settings.language
  }, [settings.language])

  // sync theme กับ <html data-theme>
  useEffect(() => {
    const currentTheme = settings.theme || 'dark'
    document.documentElement.setAttribute('data-theme', currentTheme)
  }, [settings.theme])

  // sync uiScale กับ <html data-ui-scale> และ style.zoom
  useEffect(() => {
    const scale = settings.uiScale || '150%'
    document.documentElement.setAttribute('data-ui-scale', scale)
    const numericZoom = scale === '100%' ? '1' : scale === '125%' ? '1.25' : '1.5'
    document.documentElement.style.zoom = numericZoom
  }, [settings.uiScale])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }))
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
  }, [])

  const value = useMemo<SettingsContextValue>(() => ({
    settings, updateSettings, resetSettings,
  }), [settings, updateSettings, resetSettings])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
