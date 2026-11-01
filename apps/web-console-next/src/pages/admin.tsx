import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import es from '../locales/es/admin.json'
import en from '../locales/en/admin.json'

i18n.addResourceBundle('es', 'admin', es)
i18n.addResourceBundle('en', 'admin', en)

export default function AdminPage() {
  const { t } = useTranslation('admin')
  return <section>
    <h1 className="text-2xl font-semibold">{t('title')}</h1>
    <p className="mt-2 text-muted-foreground">{t('description')}</p>
    <p className="mt-4"><Link className="underline" to="/console">{t('backToConsole')}</Link></p>
  </section>
}
