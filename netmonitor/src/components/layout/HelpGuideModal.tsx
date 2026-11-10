import { useTranslation } from 'react-i18next'
import Modal from '../ui/Modal'
import {
  Layers,
  Move,
  Activity,
  Search,
  Check,
  Lightbulb,
} from 'lucide-react'
import styles from './HelpGuideModal.module.css'

interface Props {
  open: boolean
  onClose: () => void
}

export default function HelpGuideModal({ open, onClose }: Props) {
  const { t } = useTranslation()

  if (!open) return null

  const steps = [
    {
      icon: <Layers size={16} />,
      title: t('guide.step1Title'),
      desc: t('guide.step1Desc'),
    },
    {
      icon: <Move size={16} />,
      title: t('guide.step2Title'),
      desc: t('guide.step2Desc'),
    },
    {
      icon: <Activity size={16} />,
      title: t('guide.step3Title'),
      desc: t('guide.step3Desc'),
    },
    {
      icon: <Search size={16} />,
      title: t('guide.step4Title'),
      desc: t('guide.step4Desc'),
    },
  ]

  return (
    <Modal
      open={open}
      title={t('guide.title')}
      onClose={onClose}
      width={640}
    >
      <div className={styles.panel}>
        <div className={styles.sub}>{t('guide.subtitle')}</div>

        <div className={styles.grid}>
          {steps.map((st, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIcon}>{st.icon}</span>
                <span className={styles.cardTitle}>{st.title}</span>
              </div>
              <div className={styles.cardDesc}>{st.desc}</div>
            </div>
          ))}
        </div>

        <div className={styles.shortcutsRow}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Lightbulb size={14} style={{ color: 'var(--accent-warning, #f59e0b)' }} />
            <span>{t('search.footerHint')}</span>
          </span>
          <div className={styles.kbdGroup}>
            <kbd className={styles.kbd}>Ctrl+K</kbd>
            <span>/</span>
            <kbd className={styles.kbd}>Esc</kbd>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.confirmBtn} onClick={onClose}>
            <Check size={14} />
            <span>{t('guide.closeBtn')}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
