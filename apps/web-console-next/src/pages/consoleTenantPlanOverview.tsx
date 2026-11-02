import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, EmptyState, Meter, Page, StatusTag, Tabs, TabsList, TabsPanel, TabsTab, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, PageHeader, StatusTimeline, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import i18n from '../i18n'
import { useSession } from '../shell/session'
import { getPlanOverview, failureFrom, type Capability, type Failure, type PlanOverview, type QuantitativeLimit } from './consoleTenantPlanOverview/api'
import { planStatus, planTones, usageStatus, usageTones } from './consoleTenantPlanOverview/format'
import es from '../locales/es/pages.console-tenant-plan-overview-page.json'
import en from '../locales/en/pages.console-tenant-plan-overview-page.json'
import './consoleTenantPlanOverview/page.css'

i18n.addResourceBundle('es', 'pages.console-tenant-plan-overview-page', es)
i18n.addResourceBundle('en', 'pages.console-tenant-plan-overview-page', en)

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const ns = 'pages.console-tenant-plan-overview-page'

// Same predicate as the legacy console-principal.ts isTenantlessPlatformPrincipal.
const platformInventoryRoles = ['superadmin', 'platform_admin', 'platform_operator']

function Consumption({ row }: { row: QuantitativeLimit }) {
  const { t } = useTranslation(ns)
  const limit = row.effectiveValue ?? -1
  const used = row.currentUsage ?? null
  const name = row.displayLabel ?? row.dimensionKey
  // Legacy ConsumptionBar: unlimited shows the raw usage, unknown usage shows no data.
  if (limit === -1) return <Text as="span">{t('unlimitedUsage', { used: used ?? t('dash') })}</Text>
  if (used === null) return <Text as="span" tone="muted">{t('noData')}</Text>
  const over = limit > 0 && used >= limit
  const label = limit > 0 ? t('usageOf', { used, limit }) : t('usageZeroLimit', { used })
  const valueText = limit > 0 ? t(used > limit ? 'usageTextOver' : 'usageText', { used, limit }) : label
  return <div className="min-w-0 space-y-1">
    <Meter value={limit > 0 ? Math.min(used, limit) : used > 0 ? 1 : 0} min={0} max={limit > 0 ? limit : 1} size="sm" label={null} aria-label={t('usageName', { dimension: name })}
      aria-valuetext={valueText} valueLabel={label} hideValue={false} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={over ? t('usage.over_limit') : null} />
    {row.usageStatus === 'unknown' && <Text as="span" tone="muted">{t('noData')}</Text>}
  </div>
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><Text as="span" className="mb-1 block text-sm text-muted-foreground md:hidden">{label}</Text>{children}</div>
}

function Limits({ limits }: { limits: QuantitativeLimit[] }) {
  const { t } = useTranslation(ns)
  const name = (row: QuantitativeLimit) => row.displayLabel ?? row.dimensionKey
  const columns: DataTableColumn<QuantitativeLimit>[] = [
    { id: 'dimension', header: t('dimension'), sortable: false, cell: (row) => <Cell label={t('dimension')}><Text as="span" className="font-medium">{name(row)}</Text></Cell> },
    { id: 'limit', header: t('limit'), sortable: false, cell: (row) => <Cell label={t('limit')}><Text as="span">{(row.effectiveValue ?? -1) === -1 ? t('unlimited') : String(row.effectiveValue)}</Text></Cell> },
    { id: 'origin', header: t('origin'), sortable: false, cell: () => <Cell label={t('origin')}><Badge tone="neutral" variant="outline" size="auto" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('originPlan')}</Badge></Cell> },
    { id: 'consumption', header: t('consumption'), sortable: false, cell: (row) => <Cell label={t('consumption')}><Consumption row={row} /></Cell> },
    { id: 'usageStatus', header: t('state'), sortable: false, cell: (row) => {
      const value = usageStatus(row.usageStatus)
      return <Cell label={t('state')}><StatusTag status={value} label={t(`usage.${value}`)} aria-label={t('usageStatusName', { dimension: name(row), status: t(`usage.${value}`) })}
        statuses={{ [value]: { label: t(`usage.${value}`), tone: usageTones[value] } }} uppercase={false} /></Cell>
    } },
  ]
  return <section className="min-w-0 space-y-3" aria-labelledby="plan-overview-limits-heading">
    <h2 id="plan-overview-limits-heading" className="text-base font-semibold">{t('limitsTitle')}</h2>
    {limits.length ? <div className="plan-overview-limits min-w-0 max-w-full">
      <DataTable rows={limits} columns={columns} getRowId={(row) => row.dimensionKey} getRowLabel={name} caption={t('limitsTitle')} showCaption={false}
        paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
        sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
        resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('limitsTitle'), emptyTitle: t('noLimits'), emptyDescription: '', loading: () => t('loading') }} />
    </div> : <EmptyState title={t('noLimits')} description={t('noLimitsDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} className="min-w-0" />}
  </section>
}

function Capabilities({ capabilities }: { capabilities: Capability[] }) {
  const { t } = useTranslation(ns)
  const items = capabilities.map((item) => {
    const label = item.displayLabel ?? item.capabilityKey
    const state = item.enabled ? t('capabilityEnabled') : t('capabilityDisabled')
    return { id: item.capabilityKey, label, value: state, mono: false, copyable: false,
      render: <span className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusTag status={item.enabled ? 'enabled' : 'disabled'} label={state} aria-label={t(item.enabled ? 'capabilityEnabledName' : 'capabilityDisabledName', { capability: label })}
          statuses={{ [item.enabled ? 'enabled' : 'disabled']: { label: state, tone: item.enabled ? 'success' : 'neutral' } }} uppercase={false} />
        <Badge tone="neutral" variant="outline" size="auto" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('capabilityOrigin')}</Badge>
      </span> }
  })
  return capabilities.length
    ? <DescriptionListCard title={t('capabilities')} description="" items={items} wrap={true} columns={2} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="min-w-0"
      labels={{ title: t('capabilities'), description: '', edit: '', copy: (label) => label, copied: (label) => label, copiedToClipboard: '' }} />
    : <section className="min-w-0 space-y-3" aria-labelledby="plan-overview-capabilities-heading">
      <h2 id="plan-overview-capabilities-heading" className="text-base font-semibold">{t('capabilities')}</h2>
      <EmptyState title={t('noCapabilities')} description={undefined} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} size="sm" className="min-w-0" />
    </section>
}

function Summary({ overview }: { overview: PlanOverview }) {
  const { t } = useTranslation(ns)
  const limits = overview.quantitativeLimits ?? []
  const overLimit = limits.filter((item) => item.usageStatus === 'over_limit').length
  const known = overview.planStatus ? planStatus(overview.planStatus) : null
  const statusLabel = overview.planStatus ? known ? t(`status.${known}`) : overview.planStatus : ''
  const items = [
    { id: 'plan', label: t('plan'), value: overview.planSlug ?? t('noPlan'), mono: false, copyable: false,
      ...(overview.planSlug ? {} : { render: <Text as="span" tone="muted">{t('noPlan')}</Text> }) },
    ...(overview.planStatus ? [{ id: 'status', label: t('planStatus'), value: statusLabel, mono: false, copyable: false,
      render: <StatusTag status={overview.planStatus} label={statusLabel} aria-label={t('planStatusName', { status: statusLabel })}
        statuses={{ [overview.planStatus]: { label: statusLabel, tone: known ? planTones[known] : 'neutral' } }} uppercase={false} /> }] : []),
  ]
  return <div className="min-w-0 space-y-6" data-testid="plan-overview-summary">
    <DescriptionListCard title={t('planCard')} description="" items={items} wrap={true} columns={2} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="min-w-0"
      labels={{ title: t('planCard'), description: '', edit: '', copy: (label) => label, copied: (label) => label, copiedToClipboard: '' }} />
    {overLimit > 0 && <InlineCallout tone="destructive" title={t('overLimit', { count: overLimit })} description={null} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
      labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} className="min-w-0 wrap-anywhere" />}
    <Limits limits={limits} />
    <Capabilities capabilities={overview.capabilities ?? []} />
  </div>
}

function History() {
  const { t } = useTranslation(ns)
  // No self-scoped plan history exists for tenant users (gap-b005-my-plan-self-history): an explicit empty
  // timeline, with no request.
  return <div className="min-w-0 space-y-2" data-testid="plan-overview-history">
    <StatusTimeline events={[]} label={t('historyLabel')} emptyLabel={t('historyEmptyTitle')} showFewerLabel={t('showFewer')} showEarlierLabel={(count) => t('showEarlier', { count })}
      actorLabel={t('actor')} maxVisible={undefined} timeFormat="absolute" className="min-w-0" />
    <Text as="p" tone="muted">{t('historyEmptyDescription')}</Text>
  </div>
}

export default function ConsoleTenantPlanOverview() {
  const { t } = useTranslation(ns)
  const navigate = useNavigate()
  const principal = useSession()?.principal
  const roles = Array.isArray(principal?.platformRoles) ? principal.platformRoles : []
  const tenantless = roles.some((role) => platformInventoryRoles.includes(role)) && !(Array.isArray(principal?.tenantIds) ? principal.tenantIds : []).filter(Boolean).length
  const canOpenCatalog = roles.includes('superadmin')
  const [data, setData] = useState<PlanOverview | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [loading, setLoading] = useState(!tenantless)
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState<'summary' | 'history'>('summary')
  const heading = useRef<HTMLHeadingElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const retryRequested = useRef(false)
  const inFlight = useRef(false)
  useEffect(() => {
    let active = true
    if (tenantless) { setData(null); setFailure(null); setLoading(false); return }
    inFlight.current = true
    setLoading(true)
    setData(null)
    if (!retryRequested.current) setFailure(null)
    void getPlanOverview().then((overview) => {
      if (!active) return
      setData(overview)
      setFailure(null)
    }).catch((cause: unknown) => {
      if (!active) return
      setFailure(failureFrom(cause))
    }).finally(() => {
      if (active) { inFlight.current = false; setLoading(false) }
    })
    return () => { active = false }
  }, [tenantless, attempt])
  useEffect(() => {
    // A new retry can start before the preceding render's focus effect runs.
    if (loading || inFlight.current || !retryRequested.current) return
    if (failure && ![401, 403, 404].includes(failure.status ?? 0)) retry.current?.focus()
    else heading.current?.focus()
    retryRequested.current = false
  }, [loading, failure])
  const header = <PageHeader as="div" title={t('title')} description={t('description')} titleRef={heading} wrapTitle={true}
    breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
    labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('tabs') }} />
  const message = t(failure?.status ? 'errorDescription' : 'networkDescription')
  const retryable = failure && ![401, 403, 404].includes(failure.status ?? 0)
  const backToOverview = <RouterLink to="/console/overview" state={{ focusMainHeading: true }} className={`underline ${focus}`}>{t('backToOverview')}</RouterLink>
  return <Page width="wide" header={header} title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-tenant-plan-overview min-w-0 space-y-6 wrap-anywhere">
    {tenantless ? <EmptyState title={t('tenantlessTitle')} description={t(canOpenCatalog ? 'tenantlessDescriptionCatalog' : 'tenantlessDescription')} icon={undefined}
      primaryAction={canOpenCatalog ? <Button type="button" variant="secondary" onClick={() => navigate('/console/plans', { state: { focusMainHeading: true } })}>{t('openCatalog')}</Button> : null}
      secondaryAction={null} titleAs="h2" bordered={false} />
      : failure?.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" onRequestAccess={undefined} showRequestAccess={false}
        action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
        labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : failure?.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={backToOverview} titleAs="h2" bordered={false} />
      : retryable ? <div data-testid="plan-overview-error" className="min-w-0 space-y-3">
        <ErrorPanel title={t('errorTitle')} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details=""
          onRetry={undefined} retrying={false} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true}
          labels={{ title: t('errorTitle'), message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'),
            requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
        <Button ref={retry} type="button" variant="secondary" aria-disabled={loading} aria-busy={loading}
          onClick={() => { if (inFlight.current) return; retryRequested.current = true; inFlight.current = true; setAttempt((value) => value + 1) }}>{t(loading ? 'retrying' : 'retry')}</Button>
      </div>
      : loading || failure?.status === 401 || !data ? <section role="status" aria-label={t('loading')} aria-busy={true}>
        <Text>{t('loadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={4} columns={5} label={t('loading')} className="min-w-0" /></div>
      </section>
      : <Tabs value={tab} defaultValue={undefined} variant="underline" orientation="horizontal" onValueChange={(value) => setTab(value as 'summary' | 'history')} className="min-w-0">
        <TabsList activateOnFocus={true} indicator={false} fullWidth={false} aria-label={t('tabs')} className="flex max-w-full flex-wrap">
          <TabsTab value="summary" className={focus}>{t('tabSummary')}</TabsTab>
          <TabsTab value="history" className={focus}>{t('tabHistory')}</TabsTab>
        </TabsList>
        <TabsPanel value="summary" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}><Summary overview={data} /></TabsPanel>
        <TabsPanel value="history" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}><History /></TabsPanel>
      </Tabs>}
  </Page>
}
