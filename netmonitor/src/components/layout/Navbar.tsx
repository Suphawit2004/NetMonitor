import { useState, useMemo } from 'react'
import type { Device } from '../../types'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../../context/settingsContext'
import { useToast } from '../ui/toast-context'
import HelpGuideModal from './HelpGuideModal'
import {
  Layers,
  Server,
  BarChart3,
  Search,
  Sun,
  Moon,
  Play,
  Pause,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ZoomIn,
} from 'lucide-react'
import styles from './Navbar.module.css'

export type NavPage = 'floor' | 'list' | 'reports'

interface Props {
  activePage: NavPage | 'detail'
  devices?: Device[]
  onNavigate: (page: NavPage) => void
  onOpenSearch: () => void
}

const NAV_ITEMS: { key: NavPage; labelKey: string }[] = [
  { key: 'floor', labelKey: 'nav.floor' },
  { key: 'list',  labelKey: 'nav.list' },
  { key: 'reports', labelKey: 'nav.reports' },
]

export default function Navbar({ activePage, devices, onNavigate, onOpenSearch }: Props) {
  const { t } = useTranslation()
  const { settings, updateSettings } = useSettings()
  const { showToast } = useToast()
  const [helpOpen, setHelpOpen] = useState(false)

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

  function toggleScale() {
    const scales: ('100%' | '125%' | '150%')[] = ['100%', '125%', '150%']
    const current = settings.uiScale || '150%'
    const nextIdx = (scales.indexOf(current) + 1) % scales.length
    const nextScale = scales[nextIdx]
    updateSettings({ uiScale: nextScale })
    showToast(t('settings.uiScaleChanged', { scale: nextScale }), 'info')
  }

  return (
    <nav className={styles.navbar} aria-label="Main navigation">
      <div className={styles.logo}>
        Net<span>Monitor</span>
      </div>

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

      <div className={styles.navLinks}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            className={`${styles.navItem} ${activeKey === item.key ? styles.active : ''}`}
            onClick={() => onNavigate(item.key)}
            aria-current={activeKey === item.key ? 'page' : undefined}
          >
            {item.key === 'list' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Server size={16} />
                <span>{t(item.labelKey)}</span>
              </span>
            ) : item.key === 'reports' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <BarChart3 size={16} />
                <span>{t(item.labelKey)}</span>
              </span>
            ) : item.key === 'floor' ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Layers size={16} />
                <span>{t(item.labelKey)}</span>
              </span>
            ) : (
              t(item.labelKey)
            )}
          </button>
        ))}
      </div>

      <div className={styles.navRight}>
        <button
          className={styles.searchBtn}
          onClick={onOpenSearch}
          title={t('nav.searchTitle')}
        >
          <Search size={15} />
          <span className={styles.searchLabel}>{t('nav.search')}...</span>
          <kbd className={styles.searchKbd}>Ctrl+K</kbd>
        </button>
        <div className={styles.langSwitch} role="group" aria-label={t('settings.language')}>
          {(['th', 'en'] as const).map(lang => (
            <button
              key={lang}
              className={`${styles.langBtn} ${settings.language === lang ? styles.langActive : ''}`}
              onClick={() => updateSettings({ language: lang })}
              aria-pressed={settings.language === lang}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className={`${styles.scaleBtn} ${settings.uiScale === '150%' ? styles.scaleActive : ''}`}
          onClick={toggleScale}
          title={t('settings.uiScaleTitle')}
          aria-label={t('settings.uiScale')}
          type="button"
        >
          <ZoomIn size={14} />
          <span>{settings.uiScale || '150%'}</span>
        </button>

        <button
          className={styles.themeBtn}
          onClick={toggleTheme}
          title={settings.theme === 'light' ? t('nav.switchToDark') : t('nav.switchToLight')}
          aria-label={t('nav.switchToDark')}
        >
          {settings.theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          className={`${styles.liveBtn} ${settings.simEnabled ? styles.liveOn : ''}`}
          onClick={toggleLive}
          title={settings.simEnabled ? t('nav.livePauseTitle') : t('nav.liveStartTitle')}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {settings.simEnabled ? <Pause size={13} /> : <Play size={13} />}
            <span>LIVE</span>
          </span>
        </button>
        <button
          className={styles.helpBtn}
          onClick={() => setHelpOpen(true)}
          title={t('nav.helpTitle')}
          aria-label={t('nav.help')}
          type="button"
        >
          <HelpCircle size={15} />
          <span>{t('nav.help')}</span>
        </button>

        <div className={styles.avatar} title="NetMonitor Console v1.3.0" aria-label="NetMonitor">NM</div>
      </div>

      <HelpGuideModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </nav>
  )
}
