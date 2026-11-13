import type { ComponentProps } from 'react'
import { Badge, Button, CodeBlock, EmptyState, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { Failure } from './api'
import type { ListState } from './useSection'
import { focusRing, useCopy } from './copy'

export function Action({ children, disabled = false, loading = false, variant = 'secondary', className = '', ...props }: ComponentProps<typeof Button>) {
  return <Button type="button" size="sm" variant={variant} disabled={disabled || loading} loading={loading} aria-busy={loading} iconOnly={false} icon={undefined} trailingIcon={undefined} className={`${focusRing} ${className}`} {...props}>{children}</Button>
}
export function Heading({ title, description, id, level = 'h2' }: { title: string; description: string; id?: string; level?: 'h2' | 'h3' }) {
  return <SectionHeader title={title} description={description} count={undefined} actions={[]} as={level} bordered={false} headingId={id} className="min-w-0" />
}
export function Empty({ title }: { title: string }) {
  return <EmptyState icon={undefined} title={title} description="" titleAs="h3" bordered={false} size="md" primaryAction={null} secondaryAction={null} className="min-w-0" />
}
export function Loading({ label }: { label: string }) {
  return <div role="status" aria-label={label} aria-busy={true}><TableSkeleton rows={3} columns={3} label={label} className="min-w-0" /></div>
}
export function FailureView({ failure, message, retry, retryAllStatuses = false }: { failure: Failure; message: string; retry: () => void; retryAllStatuses?: boolean }) {
  const { t } = useCopy()
  if (!retryAllStatuses && failure.status === 403) return <NoAccessEmpty resource="" owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
  if (!retryAllStatuses && failure.status === 404) return <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={null} titleAs="h3" bordered={false} className="min-w-0" />
  return <ErrorPanel title={message} message={t(failure.status == null ? 'networkError' : 'serverError')} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0"
    labels={{ title: message, message: t('serverError'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}
export function Tag({ children }: { children: ComponentProps<typeof Badge>['children'] }) { return <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{children}</Badge> }
export function Notice({ title, description, tone }: { title: string; description: ComponentProps<typeof InlineCallout>['description']; tone: 'info' | 'warning' | 'success' }) {
  return <InlineCallout tone={tone} title={title} description={description} actions={[]} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title, description: '', upgrade: '', viewUsage: '' }} />
}
export function Details({ title, items }: { title: string; items: { id: string; label: string; value: string }[] }) {
  const { t } = useCopy()
  return <DescriptionListCard title={title} description="" titleAs="h3" wrap={true} columns={2} onEdit={undefined} editLabel="" onCopy={undefined} className="min-w-0"
    items={items.map((item) => ({ ...item, mono: false, copyable: false, copyValue: undefined, render: undefined, status: undefined }))}
    labels={{ title, description: '', edit: '', copy: () => t('copy'), copied: () => t('copied'), copiedToClipboard: t('snippetCopied'), copyFailed: t('clipboardUnavailable') }} />
}
export function Code({ code, label, language }: { code: string; label: string; language: string }) {
  return <CodeBlock code={code} language={language} filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={undefined} label={label} className="min-w-0 max-w-full" />
}
export function List<T extends object>({ id, title, description, state, columns, rowId, emptyKey, onSelect }: { id: string; title: string; description: string; state: ListState<T>; columns: DataTableColumn<T>[]; rowId: (row: T) => string; emptyKey?: string; onSelect?: (row: T) => void }) {
  const { t } = useCopy()
  const rows = state.data?.items ?? []
  const cursor = state.data?.page?.nextCursor
  return <section ref={state.region} tabIndex={-1} className={`min-w-0 max-w-full space-y-3 ${focusRing}`} aria-label={title} data-testid={`pg-${id}`}>
    <Heading title={title} description={description} />
    {state.loading ? <Loading label={t(`${id}Loading`)} /> : state.failure ? <FailureView failure={state.failure} message={t(`${id}Error`)} retry={state.reload} /> : <>
      {rows.length ? <div className="min-w-0 max-w-full" onClick={(event) => {
        if (!onSelect || !(event.target instanceof Element) || event.target.closest('button,a,input')) return
        const id = event.target.closest('[data-row-id]')?.getAttribute('data-row-id')
        const row = rows.find((item) => rowId(item) === id)
        if (row) onSelect(row)
      }}><DataTable rows={rows} columns={columns} getRowId={rowId} getRowLabel={rowId} caption={t(`${id}Table`)} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} defaultSelectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} csvExport={false} className="min-w-0 max-w-full" labels={{ scrollRegion: t(`${id}Table`), emptyTitle: t(`${id}Empty`), emptyDescription: '', loading: () => t(`${id}Loading`) }} /></div> : <Empty title={t(emptyKey ?? `${id}Empty`)} />}
      <div className="flex flex-wrap items-center gap-3" aria-label={t('pager', { section: title })}>
        <Text as="p" variant="supporting" tone="muted">{t('shown', { count: rows.length })}</Text>
        {state.hasPrevious && <Action onClick={state.previous}>{t('previous')}</Action>}
        {cursor && <Action onClick={() => state.next(cursor)}>{t('next')}</Action>}
      </div>
    </>}
  </section>
}
