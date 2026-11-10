import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Device } from '../../types'
import { DEVICE_ICON } from '../../constants/deviceMeta'
import { Lock, Unlock, Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import styles from './DevicePin.module.css'

export type PopupPlacement = 'above' | 'below' | 'left' | 'right'

interface Props {
  device: Device
  isDragging: boolean
  isPopupOpen: boolean                              // ← ควบคุมจากภายนอก
  isFading: boolean                                 // ← กำลังจางหาย (ก่อนปิด)
  popupPlacement?: PopupPlacement                   // ← ทิศทาง popup (default: 'above')
  onPinMouseDown: (device: Device, e: React.MouseEvent) => void
  onHoverStart: (device: Device) => void            // ← เมาส์เข้า pin → เปิด popup
  onHoverEnd: () => void                            // ← เมาส์ออก → เริ่มนับเวลาปิด
  onToggleLock: (id: string) => void
  onDeviceInfo?: (device: Device) => void
}

function DevicePin({
  device, isDragging, isPopupOpen, isFading,
  popupPlacement = 'above',
  onPinMouseDown, onHoverStart, onHoverEnd, onToggleLock, onDeviceInfo,
}: Props) {
  const { t } = useTranslation()
  const isLocked = !!device.locked
  const cleanName = device.name.replace(/^["']+|["']+$/g, '').trim()

  return (
    <div
      className={[
        styles.device,
        isDragging  ? styles.dragging : '',
        isLocked    ? styles.locked   : '',
        isPopupOpen ? styles.popupOpen : '',
      ].filter(Boolean).join(' ')}
      style={{ left: device.x, top: device.y }}
      onMouseDown={e => onPinMouseDown(device, e)}
      onMouseEnter={() => onHoverStart(device)}
      onMouseLeave={() => onHoverEnd()}
      role="button"
      aria-label={`${cleanName} – ${t(`status.${device.status}`)}${isLocked ? ` (${t('pin.locked')})` : ''}`}
      aria-expanded={isPopupOpen}
    >
      {/* ── Pin rounded-box (matching Image 3) ── */}
      <div className={`${styles.pin} ${styles[device.status]}`}>
        <span className={styles.pinIcon} aria-hidden="true">{DEVICE_ICON[device.dtype]}</span>
        {!isLocked && (
          <span className={`${styles.dot} ${styles[`dot_${device.status}`]}`} aria-hidden="true" />
        )}
        {isLocked && (
          <span className={styles.lockBadge} aria-hidden="true">
            <Lock size={10} className={styles.lockIcon} />
          </span>
        )}
      </div>

      {/* ── Name label ── */}
      <div className={styles.name} title={cleanName}>{cleanName}</div>

      {/* ── Popup (hover-to-open, state-controlled) ── */}
      {isPopupOpen && !isDragging && (
        <div
          className={[
            styles.popup,
            styles[`popup_${popupPlacement}`],
            isFading ? styles.popupFading : '',
          ].filter(Boolean).join(' ')}
          // หยุด mousedown ไม่ให้ลาม → ป้องกัน drag หรือปิด popup โดย canvas
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className={styles.popupHeader}>
            <span className={styles.popupName}>{cleanName}</span>
            <span className={`${styles.popupStatus} ${styles[`s_${device.status}`]}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {device.status === 'online' ? (
                <CheckCircle2 size={11} />
              ) : device.status === 'warning' ? (
                <AlertTriangle size={11} />
              ) : (
                <XCircle size={11} />
              )}
              <span>{t(`status.${device.status}`)}</span>
            </span>
          </div>

          <div className={styles.popupBody}>
            <div className={styles.popupRow}>
              <span className={styles.popupKey}>{t('pin.type')}</span>
              <span className={styles.popupVal}>{t(`deviceType.${device.dtype}`)}</span>
            </div>
            {device.ip && (
              <div className={styles.popupRow}>
                <span className={styles.popupKey}>IP</span>
                <span className={styles.popupVal}>{device.ip}</span>
              </div>
            )}
            {device.model && (
              <div className={styles.popupRow}>
                <span className={styles.popupKey}>{t('pin.model')}</span>
                <span className={styles.popupVal}>{device.model}</span>
              </div>
            )}
          </div>

          <div className={styles.popupActions}>
            {onDeviceInfo && (
              <button
                className={styles.btnDetail}
                onClick={e => {
                  e.stopPropagation()
                  onDeviceInfo(device)
                }}
              >
                <Info size={13} />
                <span>{t('floor.viewDeviceInfo')}</span>
              </button>
            )}
            {/* ล็อค / ปลดล็อค */}
            <button
              className={`${styles.btnLock} ${isLocked ? styles.btnLockActive : ''}`}
              onClick={e => { e.stopPropagation(); onToggleLock(device.id) }}
            >
              {isLocked ? <Unlock size={13} /> : <Lock size={13} />}
              <span>{isLocked ? t('pin.unlock') : t('pin.lock')}</span>
            </button>
          </div>

          {/* Arrow */}
          <div className={[styles.popupArrow, styles[`arrow_${popupPlacement}`]].join(' ')} />
        </div>
      )}
    </div>
  )
}

export default memo(DevicePin)
