import es from '../locales/es/settings.json'
import en from '../locales/en/settings.json'
import { placeholderPage } from './placeholder'

import { useTranslation } from 'react-i18next'
import { LocaleSwitch } from '../i18n/LocaleSwitch'
import { formatDate, formatNumber } from '../i18n/format'

const Placeholder = placeholderPage('settings', es, en)
export default function Settings() {
  const { t } = useTranslation('common')
  return <>
    <Placeholder />
    <LocaleSwitch />
    <dl className="mt-4">
      <dt>{t('format.number')}</dt><dd>{formatNumber(1234.5, { useGrouping: false })}</dd>
      <dt>{t('format.date')}</dt><dd>{formatDate(new Date('2026-01-02T12:00:00Z'), { dateStyle: 'long', timeZone: 'UTC' })}</dd>
    </dl>
  </>
}
