import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device, DeviceType } from '../../types'
import { AlertTriangle, Radio } from 'lucide-react'
import Modal from '../ui/Modal'
import styles from './AddDeviceModal.module.css'

interface Props {
  open: boolean
  defaultFloor?: 1 | 2
  existingDevices: Device[]
  onClose: () => void
  onAdd: (device: Omit<Device, 'id' | 'x' | 'y'>) => Promise<Device>
}

const DEVICE_TYPES: DeviceType[] = ['switch', 'router', 'ap', 'server']

export default function AddDeviceModal({
  open,
  defaultFloor = 1,
  existingDevices,
  onClose,
  onAdd,
}: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [dtype, setDtype] = useState<DeviceType>('switch')
  const [floor, setFloor] = useState<1 | 2>(defaultFloor)
  const [ip, setIp] = useState('')
  const [model, setModel] = useState('')
  const [latitude, setLatitude] = useState<number | undefined>(undefined)
  const [longitude, setLongitude] = useState<number | undefined>(undefined)
  const [locatingGps, setLocatingGps] = useState(false)
  const [gpsStatusText, setGpsStatusText] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSubmit = name.trim().length > 0 && !saving

  function handleGetBrowserGps() {
    if (!navigator.geolocation) {
      setGpsStatusText(t('floor.geoNotSupported'))
      return
    }
    setLocatingGps(true)
    setGpsStatusText(null)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6))
        const lon = parseFloat(pos.coords.longitude.toFixed(6))
        setLatitude(lat)
        setLongitude(lon)
        setLocatingGps(false)
        setGpsStatusText(t('gps.fetchSuccess', { lat, lon, acc: Math.round(pos.coords.accuracy) }))
      },
      err => {
        setLocatingGps(false)
        setGpsStatusText(t('floor.geoError', { message: err.message }))
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    const trimmedName = name.trim()
    const isDuplicate = existingDevices.some(
      d => d.name.toLowerCase() === trimmedName.toLowerCase(),
    )
    if (isDuplicate) {
      setErrorMsg(t('addDevice.nameExists'))
      return
    }

    setSaving(true)
    setErrorMsg(null)
    try {
      await onAdd({
        name: trimmedName,
        dtype,
        floor,
        status: 'offline',
        ip: ip.trim() || undefined,
        model: model.trim() || undefined,
        latitude,
        longitude,
      })
      onClose()
    } catch {
      setErrorMsg(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title={t('addDevice.title')} onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="add-name">
            {t('addDevice.nameLabel')} <span className={styles.req}>*</span>
          </label>
          <input
            id="add-name"
            className={styles.input}
            value={name}
            onChange={e => { setName(e.target.value); setErrorMsg(null) }}
            placeholder="SW-CORE-02"
            autoFocus
          />
        </div>

        {errorMsg && (
          <div className={styles.note} style={{ borderColor: '#ef4444', color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="add-dtype">{t('addDevice.typeLabel')}</label>
            <select
              id="add-dtype"
              className={styles.select}
              value={dtype}
              onChange={e => setDtype(e.target.value as DeviceType)}
            >
              {DEVICE_TYPES.map(type => (
                <option key={type} value={type}>
                  {t(`deviceType.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="add-floor">{t('addDevice.floorLabel')}</label>
            <select
              id="add-floor"
              className={styles.select}
              value={floor}
              onChange={e => setFloor(Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>{t('search.floor', { floor: 1 })}</option>
              <option value={2}>{t('search.floor', { floor: 2 })}</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className={styles.field}>
            <label className={styles.label}>{t('addDevice.statusLabel')}</label>
            <div style={{
              padding: '9px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 6,
              color: '#f87171',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 38,
              boxSizing: 'border-box'
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
              <span>{t('addDevice.statusOfflineNotice')}</span>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="add-ip">{t('addDevice.ipLabel')}</label>
            <input
              id="add-ip"
              className={styles.input}
              value={ip}
              onChange={e => setIp(e.target.value)}
              placeholder="10.0.0.50"
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="add-model">{t('addDevice.modelLabel')}</label>
          <input
            id="add-model"
            className={styles.input}
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="Cisco Catalyst 9300-48P"
          />
        </div>

        {/* GPS Geolocation Coordinates Section */}
        <div style={{
          padding: '10px 12px',
          background: 'rgba(56, 189, 248, 0.05)',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          borderRadius: 8,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Radio size={14} />
              <span>{t('gps.title')}</span>
            </span>
            <button
              type="button"
              onClick={handleGetBrowserGps}
              disabled={locatingGps}
              style={{
                fontSize: 12,
                padding: '3px 8px',
                background: 'rgba(56, 189, 248, 0.2)',
                border: '1px solid #38bdf8',
                borderRadius: 4,
                color: '#38bdf8',
                cursor: 'pointer',
              }}
            >
              {locatingGps ? t('gps.locating') : t('gps.fetchFromDevice')}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 2 }}>{t('gps.latitude')}</label>
              <input
                className={styles.input}
                type="number"
                step="any"
                value={latitude ?? ''}
                onChange={e => setLatitude(e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder={t('gps.latPlaceholder')}
                style={{ fontSize: 12, padding: '5px 8px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 2 }}>{t('gps.longitude')}</label>
              <input
                className={styles.input}
                type="number"
                step="any"
                value={longitude ?? ''}
                onChange={e => setLongitude(e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder={t('gps.lonPlaceholder')}
                style={{ fontSize: 12, padding: '5px 8px' }}
              />
            </div>
          </div>
          {gpsStatusText && (
            <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 6 }}>
              {gpsStatusText}
            </div>
          )}
        </div>

        <div className={styles.note}>
          {t('addDevice.autoPlaceHint')}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={!canSubmit}>
            {saving ? t('common.loading') : t('addDevice.submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
