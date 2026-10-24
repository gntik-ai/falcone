import { useTranslation } from 'react-i18next'
import { loadLocale, useLocaleLoader } from './locale-loader'

export function LocaleSwitch() {
  const { t, i18n } = useTranslation('common')
  const { pending } = useLocaleLoader()
  return <label className="flex items-center gap-2">
    {t('locale.label')}
    <select disabled={pending} aria-busy={pending} value={i18n.language} onChange={(event) => {
      if (event.target.value === 'es' || event.target.value === 'en') void loadLocale(event.target.value)
    }}>
      <option value="es">{t('locale.es')}</option>
      <option value="en">{t('locale.en')}</option>
    </select>
  </label>
}
