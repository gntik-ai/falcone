import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, I18nProvider, LiveAnnouncer, Page, ToastProvider, Toaster } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import i18n from '../i18n'
import es from '../locales/es/pages.console-service-accounts-page.json'
import en from '../locales/en/pages.console-service-accounts-page.json'
import { useConsoleContext } from '../shell/context'
import { Content } from './consoleServiceAccounts/Content'
import { Gate } from './consoleServiceAccounts/Gate'
import './consoleServiceAccounts/page.css'

i18n.addResourceBundle('es', 'pages.console-service-accounts-page', es)
i18n.addResourceBundle('en', 'pages.console-service-accounts-page', en)

function LocalizedToaster() {
  const { t } = useTranslation('pages.console-service-accounts-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Kit 0.11.0 exposes closeLabel but no viewport label prop.
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

// Everything bound to a tenant and workspace lives under a keyed subtree: a switch drops open
// confirmations, disclosures, failures, typed names, toasts and in-flight results in one step.
function Surface({ switched }: { switched: boolean }) {
  const { t } = useTranslation('pages.console-service-accounts-page')
  const context = useConsoleContext()
  const heading = useRef<HTMLHeadingElement>(null)
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId)
  const workspace = context.workspaces.find((item) => item.workspaceId === context.activeWorkspaceId)
  const contextLine = [tenant?.displayName, workspace?.displayName].filter(Boolean).join(' · ') || t('contextFallback')
  return <LiveAnnouncer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-4 wrap-anywhere" data-testid="console-service-accounts-page"
      header={<div className="min-w-0 space-y-2">
        <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('eyebrow')}</Badge>
        <PageHeader as="div" wrapTitle={true} titleRef={heading} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={[{ label: t('states.workspaceLabel'), value: contextLine }]} tabs={null} actions={[]}
          labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />
      </div>}>
      {context.activeWorkspaceId
        ? <Content workspaceId={context.activeWorkspaceId} tenantActive={tenant?.state === 'active'} heading={heading} focusHeading={switched} onChooseWorkspace={() => context.selectWorkspace(null)} />
        : <Gate focusHeading={switched} />}
    </Page><LocalizedToaster />
  </ToastProvider></LiveAnnouncer>
}

export default function ConsoleServiceAccountsPage() {
  const { t, i18n: language } = useTranslation('pages.console-service-accounts-page')
  const context = useConsoleContext()
  const key = `${context.activeTenantId ?? ''}|${context.activeWorkspaceId ?? ''}`
  const previous = useRef({ tenant: context.activeTenantId, key })
  const switched = useRef(false)
  // Loading the first context is not a switch; leaving a selected tenant or workspace is.
  if (previous.current.key !== key) { switched.current = previous.current.tenant !== null; previous.current = { tenant: context.activeTenantId, key } }
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('confirm.close'), 'common.cancel': t('confirm.cancel'), 'error.retry': t('failure.retry') }}>
    <Surface key={key} switched={switched.current} />
  </I18nProvider>
}
