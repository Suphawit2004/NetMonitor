import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device } from '../../types'
import { resolveDeviceServices } from '../../services/topologyEngine'
import { useToast } from '../ui/toast-context'
import { Layers, Plus, RotateCcw, X } from 'lucide-react'
import styles from './ServiceTagsEditor.module.css'

const PRESET_SERVICES = [
  'Internet Gateway',
  'Wi-Fi',
  'LAN / PoE',
  'DHCP',
  'DNS',
  'Database',
  'Internal ERP',
  'CCTV / NVR',
]

interface Props {
  device: Device
  editable?: boolean
  onSave?: (services: string[]) => Promise<Device | null | undefined> | void
}

export default function ServiceTagsEditor({ device, editable = false, onSave }: Props) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingTags, setPendingTags] = useState<string[] | null>(null)

  const displayDevice = pendingTags !== null ? { ...device, services: pendingTags } : device
  const { services: activeServices, isAuto } = resolveDeviceServices(displayDevice)
  const explicitTags = displayDevice.services ?? []

  async function commitTags(nextTags: string[]) {
    if (!onSave || saving) return
    setPendingTags(nextTags)
    setSaving(true)
    try {
      const updated = await onSave(nextTags)
      if (updated === null) {
        showToast(t('services.saveErrorToast'), 'error')
      } else {
        showToast(t('services.savedToast'), 'success')
      }
    } catch {
      showToast(t('services.saveErrorToast'), 'error')
    } finally {
      setPendingTags(null)
      setSaving(false)
    }
  }

  function handleTogglePreset(preset: string) {
    const base = isAuto ? [] : [...explicitTags]
    const existsIdx = base.findIndex(s => s.toLowerCase() === preset.toLowerCase())
    if (existsIdx >= 0) {
      base.splice(existsIdx, 1)
    } else {
      if (base.length >= 12) {
        showToast(t('services.limitToast'), 'info')
        return
      }
      base.push(preset)
    }
    void commitTags(base)
  }

  function handleAddCustom(e: React.FormEvent) {
    e.preventDefault()
    const tag = draft.trim()
    if (!tag) return
    const base = isAuto ? [...activeServices] : [...explicitTags]
    if (base.some(s => s.toLowerCase() === tag.toLowerCase())) {
      showToast(t('services.duplicateToast'), 'info')
      return
    }
    if (base.length >= 12) {
      showToast(t('services.limitToast'), 'info')
      return
    }
    setDraft('')
    void commitTags([...base, tag])
  }

  function handleRemoveTag(tagToRemove: string) {
    const base = (isAuto ? activeServices : explicitTags).filter(
      s => s.toLowerCase() !== tagToRemove.toLowerCase(),
    )
    void commitTags(base)
  }

  if (!editable) {
    return (
      <div className={styles.compactWrap}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <Layers size={14} />
            <span>{t('services.title')}</span>
            {isAuto && <span className={styles.autoBadge}>{t('services.autoBadge')}</span>}
          </div>
        </div>
        <div className={styles.activeTags}>
          {activeServices.map(svc => (
            <span key={svc} className={styles.tagPill}>
              {svc}
            </span>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.card} data-testid="service-tags-editor">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Layers size={14} />
          <span>{t('services.title')}</span>
          {isAuto && <span className={styles.autoBadge}>{t('services.autoBadge')}</span>}
        </div>
        {!isAuto && (
          <button
            type="button"
            className={styles.resetBtn}
            disabled={saving}
            onClick={() => void commitTags([])}
          >
            <RotateCcw size={12} />
            <span>{t('services.resetAuto')}</span>
          </button>
        )}
      </div>

      <div className={styles.hint}>
        {isAuto ? t('services.autoHint') : t('services.customHint')}
      </div>

      <div className={styles.activeTags}>
        {activeServices.map(svc => (
          <span key={svc} className={styles.tagPill} data-testid="active-service-tag">
            <span>{svc}</span>
            {!isAuto && (
              <button
                type="button"
                className={styles.tagRemoveBtn}
                disabled={saving}
                onClick={() => handleRemoveTag(svc)}
                aria-label={`Remove ${svc}`}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>

      <div className={styles.presetRow}>
        {PRESET_SERVICES.map(preset => {
          const isSelected = !isAuto && explicitTags.some(s => s.toLowerCase() === preset.toLowerCase())
          return (
            <button
              key={preset}
              type="button"
              disabled={saving}
              className={`${styles.presetBtn} ${isSelected ? styles.presetActive : ''}`}
              onClick={() => handleTogglePreset(preset)}
            >
              {preset}
            </button>
          )
        })}
      </div>

      <form className={styles.inputRow} onSubmit={handleAddCustom}>
        <input
          type="text"
          className={styles.input}
          value={draft}
          maxLength={40}
          placeholder={t('services.customPlaceholder')}
          aria-label={t('services.customPlaceholder')}
          disabled={saving}
          onChange={e => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className={styles.addBtn}
          disabled={saving || !draft.trim()}
        >
          <Plus size={13} />
          <span>{t('services.addBtn')}</span>
        </button>
      </form>
    </div>
  )
}
