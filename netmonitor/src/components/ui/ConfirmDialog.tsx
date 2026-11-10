import { useTranslation } from 'react-i18next'
import Modal from './Modal'
import styles from './ConfirmDialog.module.css'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message,
  confirmLabel, cancelLabel,
  danger = false,
  onConfirm, onCancel,
}: Props) {
  const { t } = useTranslation()
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={380}
      footer={
        <>
          <button className={styles.btn} onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            className={`${styles.btn} ${danger ? styles.danger : styles.confirm}`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p className={styles.message}>{message}</p>
    </Modal>
  )
}
