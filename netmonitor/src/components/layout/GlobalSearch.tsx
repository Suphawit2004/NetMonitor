import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { Device } from '../../types'
import { DEVICE_ICON, STATUS_SEARCH, TYPE_SEARCH, FLOOR_KEYWORDS } from '../../constants/deviceMeta'
import { Search } from 'lucide-react'
import styles from './GlobalSearch.module.css'

const MAX_RESULTS = 8

interface Props {
  devices: Device[]
  onClose: () => void
  onSelect: (device: Device) => void
}

export default function GlobalSearch({ devices, onClose, onSelect }: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q === ''
      ? devices
      : devices.filter(d =>
          d.name.toLowerCase().includes(q) ||
          (d.ip ?? '').toLowerCase().includes(q) ||
          (d.model ?? '').toLowerCase().includes(q) ||
          d.dtype.includes(q) ||
          TYPE_SEARCH[d.dtype].some(w => w.includes(q)) ||
          STATUS_SEARCH[d.status].some(w => w.includes(q)) ||
          (FLOOR_KEYWORDS.some(w => q.includes(w))
            ? q.includes(String(d.floor)) || !/\d/.test(q)
            : false) ||
          q === String(d.floor))
    return list.slice(0, MAX_RESULTS)
  }, [devices, query])

  const active = results[Math.min(activeIdx, results.length - 1)]

  // ปิดด้วย Escape ได้เสมอ (แม้ focus หลุดจาก input)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active) onSelect(active)
    }
  }

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={styles.panel} role="dialog" aria-label={t('search.dialogLabel')}>
        <div className={styles.inputRow}>
          <Search size={20} className={styles.searchIcon} />
          <input
            className={styles.input}
            placeholder={t('search.placeholder')}
            value={query}
            autoFocus
            onChange={e => { setQuery(e.target.value); setActiveIdx(0) }}
            onKeyDown={handleKeyDown}
          />
          <kbd className={styles.kbd}>Esc</kbd>
        </div>

        <div className={styles.results}>
          {results.length === 0 ? (
            <div className={styles.empty}>{t('search.empty')}</div>
          ) : (
            results.map((d, i) => (
              <button
                key={d.id}
                type="button"
                className={`${styles.item} ${i === activeIdx ? styles.itemActive : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => onSelect(d)}
              >
                <span className={styles.itemIcon} aria-hidden="true">{DEVICE_ICON[d.dtype]}</span>
                <span className={styles.itemName}>{d.name}</span>
                <span className={styles.itemMeta}>{t('search.floor', { floor: d.floor })} · {d.ip ?? '—'}</span>
                <span className={`${styles.itemStatus} ${styles[`st_${d.status}`]}`}>
                  {t(`status.${d.status}`)}
                </span>
              </button>
            ))
          )}
        </div>

        <div className={styles.footerHint}>{t('search.footerHint')}</div>
      </div>
    </div>,
    document.body,
  )
}
