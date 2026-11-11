import { useState, useMemo, useRef, useEffect } from 'react'
import type { Device } from '../../types'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../../context/settingsContext'
import { useToast } from '../ui/toast-context'
import HelpGuideModal from './HelpGuideModal'
import { DEVICE_ICON, STATUS_SEARCH, TYPE_SEARCH, FLOOR_KEYWORDS } from '../../constants/deviceMeta'
import {
  Layers,
  Server,
  BarChart3,
  Search,
  X,
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

  // ── Inline Search State (Anchored Dropdown) ──
  const [searchQuery, setSearchQuery] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const totalDevices = devices?.length ?? 0
  const onlineCount = useMemo(() => devices?.filter(d => d.status === 'online').length ?? 0, [devices])
  const warningCount = useMemo(() => devices?.filter(d => d.status === 'warning').length ?? 0, [devices])
  const offlineCount = useMemo(() => devices?.filter(d => d.status === 'offline').length ?? 0, [devices])

  // Matching results for inline search
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q || !devices) return []
    return devices
      .filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.ip ?? '').toLowerCase().includes(q) ||
        (d.model ?? '').toLowerCase().includes(q) ||
        d.dtype.includes(q) ||
        TYPE_SEARCH[d.dtype]?.some(w => w.includes(q)) ||
        STATUS_SEARCH[d.status]?.some(w => w.includes(q)) ||
        (FLOOR_KEYWORDS.some(w => q.includes(w))
          ? q.includes(String(d.floor)) || !/\d/.test(q)
          : false) ||
        q === String(d.floor)
      )
      .slice(0, 7)
  }, [devices, searchQuery])

  // Global Ctrl+K / Cmd+K listener to focus inline search bar
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        setIsDropdownOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Click outside listener to close dropdown
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, Math.max(0, searchResults.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = searchResults[activeIdx]
      if (selected) {
        handleSelectDevice(selected)
      }
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false)
      searchInputRef.current?.blur()
    }
  }

  function handleSelectDevice(device: Device) {
    setIsDropdownOpen(false)
    setSearchQuery('')
    searchInputRef.current?.blur()
    onSelectDevice?.(device)
  }

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

  const isSearchDropdownVisible = isDropdownOpen && searchQuery.trim().length > 0

  return (
    <nav
      className={`${styles.navbar} ${isSearchDropdownVisible ? styles.navbarSearchActive : ''}`}
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

      {/* ── โซนกลาง: ค้นหาด่วนพร้อม Dropdown ใต้บาร์ทันที (ไม่ต้องเด้ง Popup) ── */}
      <div className={styles.navCenter} ref={searchContainerRef}>
        <div className={`${styles.searchWrap} ${isDropdownOpen ? styles.searchWrapFocused : ''}`}>
          <Search size={14} className={styles.searchIcon} />
          <input
            ref={searchInputRef}
            type="text"
            className={styles.searchInput}
            placeholder={`${t('nav.search')}...`}
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value)
              setIsDropdownOpen(true)
              setActiveIdx(0)
            }}
            onFocus={() => {
              if (searchQuery.trim().length > 0) setIsDropdownOpen(true)
            }}
            onKeyDown={handleSearchKeyDown}
            aria-expanded={isDropdownOpen && searchQuery.trim().length > 0}
            aria-autocomplete="list"
          />
          {searchQuery ? (
            <button
              type="button"
              className={styles.searchClearBtn}
              onClick={() => {
                setSearchQuery('')
                setIsDropdownOpen(false)
                searchInputRef.current?.focus()
              }}
              title="ล้างคำค้นหา"
            >
              <X size={12} />
            </button>
          ) : (
            <kbd className={styles.searchKbd}>Ctrl+K</kbd>
          )}
        </div>

        {/* Dropdown ผลการค้นหาใต้บาร์ Search ทันที */}
        {isDropdownOpen && searchQuery.trim().length > 0 && (
          <div className={styles.searchDropdown} role="listbox">
            <div className={styles.dropdownHeader}>
              <span>{t('search.dialogLabel') || 'ผลการค้นหา'}</span>
              <span className={styles.dropdownCount}>{searchResults.length}</span>
            </div>

            <div className={styles.dropdownResults}>
              {searchResults.length === 0 ? (
                <div className={styles.dropdownEmpty}>{t('search.empty')}</div>
              ) : (
                searchResults.map((d, i) => {
                  const isItemActive = i === activeIdx
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="option"
                      aria-selected={isItemActive}
                      className={`${styles.dropdownItem} ${isItemActive ? styles.dropdownItemActive : ''}`}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => handleSelectDevice(d)}
                    >
                      <span className={styles.itemIcon}>{DEVICE_ICON[d.dtype]}</span>
                      <div className={styles.itemInfo}>
                        <div className={styles.itemName}>{d.name}</div>
                        <div className={styles.itemSub}>
                          {t('search.floor', { floor: d.floor })} · {d.ip ?? '—'}
                          {d.model ? ` · ${d.model}` : ''}
                        </div>
                      </div>
                      <span className={`${styles.itemStatus} ${styles[`status_${d.status}`]}`}>
                        <span className={styles.statusDot} />
                        <span>{t(`status.${d.status}`)}</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            <div className={styles.dropdownFooter}>
              <span>↑↓ เลือก</span>
              <span>↵ ดูข้อมูล</span>
              <span>Esc ปิด</span>
            </div>
          </div>
        )}
      </div>

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
