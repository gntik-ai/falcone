import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { I18nProvider, Link, LiveAnnouncer, Page, ToastProvider } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { Applications } from './consoleAuth/Applications'
import { Realm } from './consoleAuth/Realm'
import { Wizard } from './consoleAuth/Wizard'
import { Action, Empty, Loading, LocalizedToaster, NAMESPACE, focusRing } from './consoleAuth/ui'
import './consoleAuth/page.css'

// Wizard state belongs to one workspace; it resets when the workspace changes.
function Actions({ workspaceId, workspaceLabel }: { workspaceId: string | null; workspaceLabel: string | null }) {
  const { t } = useTranslation(NAMESPACE)
  const [wizardOpen, setWizardOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <>
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <Action ref={trigger} variant="primary" onClick={() => setWizardOpen(true)}>{t('wizard.open')}</Action>
      <Link href="/console/members" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('openMembers')}</Link>
    </div>
    {wizardOpen && <Wizard workspaceId={workspaceId} workspaceLabel={workspaceLabel} returnFocusRef={trigger} onClose={() => setWizardOpen(false)} />}
  </>
}

// The realm sections depend on the realm only, so a workspace change keeps their data and the selected client.
// The wizard and the applications depend on the workspace and restart when it changes.
function Surface({ realmId, workspaceId, workspaceLabel }: { realmId: string; workspaceId: string | null; workspaceLabel: string | null }) {
  const scope = workspaceId ?? ''
  return <div className="min-w-0 space-y-6">
    <Actions key={scope} workspaceId={workspaceId} workspaceLabel={workspaceLabel} />
    <Realm realmId={realmId} workspaceId={workspaceId} workspaceLabel={workspaceLabel} />
    <Applications key={scope} workspaceId={workspaceId} />
  </div>
}

export default function ConsoleAuthPage() {
  const { t, i18n: language } = useTranslation(NAMESPACE)
  const context = useConsoleContext()
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId)
  const workspace = context.workspaces.find((item) => item.workspaceId === context.activeWorkspaceId)
  const realm = tenant?.identityContext?.consoleUserRealm
  const meta = tenant && realm ? [
    { label: t('meta.organization'), value: tenant.displayName, icon: undefined, mono: false },
    { label: t('meta.realm'), value: realm, icon: undefined, mono: true },
    { label: t('meta.workspace'), value: workspace?.displayName ?? t('meta.noWorkspace'), icon: undefined, mono: false },
  ] : []
  const body = context.loading ? <Loading label={t('loading')} />
    : !tenant ? <Empty title={t('empty.noTenant')} testId="console-section-empty" />
      : !realm ? <Empty title={t('empty.noRealm')} testId="console-section-empty" />
        : <Surface key={`${tenant.tenantId}|${realm}`} realmId={realm} workspaceId={workspace?.workspaceId ?? null} workspaceLabel={workspace?.displayName ?? null} />
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('wizard.close'), 'common.cancel': t('form.cancel'), 'error.retry': t('failure.retry') }}>
    <LiveAnnouncer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
      <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="console-auth-page"
        header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={meta} tabs={null} actions={[]}
          labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />}>
        {body}
      </Page>
      <LocalizedToaster />
    </ToastProvider></LiveAnnouncer>
  </I18nProvider>
}
