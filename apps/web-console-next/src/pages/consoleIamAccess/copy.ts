import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-iam-access-page.json'
import en from '../../locales/en/pages.console-iam-access-page.json'

i18n.addResourceBundle('es', 'pages.console-iam-access-page', es)
i18n.addResourceBundle('en', 'pages.console-iam-access-page', en)
export const useCopy = () => useTranslation('pages.console-iam-access-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
