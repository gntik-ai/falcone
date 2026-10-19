import { useTranslation } from 'react-i18next'
export default function LazyDestination() {
  const { t } = useTranslation('common')
  return <h1>{t('shell.fixtures.destination')}</h1>
}
