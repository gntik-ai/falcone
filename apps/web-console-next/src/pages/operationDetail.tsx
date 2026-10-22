import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink, useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { I18nProvider, Page, StatusTag, Tabs, TabsList, TabsTab, TabsPanel, Table, TableHeader, TableHead, TableBody, TableRow, TableCell, EmptyState, type StatusDefinition } from '@gntik-ai/ui'
import { PageHeader, DescriptionListCard, StatusTimeline, NotFoundEmpty, FirstRunEmpty, ErrorPanel, TableSkeleton, ListSkeleton, InlineCallout, PaginationFooter } from '@gntik-ai/blocks'
import i18n from '../i18n'
import es from '../locales/es/operationDetail.json'
import en from '../locales/en/operationDetail.json'
import { useOperationQuery, type OperationDetailResponse, type OperationLogsResponse, type OperationResultResponse, type OperationStatus, type QueryError } from './operationDetail/query'

i18n.addResourceBundle('es', 'operationDetail', es)
i18n.addResourceBundle('en', 'operationDetail', en)

export const statusTones = { pending: 'neutral', running: 'info', completed: 'success', failed: 'destructive', timed_out: 'warning', cancelled: 'neutral' } as const
export const levelTones = { info: 'info', warning: 'warning', error: 'destructive' } as const
export function relativeTime(value: string, locale: string, now = Date.now()) {
  const date = Date.parse(value)
  if (Number.isNaN(date)) return value
  const minutes = Math.round((date - now) / 60_000)
  const hours = Math.round(minutes / 60)
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.abs(minutes) < 60 ? minutes : Math.abs(hours) < 24 ? hours : Math.round(hours / 24),
    Math.abs(minutes) < 60 ? 'minute' : Math.abs(hours) < 24 ? 'hour' : 'day')
}

function BackLink() {
  const { t } = useTranslation('operationDetail')
  return <RouterLink className="underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" to="/console/operations">{t('back')}</RouterLink>
}

// Retain the retry control during a failed retry; move focus only after recovery commits.
function QuerySection({ name, query, children, loading }: {
  name: string; query: { error: QueryError | null; isLoading: boolean; retrying: boolean; refetch: () => Promise<boolean> }
  children: ReactNode; loading: ReactNode
}) {
  const { t } = useTranslation('operationDetail')
  const heading = useRef<HTMLHeadingElement>(null)
  const recovered = useRef(false)
  useEffect(() => { if (recovered.current && !query.error && !query.retrying) { heading.current?.focus(); recovered.current = false } }, [query.error, query.retrying])
  return <section className="min-w-0 space-y-3" aria-label={name}>
    <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-2 focus-visible:outline-focus-ring">{name}</h2>
    {query.error?.status === 401 ? null : query.error?.status === 403 ? <EmptyState title={t('noAccess')} description={t('notFoundDescription')} titleAs="h3" primaryAction={<BackLink />} secondaryAction={null} /> : query.error ? <ErrorPanel
      title={t('errorTitle', { section: name })} message={t('errorMessage')} code={query.error.status ?? null}
      requestId={query.error.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true}
      labels={{ title: t('errorTitle', { section: name }), message: t('errorMessage'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retryingStatus'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }}
      retryLabel={t('retry')} retrying={query.retrying} onRetry={async () => { recovered.current = true; if (!await query.refetch()) recovered.current = false }}
    /> : query.isLoading ? loading : children}
  </section>
}

function OperationDetail({ operationId }: { operationId?: string }) {
  const { t, i18n: language } = useTranslation('operationDetail')
  const locale = language.language
  const navigate = useNavigate()
  const [tab, setTab] = useState('logs')
  const [offset, setOffset] = useState(0)
  const detail = useOperationQuery<OperationDetailResponse>('detail', operationId)
  const logs = useOperationQuery<OperationLogsResponse>('logs', operationId, offset)
  const result = useOperationQuery<OperationResultResponse>('result', operationId)
  const pagination = useRef<HTMLDivElement>(null)
  const paging = useRef(false)
  const total = useRef(0)
  if (logs.data) total.current = logs.data.total
  useEffect(() => {
    if (paging.current && !logs.isLoading) {
      const active = document.activeElement
      if (!active || active === document.body || active.hasAttribute('disabled') || !active.isConnected) pagination.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
      paging.current = false
    }
  }, [logs.isLoading])
  const date = (value: string | null | undefined) => {
    if (!value) return t('missing')
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
  }
  const statuses = Object.fromEntries(Object.entries(statusTones).map(([status, tone]) => [status, { label: t(`status.${status}`), tone }])) as Record<OperationStatus, StatusDefinition>
  const levels = Object.fromEntries(Object.entries(levelTones).map(([level, tone]) => [level, { label: t(`level.${level}`), tone }])) as Record<string, StatusDefinition>
  const data = detail.data
  const notFound = !operationId || detail.error?.status === 404 || (!detail.isLoading && !detail.error && !data?.operationId)
  const header = <PageHeader as="div" title={<span className="block whitespace-normal wrap-anywhere">{t('title')}</span>} description={t('description')} breadcrumbs={null}
    status={data?.status ?? ''} statuses={statuses} meta={[]} actions={[]} tabs={null}
    labels={{ title: t('title'), description: t('description'), moreActions: t('sections'), sections: t('sections') }} />
  if (notFound || detail.error?.status === 403) return <Page width="default" header={header} actions={null} actionBar={null} className="operation-detail min-w-0 wrap-anywhere">
    {detail.error?.status === 403
      ? <EmptyState title={t('noAccess')} description={t('notFoundDescription')} primaryAction={<BackLink />} secondaryAction={null} titleAs="h2" bordered={false} />
      : <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={<BackLink />} titleAs="h2" bordered={false} />}
  </Page>
  if (detail.error?.status === 401) return null // The authenticated shell handles refresh and redirect.
  const finished = result.data?.completedAt
  const events = data ? [
    ...(finished ? [{ id: 'finished', status: t('finished'), title: date(finished), tone: 'neutral' as const, at: finished, live: false }] : []),
    { id: 'updated', status: statuses[data.status].label, title: date(data.updatedAt), tone: statusTones[data.status], at: data.updatedAt, live: false },
    { id: 'created', status: t('createdAt'), title: date(data.createdAt), tone: 'neutral' as const, at: data.createdAt, live: false },
  ] : []
  return <Page width="default" header={header} actions={null} actionBar={null} className="operation-detail min-w-0 wrap-anywhere">
    <BackLink />
    <QuerySection name={t('metadata')} query={detail} loading={<TableSkeleton rows={8} columns={2} label={t('loadingMetadata')} />}>
      {data && <DescriptionListCard title={t('metadata')} description={t('metadataDescription')} titleAs="h3" className="operation-metadata"
        onEdit={undefined} onCopy={undefined} editLabel={t('edit')}
        labels={{ title: t('metadata'), description: t('metadataDescription'), edit: t('edit'), copy: (label) => t('copy', { label }), copied: (label) => t('copiedLabel', { label }), copiedToClipboard: t('copied') }}
        items={(['operationType', 'actorId', 'workspaceId', 'tenantId', 'createdAt', 'updatedAt', 'correlationId', 'sagaId'] as const).map((key) => ({
          id: key, label: t(key), value: key.endsWith('At') ? date(data[key]) : data[key] ?? t('missing'),
          render: <span className="block whitespace-normal wrap-anywhere">{key.endsWith('At') ? date(data[key]) : data[key] ?? t('missing')}</span>,
          mono: false, copyable: ['correlationId', 'sagaId'].includes(key) && Boolean(data[key]), copyValue: data[key] ?? '',
        }))} />}
    </QuerySection>
    {(data || detail.isLoading) && <section className="space-y-3" aria-label={t('timeline')}>
      <h2 className="text-lg font-semibold">{t('timeline')}</h2>
      {detail.isLoading ? <ListSkeleton rows={2} label={t('loadingTimeline')} /> : data ? <StatusTimeline events={events} label={t('timeline')} emptyLabel={t('notFound')} showFewerLabel={t('fewer')} showEarlierLabel={(count) => t('earlier', { count })} actorLabel={t('by')} maxVisible={undefined} timeFormat="absolute" /> : null}
    </section>}
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
      <TabsList aria-label={t('sections')}><TabsTab value="logs">{t('logs')}</TabsTab><TabsTab value="result">{t('result')}</TabsTab></TabsList>
      <TabsPanel value="logs" keepMounted>
        <QuerySection name={t('logs')} query={logs} loading={<TableSkeleton rows={3} columns={3} label={t('loadingLogs')} />}>
          <p className="text-muted-foreground">{t('logsDescription')}</p>
          {!logs.data?.entries.length ? <FirstRunEmpty title={t('emptyTitle')} description={t('emptyDescription')} steps={[]} secondary={null} actionLabel={t('back')} onAction={() => navigate('/console/operations')} titleAs="h3" bordered={false} /> : <>
            <div role="log" aria-label={t('logs')} aria-live="off">
              <Table density="comfortable" stickyHeader={false} containerLabel={t('logs')} className="operation-logs w-full table-fixed">
                <TableHeader><TableRow><TableHead className="w-1/4 whitespace-normal wrap-anywhere">{t('levelHeading')}</TableHead><TableHead className="w-1/2 whitespace-normal wrap-anywhere">{t('message')}</TableHead><TableHead className="w-1/4 whitespace-normal wrap-anywhere">{t('date')}</TableHead></TableRow></TableHeader>
                <TableBody>{logs.data.entries.map((entry) => <TableRow key={entry.logEntryId}>
                  <TableCell className="whitespace-normal wrap-anywhere"><StatusTag status={entry.level} statuses={levels} label={t(`level.${entry.level}`)} uppercase={false} className="whitespace-normal wrap-anywhere" /></TableCell>
                  <TableCell className="whitespace-normal wrap-anywhere">{entry.message}</TableCell><TableCell className="whitespace-normal wrap-anywhere"><time dateTime={entry.occurredAt}>{relativeTime(entry.occurredAt, locale)}</time></TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>

          </>}
        </QuerySection>
        {total.current > 0 && <div ref={pagination}><PaginationFooter total={total.current} page={offset / 20 + 1} pageSize={20} pageSizeOptions={[20]} defaultPage={1} defaultPageSize={20} onPageSizeChange={undefined}
              onPageChange={(page) => { if (logs.isLoading || logs.retrying) return; paging.current = true; setOffset((page - 1) * 20) }} noun={t('logs')} locale={locale}
              labels={{ rowsPerPage: t('rowsPerPage'), rowsPerPageLabel: t('rowsPerPage'), rangeSummary: (from, to, total) => t('range', { from, to, total }), paginationNav: () => t('pagination'), previous: t('previous'), next: t('next'), page: (page) => t('page', { page }) }} /></div>}
      </TabsPanel>
      <TabsPanel value="result" keepMounted>
        <QuerySection name={t('result')} query={result} loading={<ListSkeleton rows={1} label={t('loadingResult')} />}>
          <p className="text-muted-foreground">{t('resultDescription')}</p>
          <InlineCallout tone={result.data?.resultType === 'success' ? 'success' : result.data?.resultType === 'failure' ? 'destructive' : 'info'}
            title={result.data?.resultType === 'success' ? result.data.summary ?? t('success') : result.data?.resultType === 'failure' ? result.data.failureReason ?? t('failure') : t('pending')}
            description={<>{result.data?.resultType === 'failure' && <span className="block">{t(result.data.retryable ? 'retryable' : 'notRetryable')}</span>}{finished && <span className="block">{t(result.data?.resultType === 'success' ? 'completedAt' : 'finishedAt', { date: date(finished) })}</span>}</>}
            actions={[]} dismissible={false} open={true} onDismiss={undefined} />
        </QuerySection>
      </TabsPanel>
    </Tabs>
  </Page>
}

export default function OperationDetailPage() {
  const { operationId } = useParams()
  const { i18n: language } = useTranslation('operationDetail')
  return <I18nProvider locale={language.language}><OperationDetail key={operationId ?? ''} operationId={operationId} /></I18nProvider>
}
