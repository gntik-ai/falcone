import { useLayoutEffect, useState } from 'react'
import { I18nProvider, LiveAnnouncer, ToastProvider, Toaster, useToast } from '@gntik-ai/ui'
import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

function SignupToaster() {
  const { t } = useTranslation('pages.signup-page')
  const { toasts } = useToast()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    // The pinned kit exposes a close label but no viewport label prop.
    const translate = () => container.querySelector('[role="region"]')?.setAttribute('aria-label', t('notifications'))
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && toasts.length > 0 ? <Toaster closeLabel={t('closeToast')} container={container} className="" /> : null}</>
}

// Keep result notifications mounted across the pending-activation replacement navigation.
// Catalogs remain registered by the lazy signup page, outside the eager entry graph.
export function SignupFeedbackLayout() {
  const { i18n } = useTranslation('common')
  return <I18nProvider locale={i18n.language}><LiveAnnouncer className="sr-only"><ToastProvider timeout={5000} limit={3}>
    <Outlet /><SignupToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
