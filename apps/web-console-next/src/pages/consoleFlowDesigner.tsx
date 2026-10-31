import { useLayoutEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { I18nProvider, LiveAnnouncer, ToastProvider, Toaster } from '@gntik-ai/ui'
import { useParams } from 'react-router-dom'
import { useConsoleContext } from '../shell/context'
import i18n from '../i18n'
import es from '../locales/es/pages.console-flow-designer-page.json'
import en from '../locales/en/pages.console-flow-designer-page.json'
import { DesignerSurface } from './consoleFlowDesigner/Designer'
import { WorkspaceGate } from './consoleFlowDesigner/chrome'
import { useCopy } from './consoleFlowDesigner/copy'

i18n.addResourceBundle('es', 'pages.console-flow-designer-page', es)
i18n.addResourceBundle('en', 'pages.console-flow-designer-page', en)

function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Kit 0.11.0 has no prop for the toast viewport's accessible name.
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

export default function ConsoleFlowDesignerPage() {
  const { t, i18n: language } = useCopy()
  const { flowId } = useParams()
  const { activeWorkspaceId } = useConsoleContext()
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={5000} limit={3}>
    {!flowId ? <section><h1 className="text-lg font-semibold">{t('title')}</h1><WorkspaceGate missingFlow={true} /></section> : !activeWorkspaceId ? <section><h1 className="text-lg font-semibold">{t('title')}</h1><WorkspaceGate missingFlow={false} /></section> : <ReactFlowProvider key={`${activeWorkspaceId}:${flowId}`}><DesignerSurface workspaceId={activeWorkspaceId} flowId={flowId} /></ReactFlowProvider>}
    <LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
