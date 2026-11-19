import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-mongo-page.json'
import en from '../../locales/en/pages.console-mongo-page.json'
i18n.addResourceBundle('es', 'pages.console-mongo-page', es)
i18n.addResourceBundle('en', 'pages.console-mongo-page', en)
export const useCopy = () => useTranslation('pages.console-mongo-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
