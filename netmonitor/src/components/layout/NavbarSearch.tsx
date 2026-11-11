import { useState, useMemo, useRef, useEffect } from 'react'
import type { Device } from '../../types'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { DEVICE_ICON, STATUS_SEARCH, TYPE_SEARCH, FLOOR_KEYWORDS } from '../../constants/deviceMeta'
import styles from './NavbarSearch.module.css'

export interface NavbarSearchProps {
  devices?: Device[]
  onSelectDevice?: (device: Device) => void
  onDropdownVisibilityChange?: (isOpen: boolean) => void
}

export default function NavbarSearch({
  devices,
  onSelectDevice,
  onDropdownVisibilityChange,
}: NavbarSearchProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  const isDropdownVisible = isDropdownOpen && searchQuery.trim().length > 0

  useEffect(() => {
    onDropdownVisibilityChange?.(isDropdownVisible)
  }, [isDropdownVisible, onDropdownVisibilityChange])

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

  return (
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
          aria-expanded={isDropdownVisible}
          aria-autocomplete="list"
        />
        {searchQuery && (
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
        )}
      </div>

      {/* Anchored search dropdown under search input */}
      {isDropdownVisible && (
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
  )
}
