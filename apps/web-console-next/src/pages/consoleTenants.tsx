import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, I18nProvider, Link, LiveAnnouncer, Page, StatusTag, Text, Toaster, ToastProvider, useAnnounce } from '@gntik-ai/ui'
import { DataTable, FirstRunEmpty, NoAccessEmpty, PageHeader, PageToolbar, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { Tenant } from '@in-falcone/console-api/clients'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { useConsoleContext } from '../shell/context'
import { useSession } from '../shell/session'
import i18n from '../i18n'
import es from '../locales/es/pages.console-tenants-page.json'
import en from '../locales/en/pages.console-tenants-page.json'
import { checkPlatformQuotas, failureOf, type Failure } from './consoleTenants/api'
import { Feedback } from './consoleTenants/Feedback'
import { Wizard } from './consoleTenants/Wizard'
import './consoleTenants/page.css'

i18n.addResourceBundle('es', 'pages.console-tenants-page', es)
i18n.addResourceBundle('en', 'pages.console-tenants-page', en)

function tenantStatus(tenant: Tenant) {
  const governance = tenant.governance?.governanceStatus ?? tenant.quotaProfile?.governanceStatus
  if (tenant.state === 'suspended' || tenant.state === 'deleted') return { key: tenant.state, tone: 'destructive' as const }
  if (governance && ['suspended', 'retention', 'purge_pending'].includes(governance)) return { key: governance, tone: 'destructive' as const }
  if (tenant.state === 'pending_activation') return { key: 'pending_activation', tone: 'warning' as const }
  const quotas = tenant.quotaProfile?.limits ?? []
  const exhausted = quotas.some((limit) => limit.remaining <= 0 || (limit.limit > 0 && limit.used >= limit.limit))
  if (exhausted) return { key: 'blocked', tone: 'destructive' as const }
  if (governance === 'warning' || quotas.some((limit) => typeof limit.limit === 'number' && limit.limit > 0 && typeof limit.used === 'number' && limit.used / limit.limit >= .8) || ['pending', 'in_progress', 'partially_failed'].includes(tenant.provisioning?.status ?? '')) return { key: governance === 'warning' ? 'warning' : 'attention', tone: 'warning' as const }
  return { key: 'operational', tone: 'success' as const }
}
function TenantInventory() {
  const { t } = useTranslation('pages.console-tenants-page')
  const context = useConsoleContext()
  const roles = useSession()?.principal?.platformRoles ?? []
  const inventory = roles.some((role) => ['superadmin', 'platform_admin', 'platform_operator'].includes(role))
  const superadmin = roles.includes('superadmin')
  const permissions = getConsolePermissions(roles)
  const allowed = permissions.can('tenant.create')
  const blockedReason = !permissions.isReadOnly ? 'blockedGeneric' : roles.includes('tenant_developer') ? 'blockedDeveloper' : roles.includes('tenant_viewer') ? 'blockedViewer' : 'blockedUnknown'
  const announce = useAnnounce()
  const [wizard, setWizard] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const table = useRef<HTMLDivElement>(null)
  const [precheck, setPrecheck] = useState<Failure | null>(null)
  const [checkAttempt, setCheckAttempt] = useState(0)
  const checkRequest = useRef<{ attempt: number; promise: ReturnType<typeof checkPlatformQuotas> } | null>(null)
  const truncated = Boolean(context.tenantsPageInfo?.after)
  // Shell loading also covers workspace resolution; keep a resolved inventory mounted.
  const inventoryLoading = context.loading && context.tenantsPageInfo == null && !context.tenantsError && context.tenants.length === 0
  useEffect(() => {
    let cancelled = false
    setPrecheck(null)
    if (checkRequest.current?.attempt !== checkAttempt) checkRequest.current = { attempt: checkAttempt, promise: checkPlatformQuotas() }
    void checkRequest.current.promise.catch((cause) => { if (!cancelled) setPrecheck(failureOf(cause)) })
    return () => { cancelled = true }
  }, [checkAttempt])
  useEffect(() => {
    // The pinned DataTable has no row-header/current-row props. Add semantics to its real cells.
    table.current?.querySelectorAll('tbody tr').forEach((row, index) => {
      row.firstElementChild?.setAttribute('role', 'rowheader')
      if (context.tenants[index]?.tenantId === context.activeTenantId) row.setAttribute('aria-current', 'true')
      else row.removeAttribute('aria-current')
    })
  }, [context.tenants, context.activeTenantId, inventoryLoading])
  function activate(tenant: Tenant) {
    context.selectTenant(tenant.tenantId)
    announce(t('activated', { name: tenant.displayName || tenant.slug || tenant.tenantId }), 'polite')
  }
  const columns: DataTableColumn<Tenant>[] = [
    { id: 'name', header: t('organization'), sortable: false, cell: (tenant) => <span className="inline-flex flex-wrap items-center gap-2">{tenant.displayName || tenant.slug || tenant.tenantId}{tenant.tenantId === context.activeTenantId && <Badge variant="soft">{t('active')}</Badge>}</span> },
    { id: 'slug', header: t('slug'), sortable: false, variant: 'mono', accessor: (tenant) => tenant.slug || tenant.tenantId },
    { id: 'status', header: t('statusLabel'), sortable: false, cell: (tenant) => { const status = tenantStatus(tenant); return <StatusTag status={status.key} label={t(`status.${status.key}`)} statuses={{ [status.key]: { label: t(`status.${status.key}`), tone: status.tone } }} uppercase={false} /> } },
    { id: 'action', header: t('action'), sortable: false, align: 'right', cell: (tenant) => superadmin ? <Link href={`/console/tenants/${tenant.tenantId}/plan`} underline="always" external={false} externalLabel=""
      aria-label={t('openPlanName', { name: tenant.displayName })} onClick={() => activate(tenant)}>{t('openPlan')}</Link>
      : <Button type="button" variant="secondary" size="sm" disabled={tenant.tenantId === context.activeTenantId} onClick={() => activate(tenant)} aria-label={t(tenant.tenantId === context.activeTenantId ? 'alreadyActive' : 'useActiveName', { name: tenant.displayName })}>{t('useActive')}</Button> },
  ]
  const reload = () => { void context.reloadTenants?.() }
  const error = context.tenantsError ? { ...context.tenantsError, requestId: context.tenantsRequestId ?? '' } : null
  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('action')} className="console-tenants min-w-0 space-y-4 wrap-anywhere"
    header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={null} status="" statuses={{}} meta={[{ label: '', value: <Badge variant="outline">{t('governance')}</Badge> }]} actions={[]} tabs={null}
      labels={{ title: t('title'), description: t('description'), moreActions: t('action'), sections: t('inventory.title') }} />}>
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('inventory.title')} searchPlaceholder={t('inventory.title')} views={[]} view="" defaultView="" onViewChange={undefined}
      primaryAction={null} aria-label={t('inventory.title')} className="console-tenants-toolbar min-w-0"
      filters={<div className="flex min-w-0 flex-wrap items-center justify-between gap-4"><div><h2 className="font-medium">{t('inventory.title')}</h2>
        {inventory && !inventoryLoading && !error && <Text variant="supporting" tone="muted">{truncated ? t('truncatedCount', { count: context.tenants.length }) : t('count', { count: context.tenants.length })}</Text>}</div>
        <Button ref={trigger} type="button" variant="primary" onClick={() => setWizard(true)}>{t('create')}</Button></div>} />
    {!inventory ? <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} defaultRequested={false} action={{ label: t('myPlan'), href: '/console/my-plan' }} titleAs="h2" bordered={false}
      labels={{ title: () => t('restricted'), description: () => t('restrictedDescription'), request: '', requested: '', sent: '' }} />
      : inventoryLoading ? <div role="status" aria-label={t('loading')} aria-busy={true}><div aria-hidden={true}><TableSkeleton rows={4} columns={4} label={t('loading')} className="min-w-0" /></div></div>
        : error ? <Feedback failure={error} area="inventory" retry={reload} close={null} secondary={error.status === 404 ? <Link render={<RouterLink to="/console/overview" />} underline="always" external={false} externalLabel="">{t('overview')}</Link> : null} />
          : context.tenants.length ? <>
            <div ref={table} className="console-tenants-table min-w-0 max-w-full">
              <DataTable rows={context.tenants} columns={columns} getRowId={(tenant) => tenant.tenantId} getRowLabel={(tenant) => tenant.displayName} caption={t('caption')} showCaption={false}
                paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
                sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
                resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('caption'), emptyTitle: t('empty'), emptyDescription: t('emptyDescription'), loading: () => t('loading') }} />
            </div>
            {truncated && <Text variant="supporting" tone="muted">{t('truncatedNote', { count: context.tenants.length })}</Text>}
          </> : <FirstRunEmpty title={t('empty')} description={t('emptyDescription')} steps={[]} actionLabel={t('firstCreate')} onAction={() => setWizard(true)} secondary={null} titleAs="h2" bordered={false}
            labels={{ title: t('empty'), description: t('emptyDescription'), action: t('firstCreate'), guide: '' }} />}
    {wizard && <Wizard blockedReason={blockedReason} allowed={allowed} superadmin={superadmin} close={() => setWizard(false)} trigger={trigger} precheck={precheck} retryPrecheck={() => setCheckAttempt((value) => value + 1)} />}
  </Page>
}
function LocalizedToaster() {
  const { t } = useTranslation('pages.console-tenants-page')
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
  return <><div ref={setContainer} className="console-tenants-portal" />{container && <Toaster closeLabel={t('close')} container={container} className="console-tenants-portal" />}</>
}
export default function ConsoleTenantsPage() {
  const { i18n: language } = useTranslation('pages.console-tenants-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer className="console-tenants-portal"><ToastProvider timeout={5000} limit={3}>
    <TenantInventory /><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
