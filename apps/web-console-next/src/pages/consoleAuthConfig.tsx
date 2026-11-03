import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { I18nProvider, LiveAnnouncer, ToastProvider, Toaster } from '@gntik-ai/ui'
import i18n from '../i18n'
import es from '../locales/es/pages.console-auth-config-page.json'
import en from '../locales/en/pages.console-auth-config-page.json'
import { AuthConfigConsole } from './consoleAuthConfig/Console'

i18n.addResourceBundle('es', 'pages.console-auth-config-page', es)
i18n.addResourceBundle('en', 'pages.console-auth-config-page', en)

function LocalizedToaster() {
  const { t } = useTranslation('pages.console-auth-config-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Kit 0.11.0 exposes the close label but no toast viewport label prop.
    if (!container) return
    const translate = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('notifications')) viewport.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}

export default function ConsoleAuthConfigPage() {
  const { t, i18n: language } = useTranslation('pages.console-auth-config-page')
  // The kit builds its own copy from the locale; these keys cover text the page cannot pass as props.
  const messages = { 'actionBar.saving': t('saving'), 'common.cancel': t('cancel'), 'common.close': t('close') }
  return <I18nProvider locale={language.language} messages={messages}><LiveAnnouncer><ToastProvider timeout={5000} limit={3}>
    <AuthConfigConsole /><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
