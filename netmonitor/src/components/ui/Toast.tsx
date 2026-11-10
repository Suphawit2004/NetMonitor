import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Info, AlertTriangle, AlertCircle, X } from 'lucide-react'
import { ToastContext, type ToastItem, type ToastVariant } from './toast-context'
import styles from './Toast.module.css'

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <Check size={16} />,
  info:    <Info size={16} />,
  warn:    <AlertTriangle size={16} />,
  error:   <AlertCircle size={16} />,
}

const AUTO_DISMISS_MS = 3500

export default function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    idRef.current += 1
    const id = idRef.current
    setToasts(prev => [...prev, { id, message, variant }])
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      <div className={styles.stack} aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.variant]}`} role="status">
            <span className={styles.icon} aria-hidden="true">{ICONS[toast.variant]}</span>
            <span className={styles.message}>{toast.message}</span>
            <button
              className={styles.close}
              onClick={() => dismiss(toast.id)}
              aria-label={t('common.dismiss')}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
