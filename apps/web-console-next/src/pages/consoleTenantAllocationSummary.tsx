import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, EmptyState, Link, Meter, Page, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow, Text, Toolbar } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty, PageHeader, TableSkeleton } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../i18n'
import { useSession } from '../shell/session'
import { isMigratedRoute } from '../shell/navigation'
import { getTenantAllocationSummary, type AllocationDimension, type AllocationSummary } from './consoleTenantAllocationSummary/api'
import { formatAllocationValue, workspaceLabel } from './consoleTenantAllocationSummary/format'
import es from '../locales/es/pages.console-tenant-allocation-summary-page.json'
import en from '../locales/en/pages.console-tenant-allocation-summary-page.json'
import './consoleTenantAllocationSummary/table.css'

i18n.addResourceBundle('es', 'pages.console-tenant-allocation-summary-page', es)
i18n.addResourceBundle('en', 'pages.console-tenant-allocation-summary-page', en)

export default function ConsoleTenantAllocationSummary() {
  const { t, i18n: language } = useTranslation('pages.console-tenant-allocation-summary-page')
  const principal = useSession()?.principal
  const tenantless = (principal?.platformRoles ?? []).some((role) => ['superadmin', 'platform_admin', 'platform_operator'].includes(role)) && !(principal?.tenantIds ?? []).filter(Boolean).length
  const [data, setData] = useState<AllocationSummary | null>(null)
  const [failure, setFailure] = useState<Pick<Partial<ApiError>, 'status' | 'requestId'> | null>(null)
  const [loading, setLoading] = useState(!tenantless)
  const [attempt, setAttempt] = useState(0)
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
    void getTenantAllocationSummary().then((summary) => {
      if (!active) return
      setData(summary)
      setFailure(null)
    }).catch((cause: unknown) => {
      if (!active) return
      const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
      setFailure({ status: typeof error.status === 'number' ? error.status : undefined,
        requestId: typeof error.requestId === 'string' ? error.requestId : undefined })
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
  const back = isMigratedRoute('/console/my-plan')
    ? <RouterLink to="/console/my-plan" state={{ focusMainHeading: true }} className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">{t('myPlan')}</RouterLink>
    : <Link href="/console/my-plan" underline="always">{t('myPlan')}</Link>
  const header = <>
    <nav aria-label={t('breadcrumb')} className="flex flex-wrap gap-3 text-sm">
      {back}<Text as="span" aria-current="page">{t('title')}</Text>
    </nav>
    <PageHeader as="div" title={t('title')} description={t('description')} titleRef={heading} wrapTitle={true}
      breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
      labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('tableTitle') }} />
  </>
  const message = t(failure?.status ? 'errorDescription' : 'networkDescription')
  const retryable = failure && ![401, 403, 404].includes(failure.status ?? 0)
  // Resource-index composition: the pinned template forces search and selection.
  // Toolbar and Table primitives preserve the count-only bar and semantic row headers.
  return <Page width="full" header={header} title={null} description={null} actions={null} actionBar={null}
    actionBarLabel={t('actions')} className="allocation-summary min-w-0 wrap-anywhere">
    {tenantless ? <EmptyState title={t('tenantlessTitle')} description={t('tenantlessDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} />
      : failure?.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" onRequestAccess={undefined} showRequestAccess={false}
        action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
        labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : failure?.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={back} titleAs="h2" bordered={false} />
      : retryable ? <div data-testid="allocation-error">
        <ErrorPanel title={t('errorTitle')} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details=""
          onRetry={undefined} retrying={loading} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true}
          labels={{ title: t('errorTitle'), message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'),
            requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
        <Button ref={retry} type="button" variant="secondary" aria-disabled={loading} aria-busy={loading}
          onClick={() => { if (inFlight.current) return; retryRequested.current = true; inFlight.current = true; setAttempt((value) => value + 1) }}>{t(loading ? 'retrying' : 'retry')}</Button>
      </div>
      : loading || failure?.status === 401 ? <section role="status" aria-label={t('loading')} aria-busy={true}>
        <Text>{t('loadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={4} columns={5} label={t('loading')} className="min-w-0" /></div>
      </section>
      : data && data.dimensions.every((row) => row.workspaces.length === 0)
        ? <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} />
        : data && <>
          <Toolbar aria-label={t('count', { count: data.dimensions.length })} className="min-w-0"><Text>{t('count', { count: data.dimensions.length })}</Text></Toolbar>
          <h2 className="text-base font-semibold">{t('tableTitle')}</h2>
          <AllocationTable rows={data.dimensions} locale={language.language} />
        </>}
  </Page>
}

function AllocationTable({ rows, locale }: { rows: AllocationDimension[]; locale: string }) {
  const { t } = useTranslation('pages.console-tenant-allocation-summary-page')
  const columns = ['dimension', 'limit', 'allocated', 'unallocated', 'breakdown'] as const
  const value = (number: number, row: AllocationDimension) => formatAllocationValue(number, row, locale, t('unlimited'))
  const label = (key: typeof columns[number]) => <Text as="span" className="mb-1 block text-sm text-muted-foreground md:hidden">{t(key)}</Text>
  return <Table aria-label={t('tableTitle')} containerLabel={t('tableTitle')} density="comfortable" stickyHeader={false} className="w-full" containerClassName="allocation-table min-w-0">
    <TableCaption>{t('tableTitle')}</TableCaption>
    <TableHeader><TableRow>{columns.map((key) => <TableHead key={key} scope="col">{t(key)}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{rows.map((row) => <TableRow key={row.dimensionKey}>
      <th scope="row" className="px-4 py-3 text-left font-medium">{label('dimension')}<Text as="span">{row.displayLabel}</Text></th>
      <TableCell>{label('limit')}<Text as="span">{value(row.tenantEffectiveValue, row)}</Text></TableCell>
      <TableCell>{label('allocated')}<Text as="span">{value(row.totalAllocated, row)}</Text>
        {row.tenantEffectiveValue !== -1 && <Meter value={row.totalAllocated} min={0} max={row.tenantEffectiveValue} size="sm"
          label={null} aria-label={t('meter', { dimension: row.displayLabel, allocated: value(row.totalAllocated, row), limit: value(row.tenantEffectiveValue, row) })}
          aria-valuetext={t('meter', { dimension: row.displayLabel, allocated: value(row.totalAllocated, row), limit: value(row.tenantEffectiveValue, row) })}
          valueLabel={null} hideValue={true} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={null} />}
      </TableCell>
      <TableCell>{label('unallocated')}<div className="flex flex-wrap gap-2"><Text as="span">{row.unallocated === null ? t('dash') : value(row.unallocated, row)}</Text>
        {row.isFullyAllocated && <Badge tone="neutral" variant="soft">{t('fullyAllocated')}</Badge>}</div></TableCell>
      <TableCell>{label('breakdown')}{row.workspaces.length ? <ul className="space-y-2">{row.workspaces.map((workspace, index) => <li key={workspace.workspaceId} className="flex flex-wrap gap-2">
        <Text as="span">{workspaceLabel(workspace, index, (number) => t('workspace', { number }))}</Text>
        <Text as="span" tone="muted">{value(workspace.allocatedValue, row)}</Text>
      </li>)}</ul> : <Text as="span" tone="muted">{t('sharedPool')}</Text>}</TableCell>
    </TableRow>)}</TableBody>
  </Table>
}
