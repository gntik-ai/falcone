import { useTranslation } from 'react-i18next'
import { changeLocale } from './index'

export function LocaleSwitch() {
  const { t, i18n } = useTranslation('common')
  return <label className="flex items-center gap-2">
    {t('locale.label')}
    <select value={i18n.language} onChange={(event) => {
      if (event.target.value === 'es' || event.target.value === 'en') void changeLocale(event.target.value)
    }}>
      <option value="es">{t('locale.es')}</option>
      <option value="en">{t('locale.en')}</option>
    </select>
  </label>
}
