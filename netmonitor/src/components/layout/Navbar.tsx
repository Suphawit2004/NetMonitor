import { useState, useMemo } from 'react'
import type { Device } from '../../types'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../../context/settingsContext'
import { useToast } from '../ui/toast-context'
import HelpGuideModal from './HelpGuideModal'
import NavbarSearch from './NavbarSearch'
import {
  Layers,
  Server,
  BarChart3,
  Sun,
  Moon,
  Play,
  Pause,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import styles from './Navbar.module.css'

export type NavPage = 'floor' | 'list' | 'reports'

interface Props {
  activePage: NavPage | 'detail'
  devices?: Device[]
  onNavigate: (page: NavPage) => void
  onSelectDevice?: (device: Device) => void
  onOpenSearch?: () => void
}

const NAV_ITEMS: { key: NavPage; labelKey: string }[] = [
  { key: 'floor', labelKey: 'nav.floor' },
  { key: 'list',  labelKey: 'nav.list' },
  { key: 'reports', labelKey: 'nav.reports' },
]

export default function Navbar({ activePage, devices, onNavigate, onSelectDevice }: Props) {
  const { t } = useTranslation()
  const { settings, updateSettings } = useSettings()
  const { showToast } = useToast()
  const [helpOpen, setHelpOpen] = useState(false)
  const [isSearchActive, setIsSearchActive] = useState(false)

  const totalDevices = devices?.length ?? 0
  const onlineCount = useMemo(() => devices?.filter(d => d.status === 'online').length ?? 0, [devices])
  const warningCount = useMemo(() => devices?.filter(d => d.status === 'warning').length ?? 0, [devices])
  const offlineCount = useMemo(() => devices?.filter(d => d.status === 'offline').length ?? 0, [devices])

  // หน้า detail ถือเป็นส่วนหนึ่งของ "แผนผัง"
  const activeKey: NavPage = activePage === 'detail' ? 'floor' : activePage

  function toggleLive() {
    const next = !settings.simEnabled
    updateSettings({ simEnabled: next })
    showToast(next ? t('nav.liveOn') : t('nav.liveOff'), 'info')
  }

  function toggleTheme() {
    const nextTheme = settings.theme === 'light' ? 'dark' : 'light'
    updateSettings({ theme: nextTheme })
  }

  return (
    <nav
      className={`${styles.navbar} ${isSearchActive ? styles.navbarSearchActive : ''}`}
      aria-label="Main navigation"
    >
      {/* ── โซนซ้าย: แบรนด์ + แท็บนำทางหลัก ── */}
      <div className={styles.navLeft}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            Net<span>Monitor</span>
          </div>
          <span className={styles.versionBadge}>v1.3</span>
        </div>

        <div className={styles.brandDivider} />

        <div className={styles.navLinks} role="tablist">
          {NAV_ITEMS.map(item => {
            const isActive = activeKey === item.key
            return (
              <button
                key={item.key}
                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                onClick={() => onNavigate(item.key)}
                aria-current={isActive ? 'page' : undefined}
                role="tab"
                aria-selected={isActive}
              >
                {item.key === 'list' ? (
                  <span className={styles.navItemContent}>
                    <Server size={15} />
                    <span>{t(item.labelKey)}</span>
                    {totalDevices > 0 && (
                      <span className={styles.countBadge}>{totalDevices}</span>
                    )}
                  </span>
                ) : item.key === 'reports' ? (
                  <span className={styles.navItemContent}>
                    <BarChart3 size={15} />
                    <span>{t(item.labelKey)}</span>
                  </span>
                ) : (
                  <span className={styles.navItemContent}>
                    <Layers size={15} />
                    <span>{t(item.labelKey)}</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── โซนกลาง: ค้นหาด่วนพร้อม Dropdown ย่อย (Modularized Component) ── */}
      <NavbarSearch
        devices={devices}
        onSelectDevice={onSelectDevice}
        onDropdownVisibilityChange={setIsSearchActive}
      />

      {/* ── โซนขวา: สถานะเครือข่าย + กลุ่มเครื่องมือ ── */}
      <div className={styles.navRight}>
        {totalDevices > 0 && (
          <button
            className={`${styles.healthPill} ${
              offlineCount > 0
                ? styles.healthCritical
                : warningCount > 0
                ? styles.healthWarning
                : styles.healthHealthy
            }`}
            onClick={() => onNavigate('reports')}
            title={t('reports.title')}
            type="button"
          >
            {offlineCount > 0 ? (
              <>
                <AlertCircle size={13} />
                <span>{t('nav.systemCritical', { count: offlineCount })}</span>
              </>
            ) : warningCount > 0 ? (
              <>
                <AlertTriangle size={13} />
                <span>{t('nav.systemWarning', { count: warningCount })}</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={13} />
                <span>{t('nav.systemHealthy', { online: onlineCount, total: totalDevices })}</span>
              </>
            )}
          </button>
        )}

        <div className={styles.utilGroup}>
          {/* ปุ่ม LIVE จำลอง */}
          <button
            className={`${styles.liveBtn} ${settings.simEnabled ? styles.liveOn : ''}`}
            onClick={toggleLive}
            title={settings.simEnabled ? t('nav.livePauseTitle') : t('nav.liveStartTitle')}
            type="button"
          >
            {settings.simEnabled ? <Pause size={12} /> : <Play size={12} />}
            <span>{settings.simEnabled ? 'LIVE' : 'PAUSED'}</span>
          </button>

          {/* สลับภาษา */}
          <div className={styles.langSwitch} role="group" aria-label={t('settings.language')}>
            {(['th', 'en'] as const).map(lang => (
              <button
                key={lang}
                className={`${styles.langBtn} ${settings.language === lang ? styles.langActive : ''}`}
                onClick={() => updateSettings({ language: lang })}
                aria-pressed={settings.language === lang}
                type="button"
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>

          {/* สลับธีม สว่าง / มืด */}
          <button
            className={styles.iconBtn}
            onClick={toggleTheme}
            title={settings.theme === 'light' ? t('nav.switchToDark') : t('nav.switchToLight')}
            aria-label={t('nav.switchToDark')}
            type="button"
          >
            {settings.theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* ปุ่มคู่มือช่วยเหลือ */}
          <button
            className={styles.iconBtn}
            onClick={() => setHelpOpen(true)}
            title={t('nav.helpTitle')}
            aria-label={t('nav.help')}
            type="button"
          >
            <HelpCircle size={15} />
          </button>

          <div className={styles.avatar} title="NetMonitor Console v1.3.0" aria-label="NetMonitor">
            NM
          </div>
        </div>
      </div>

      <HelpGuideModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </nav>
  )
}
