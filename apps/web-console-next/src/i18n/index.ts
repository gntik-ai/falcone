import i18n from 'i18next'
import ICU from 'i18next-icu'
import { initReactI18next } from 'react-i18next'
import es from '../locales/es/common.json'
import en from '../locales/en/common.json'

export type Locale = 'es' | 'en'
export const localeStorageKey = 'falcone-next-locale'
const supported = (value: unknown): value is Locale => value === 'es' || value === 'en'
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(localeStorageKey)
    return supported(stored) ? stored : 'es'
  } catch { return 'es' }
}

// Resources are bundled locally. There is deliberately no browser detector or HTTP backend.
void i18n.use(ICU).use(initReactI18next).init({
  lng: initialLocale(), supportedLngs: ['es', 'en'], fallbackLng: 'es',
  defaultNS: 'common', ns: ['common'], initImmediate: false,
  resources: { es: { common: es }, en: { common: en } },
  interpolation: { escapeValue: false }
})
document.documentElement.lang = i18n.language
i18n.on('languageChanged', (language) => {
  const locale = supported(language) ? language : 'es'
  document.documentElement.lang = locale
  try { localStorage.setItem(localeStorageKey, locale) } catch { /* Storage can be disabled. */ }
})

export function changeLocale(locale: Locale) { return i18n.changeLanguage(locale) }
export default i18n
