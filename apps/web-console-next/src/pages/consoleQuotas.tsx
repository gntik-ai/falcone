import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, EmptyState, I18nProvider, Link, LiveAnnouncer, Meter, Page, StatusTag, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, Text, Timestamp, ToastProvider, Toaster } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty, PageHeader, PageToolbar, SectionHeader, TableSkeleton } from '@gntik-ai/blocks'
import { getTenantQuotaOverview, getTenantQuotaPosture, getWorkspaceQuotaOverview, getWorkspaceQuotaPosture } from '@in-falcone/console-api/clients'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../i18n'
import { useConsoleContext } from '../shell/context'
import { useSession } from '../shell/session'
import { AdjustDialog, type AdjustTarget } from './consoleQuotas/AdjustDialog'
import { formatValue, normalize, type Dimension, type Posture } from './consoleQuotas/posture'
import es from '../locales/es/pages.console-quotas-page.json'
import en from '../locales/en/pages.console-quotas-page.json'
import './consoleQuotas/table.css'

i18n.addResourceBundle('es', 'pages.console-quotas-page', es)
i18n.addResourceBundle('en', 'pages.console-quotas-page', en)

function Quotas() {
  const { t, i18n: language } = useTranslation('pages.console-quotas-page')
  const { activeTenantId, activeWorkspaceId, tenants, loading: contextLoading } = useConsoleContext()
  const roles = useSession()?.principal?.platformRoles ?? []
  const canAdjust = roles.includes('superadmin') || roles.includes('platform_operator')
  const [result, setResult] = useState<{ tenant: Posture; workspace: Posture | null; context: string } | null>(null)
  const [failure, setFailure] = useState<Partial<ApiError> | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [target, setTarget] = useState<AdjustTarget | null>(null)
  const returnFocus = useRef<string | null>(null)
  const retry = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const context = `${activeTenantId}/${activeWorkspaceId}`
  // Session revalidation can toggle shell loading without changing either scope.
  useEffect(() => {
    let active = true
    setResult(null); setFailure(null)
    if (!activeTenantId) { setLoading(false); return }
    setLoading(true)
    void (async () => {
      const tenant = await Promise.all([getTenantQuotaPosture(activeTenantId), getTenantQuotaOverview(activeTenantId)])
      const workspace = activeWorkspaceId ? await Promise.all([getWorkspaceQuotaPosture(activeWorkspaceId), getWorkspaceQuotaOverview(activeWorkspaceId)]) : null
      return { tenant: normalize(...tenant), workspace: workspace ? normalize(...workspace) : null, context }
    })().then((data) => { if (active) setResult(data) }).catch((cause: unknown) => {
      if (active) {
        const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
        setFailure({ status: error.status, requestId: error.requestId ?? error.correlationId, message: error.message })
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [activeTenantId, activeWorkspaceId, context, attempt])
  useEffect(() => {
    if (!loading && retry.current) { heading.current?.focus(); retry.current = false }
  }, [loading])
  useEffect(() => { setTarget(null) }, [context])
  useEffect(() => {
    if (target || loading || !returnFocus.current) return
    const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-quota-adjust-trigger]')).find((node) => node.dataset.quotaAdjustTrigger === returnFocus.current)
    const destination = trigger ?? heading.current
    destination?.focus()
    returnFocus.current = null
  }, [target, loading, result])
  // Reloading must keep the mounted dialog and its busy guard until the result is shown.
  function reload() { setAttempt((count) => count + 1) }
  const data = result?.context === context ? result : null
  const posture = data?.tenant.overallPosture ?? 'unknown'
  const postureLabel = Object.hasOwn(es.posture, posture) ? t(`posture.${posture}`) : posture.replace(/_/g, ' ')
  const tone = posture.includes('breach') || posture.includes('exceeded') ? 'destructive' : posture.includes('warning') ? 'warning' : posture === 'within_limit' ? 'success' : 'neutral'
  const header = <PageHeader as="div" wrapTitle={true} title={t('title')} titleRef={heading} description={tenants.find((tenant) => tenant.tenantId === activeTenantId)?.displayName ?? t('activeTenant')}
    breadcrumbs={null} status="" statuses={{}} actions={[]} tabs={null}
    meta={[{ label: t('postureLabel'), value: <StatusTag status={posture} label={postureLabel} statuses={{ [posture]: { label: postureLabel, tone } }} uppercase={false} />, mono: false },
      { label: t('evaluated'), value: <Timestamp value={data?.tenant.evaluatedAt ?? ''} locale={language.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} live={false} tooltip={false} fallback={t('missing')} />, mono: false }]}
    labels={{ title: t('title'), description: t('activeTenant'), moreActions: t('actions'), sections: t('title') }} />
  return <Page width="full" header={header} title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-quotas min-w-0 space-y-6 wrap-anywhere">
    {contextLoading || loading ? <section role="status" aria-label={t('loading')} aria-busy={true}><Text>{t('loadingDescription')}</Text><div aria-hidden={true} className="space-y-6">
      <TableSkeleton rows={6} columns={canAdjust ? 7 : 6} label={t('loading')} className="min-w-0" />
      <TableSkeleton rows={3} columns={canAdjust ? 7 : 6} label={t('loading')} className="min-w-0" />
    </div></section> : !activeTenantId ? <EmptyState title={t('blocked')} description={t('blockedDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} /> :
      failure?.status === 401 ? null : failure?.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
        labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} /> :
      failure?.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} titleAs="h2" bordered={false}
        action={<Link render={<RouterLink to="/console" />} underline="always" external={false} externalLabel="">{t('consoleStart')}</Link>} /> :
      failure ? <ErrorPanel title={t('error')} message={failure.message || t('networkDescription')} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={true}
        onRetry={() => { retry.current = true; reload() }} retrying={false} retryLabel={t('retry')}
        labels={{ title: t('error'), message: t('errorDescription'), support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} /> :
      data && <>
        {data.tenant.dimensions.length === 0 ? <EmptyState title={t('empty')} description={t('emptyDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} /> :
          <QuotaTable scope="tenant" posture={data.tenant} canAdjust={canAdjust} onAdjust={(dimension) => setTarget({ tenantId: activeTenantId, dimension, key: `tenant-${dimension.dimensionId}` })} />}
        {data.workspace && <QuotaTable scope="workspace" posture={data.workspace} canAdjust={canAdjust} onAdjust={(dimension) => setTarget({ tenantId: activeTenantId, dimension, key: `workspace-${dimension.dimensionId}` })} />}
      </>}
    {target && <AdjustDialog key={target.key} target={target} onClose={() => { returnFocus.current = target.key; setTarget(null) }} onAdjusted={reload} />}
  </Page>
}
function QuotaTable({ scope, posture, canAdjust, onAdjust }: { scope: 'tenant' | 'workspace'; posture: Posture; canAdjust: boolean; onAdjust: (row: Dimension) => void }) {
  const { t } = useTranslation('pages.console-quotas-page')
  const [search, setSearch] = useState('')
  const section = useRef<HTMLElement>(null)
  const rows = posture.dimensions.filter((row) => row.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const caption = t('caption', { scope: t(scope) })
  // Compose resource-index/data-table with kit Table primitives to retain scope=row headers.
  // The 0.11.0 DataTable cell slot always renders td; all optional table features stay absent.
  return <section ref={section} className="min-w-0 space-y-4" aria-labelledby={`quota-${scope}`}>
    <SectionHeader title={t(scope)} description={t('count', { count: posture.dimensions.length })} count={undefined} actions={[]} as="h2" bordered={true} headingId={`quota-${scope}`} className="min-w-0" />
    <PageToolbar search={search} defaultSearch="" onSearchChange={setSearch} searchLabel={t('searchLabel', { scope: t(scope) })} searchPlaceholder={t('searchPlaceholder')}
      views={[]} view="" defaultView="" onViewChange={undefined} filters={null} primaryAction={null} aria-label={t('searchLabel', { scope: t(scope) })} className="min-w-0" />
    {!rows.length && search !== '' ? <EmptyState title={t('noResults')} description={t('noResultsDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false}>
      <Button type="button" variant="secondary" onClick={() => { setSearch(''); section.current?.querySelector<HTMLInputElement>('input')?.focus() }}>{t('clear')}</Button>
    </EmptyState> : <Table aria-label={caption} containerLabel={caption} density="comfortable" stickyHeader={false} className="quota-table w-full" containerClassName="min-w-0 max-w-full">
      <TableCaption>{caption}</TableCaption>
      <TableHeader><TableRow>{['dimension', 'limit', 'consumption', 'usage', 'mode', 'freshness', ...(canAdjust ? ['action'] : [])].map((key) => <TableHead key={key} scope="col">{t(key)}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map((row) => <TableRow key={row.dimensionId}>
        <th scope="row" className="px-4 py-3 text-left font-medium">{row.displayName}</th>
        <TableCell>{row.hardLimit === null || row.hardLimit === -1 ? t('unlimited') : formatValue(row.hardLimit, row)}</TableCell>
        <TableCell>{formatValue(row.measuredValue, row)}</TableCell>
        <TableCell>{row.pctUsed === null ? t('missing') : <Meter value={row.pctUsed} min={0} max={100} size="sm" label={null} valueLabel={`${row.pctUsed}%`} hideValue={false}
          aria-label={t('usageLabel', { dimension: row.displayName })} aria-valuetext={`${row.pctUsed}%`} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={null} />}
          {row.isExceeded && <Badge tone="destructive" variant="soft"><AlertTriangle aria-hidden={true} className="size-3" />{t('exceeded')}</Badge>}</TableCell>
        <TableCell>{t(`policy.${row.policyMode}`)}</TableCell><TableCell>{t(`fresh.${row.freshnessStatus}`)}</TableCell>
        {canAdjust && <TableCell><Button type="button" variant="secondary" size="sm" data-quota-adjust-trigger={`${scope}-${row.dimensionId}`} aria-label={t('adjustName', { dimension: row.displayName })} onClick={() => onAdjust(row)}>{t('adjust')}</Button></TableCell>}
      </TableRow>)}</TableBody>
    </Table>}
  </section>
}
function LocalizedToaster() {
  const { t } = useTranslation('pages.console-quotas-page')
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
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('close')} container={container} className="" />}</>
}
export default function ConsoleQuotasPage() {
  const { i18n: language } = useTranslation('pages.console-quotas-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={5000} limit={1}>
    <Quotas /><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
