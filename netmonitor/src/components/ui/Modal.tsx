import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import styles from './Modal.module.css'

// stack ของ modal ที่เปิดอยู่ — ให้ Escape ปิดเฉพาะอันบนสุด (รองรับ modal ซ้อน modal)
let modalSeq = 0
let modalStack: number[] = []

interface Props {
  open: boolean
  title: string
  header?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  closeOnBackdrop?: boolean
}

export default function Modal({
  open, title, header, onClose, children, footer,
  width = 420, closeOnBackdrop = true,
}: Props) {
  const { t } = useTranslation()
  const [modalId] = useState(() => ++modalSeq)

  // ลงทะเบียนเข้า stack ตอนเปิด
  useEffect(() => {
    if (!open) return
    modalStack.push(modalId)
    return () => {
      modalStack = modalStack.filter(id => id !== modalId)
    }
  }, [open, modalId])

  // ปิดด้วย Escape — เฉพาะ modal ที่อยู่บนสุด
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (modalStack[modalStack.length - 1] !== modalId) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, modalId])

  if (!open) return null

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={closeOnBackdrop
        ? e => { if (e.target === e.currentTarget) onClose() }
        : undefined}
    >
      <div
        className={styles.panel}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.header}>
          {header ?? <span className={styles.title}>{title}</span>}
          <button
            className={styles.close}
            onClick={onClose}
            aria-label={t('common.close')}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={18} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
