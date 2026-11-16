import { useEffect, useLayoutEffect, useState } from 'react'
import { Rocket } from 'lucide-react'
import { Link as RouterLink } from 'react-router-dom'
import { Badge, EmptyState, Field, FieldLabel, I18nProvider, Link, LiveAnnouncer, Page, SimpleSelect, Text, ToastProvider, Toaster, useAnnounce, useToast } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, PageHeader, TableSkeleton } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { Detail } from './consoleFunctions/Detail'
import { Inventory, INVENTORY_TITLE_ID } from './consoleFunctions/Inventory'
import { focusRing, useCopy } from './consoleFunctions/copy'
import { useFunctions, type Notice } from './consoleFunctions/useFunctions'
import './consoleFunctions/page.css'

function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    // The pinned kit exposes a close label but no viewport label prop.
    const translate = () => {
      const region = container.querySelector('[role="region"]')
      if (region && region.getAttribute('aria-label') !== t('notifications')) region.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}

function Header({ onDeploy }: { onDeploy: (() => void) | null }) {
  const { t } = useCopy()
  const description = <span className="block space-y-2">
    <span className="block">{t('description')}</span>
    <span className="block">{t('quickPrefix')}{' '}<Link render={<RouterLink to="/console/functions/data" />} tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('quickLink')}</Link>{t('sentenceEnd')}</span>
  </span>
  return <PageHeader as="div" wrapTitle={true} titleRef={undefined} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={description} breadcrumbs={[]} status="" statuses={{}} tabs={null}
    meta={[{ label: '', value: <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('badge')}</Badge> }]}
    actions={onDeploy ? [{ id: 'deploy', label: t('deploy'), icon: Rocket as never, variant: 'primary', disabled: false, onClick: onDeploy }] : []}
    labels={{ title: t('title'), description: t('description'), moreActions: t('title'), sections: t('title') }} />
}

function Console({ tenantId, workspaceId }: { tenantId: string; workspaceId: string }) {
  const { t } = useCopy()
  const announce = useAnnounce()
  const toast = useToast()
  const notify = (notice: Notice) => {
    const message = t(notice.kind === 'deleted' ? 'deleted.message' : notice.kind === 'invoked' ? 'toast.invoked' : notice.kind === 'rolledBack' ? 'toast.rolledBack' : 'toast.deployed', { name: notice.name })
    announce(message, 'polite')
    toast.add({ title: message, tone: 'success', priority: 'low' })
  }
  const s = useFunctions({ tenantId, workspaceId, notify })
  // After a delete the selection is gone, so focus goes to the inventory.
  useEffect(() => { if (s.notice?.kind === 'deleted') document.getElementById(INVENTORY_TITLE_ID)?.focus() }, [s.notice])
  const notice = s.notice
  return <>
    <Header onDeploy={s.openCreate} />
    {notice && <div role="status" data-testid="functions-notice" className="min-w-0">
      <InlineCallout tone="success" title={t(notice.kind === 'deleted' ? 'deleted.title' : 'form.acceptedTitle')} labels={{ title: t(notice.kind === 'deleted' ? 'deleted.title' : 'form.acceptedTitle') }}
        description={notice.kind === 'deleted' ? t('deleted.message', { name: notice.name }) : t('form.resource', { id: notice.name })} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" />
    </div>}
    <section aria-label={t('title')} className="grid min-w-0 gap-6 xl:grid-cols-5 xl:items-start" data-testid="functions-console">
      <div className="min-w-0 xl:col-span-2"><Inventory s={s} /></div>
      <div className="min-w-0 xl:col-span-3"><Detail s={s} /></div>
    </section>
  </>
}

// Port of the legacy WorkspaceRequiredState: loading, error with a retry, the picker, or the create link.
function WorkspaceGate() {
  const { t } = useCopy()
  const context = useConsoleContext()
  const { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (context.loading) return <section role="status" aria-label={t('gate.loading')}><Text as="p" variant="body" tone="default">{t('gate.loading')}</Text><div aria-hidden={true}><TableSkeleton rows={2} columns={1} label={t('gate.loadingDescription')} className="min-w-0" /></div></section>
  if (context.error) return <ErrorPanel title={t('gate.error')} message={t('gate.errorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} onRetry={() => { void context.reloadWorkspaces?.() }} className="min-w-0"
    labels={{ title: t('gate.error'), message: t('gate.errorDescription'), support: t('errorPanel.support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('errorPanel.requestId'), copyRequestId: t('errorPanel.copyRequestId'), copied: t('errorPanel.copied'), requestIdCopied: t('errorPanel.copied'), details: t('errorPanel.details') }} />
  return <EmptyState icon={undefined} title={t('gate.title')} description={t('gate.description')} titleAs="h2" bordered={false} size="md" secondaryAction={null} className="min-w-0" primaryAction={context.workspaces.length
    ? <Field invalid={false} disabled={false} className="w-full min-w-0"><FieldLabel htmlFor="functions-workspace">{t('gate.label')}</FieldLabel>
      <SimpleSelect id="functions-workspace" value={workspace} defaultValue="" placeholder={t('gate.placeholder')} clearable={false} size="md" className="w-full min-w-0" items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create')
      ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('gate.create')}</Link>
      : <Text as="p" variant="body" tone="muted">{t('gate.denied')}</Text>} />
}

export default function ConsoleFunctionsPage() {
  const { t, i18n: language } = useCopy()
  const context = useConsoleContext()
  let body
  // The shell sets the tenant only after its workspace load succeeds, so loading and failure take precedence over the blocked state.
  if (context.activeTenantId && context.activeWorkspaceId) body = <Console key={context.activeWorkspaceId} tenantId={context.activeTenantId} workspaceId={context.activeWorkspaceId} />
  else if (context.loading || context.error || context.activeTenantId) body = <><Header onDeploy={null} /><WorkspaceGate /></>
  else body = <><Header onDeploy={null} /><EmptyState icon={undefined} role="status" title={t('gate.orgRequired')} description={null} titleAs="h2" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" /></>
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('closeToast'), 'common.cancel': t('delete.cancel'), 'actionBar.saving': t('form.saving') }}><LiveAnnouncer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('title')} className="console-functions min-w-0 space-y-6 wrap-anywhere" data-testid="console-functions-page" header={null}>
      {body}
    </Page><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
