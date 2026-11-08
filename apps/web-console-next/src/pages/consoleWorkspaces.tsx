import { Lock } from 'lucide-react'
import { useRef, useState } from 'react'
import { Badge, I18nProvider, Page, Section, ToastProvider, VisuallyHidden } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { focusRing, reasonKey, roleKey, useCopy } from './consoleWorkspaces/copy'
import { Action, Empty } from './consoleWorkspaces/ui'
import { Wizard } from './consoleWorkspaces/Wizard'
import { useQuota } from './consoleWorkspaces/useQuota'

function Workspaces({ tenantId, tenantLabel }: { tenantId: string | null; tenantLabel: string | null }) {
  const { t } = useCopy(), permissions = usePermissions(), quota = useQuota(tenantId)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  function close() { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()) }
  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="console-workspaces-page"
    header={<div className="flex min-w-0 flex-wrap items-start justify-between gap-4"><PageHeader className="min-w-0 basis-full sm:flex-1 sm:basis-auto" titleRef={undefined} tab="" defaultTab="" onTabChange={undefined} as="div" wrapTitle={true} title={t('title')} description={t('pageDescription')} breadcrumbs={[]} status="workspaces" statuses={{ workspaces: { label: t('badge'), tone: 'neutral' } }} meta={[{ label: t('activeTenant'), value: tenantLabel ?? t('noTenantSelected'), icon: undefined, mono: false }]} tabs={null}
      actions={[]} labels={{ title: t('title'), description: t('pageDescription'), moreActions: t('actions'), sections: t('actions') }} /><div className="max-w-full">{permissions.can('tenant.workspaces.create') ? <Action ref={trigger} variant="primary" onClick={() => setOpen(true)}>{t('create')}</Action> : <Badge tone="warning" variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className={`max-w-full whitespace-normal text-left ${focusRing}`} tabIndex={0} title={t(reasonKey(permissions.roles))} data-testid="workspaces-read-only-indicator"><Lock size={14} aria-hidden={true} className="shrink-0" />{t('readOnly', { role: t(`roleLabels.${roleKey(permissions.roles)}`) })}<VisuallyHidden>{' '}{t(reasonKey(permissions.roles))}</VisuallyHidden></Badge>}</div></div>}>
    <Section variant="plain" padding="none" divided={false} headingLevel="h2" bodyClassName="min-w-0" title={t('inventory')} description={t('inventoryDescription')} actions={null} className="min-w-0 space-y-3">{!tenantId && <Empty title={t('noTenant')} description={t('tenantRequired')} />}</Section>
    {open && <Wizard tenantId={tenantId} quota={quota} onClose={close} returnFocusRef={trigger} />}
  </Page>
}
export default function ConsoleWorkspacesPage() {
  const { t, i18n } = useCopy(), context = useConsoleContext()
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId)
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel') }}><ToastProvider timeout={5000} limit={3}><Workspaces key={context.activeTenantId ?? ''} tenantId={context.activeTenantId} tenantLabel={tenant?.displayName ?? context.activeTenantId} /></ToastProvider></I18nProvider>
}
