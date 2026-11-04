import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from '@gntik-ai/ui'

// Kit 0.11.0 exposes the close label but no toast viewport label prop, so the region is named after it renders.
export function LocalizedToaster() {
  const { t } = useTranslation('pages.console-plan-detail-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    const translate = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('success.notifications')) viewport.setAttribute('aria-label', t('success.notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('success.closeToast')} container={container} className="" />}</>
}
