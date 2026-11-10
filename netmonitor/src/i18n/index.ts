import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import th from './th'
import en from './en'

const STORAGE_KEY = 'netmonitor:settings'

// อ่านภาษาจาก settings ที่บันทึกไว้ (SettingsProvider จะ sync ค่าเดียวกันตอน mount)
function initialLanguage(): 'th' | 'en' {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { language?: string }
      if (parsed.language === 'en' || parsed.language === 'th') return parsed.language
    }
  } catch {
    // localStorage ใช้ไม่ได้ → ใช้ค่าเริ่มต้น
  }
  return 'th'
}

void i18next.use(initReactI18next).init({
  resources: {
    th: { translation: th },
    en: { translation: en },
  },
  lng: initialLanguage(),
  fallbackLng: 'th',
  interpolation: { escapeValue: false },
})

export default i18next
