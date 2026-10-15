import { useTranslation } from 'react-i18next'
import i18n from '../i18n'

// Called only from lazy page modules: the two local resource imports stay in that chunk.
export function placeholderPage(namespace: string, es: Record<string, string>, en: Record<string, string>) {
  i18n.addResourceBundle('es', namespace, es)
  i18n.addResourceBundle('en', namespace, en)
  return function Placeholder() {
    const { t } = useTranslation(namespace)
    const { t: common } = useTranslation('common')
    return <section>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-2 text-muted-foreground">{common('placeholder.body')}</p>
    </section>
  }
}
