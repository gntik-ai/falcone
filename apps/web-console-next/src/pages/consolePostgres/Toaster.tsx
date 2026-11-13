import { useLayoutEffect, useState } from 'react'
import { Toaster } from '@gntik-ai/ui'
import { useCopy } from './copy'

export function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    const syncAccessibility = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('notifications')) viewport.setAttribute('aria-label', t('notifications'))
      // The pinned kit also hides collapsed toast close buttons while leaving
      // them tabbable. Keep those controls exposed without touching the modal's
      // background hiding or decorative icons.
      viewport?.querySelectorAll('button[aria-hidden="true"]').forEach((button) => button.setAttribute('aria-hidden', 'false'))
    }
    syncAccessibility()
    const observer = new MutationObserver(syncAccessibility)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-hidden'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}
