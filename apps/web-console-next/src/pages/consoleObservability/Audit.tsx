import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Badge, Button, DatePicker, Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, EmptyState, Field, FieldLabel, Input, JsonViewer, SimpleSelect, StatusTag, Text, Timestamp, useAnnounce } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, ErrorPanel, InlineCallout, LoadMoreFooter, NoAccessEmpty, PageToolbar, TableSkeleton, type DataTableColumn, type DescriptionItem } from '@gntik-ai/blocks'
import { FailureState } from './Failure'
import type { AuditFilters } from './api'
import type { useAudit, useExport } from './hooks'
import { downloadName, exportId, exportMessage, exportStatus, fromDay, toDay, type AuditRecord } from './model'

const tones = { success: 'success', failure: 'destructive', error: 'destructive', unknown: 'neutral' } as const
const outcomeKey = (outcome: string) => ['succeeded', 'success'].includes(outcome) ? 'success' : ['failed', 'failure'].includes(outcome) ? 'failure' : outcome === 'error' ? 'error' : 'unknown'

function download(manifest: Record<string, unknown>, id: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = downloadName(id); anchor.click()
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ExportArea({ exporter }: { exporter: ReturnType<typeof useExport> }) {
  const { t } = useTranslation('pages.console-observability-page')
  const announce = useAnnounce()
  const { state } = exporter
  const area = useRef<HTMLDivElement>(null)
  const previous = useRef<string | undefined>(undefined)
  const status = state?.status
  useEffect(() => {
    const before = previous.current
    previous.current = status
    if (status === 'error') area.current?.querySelector<HTMLElement>('[data-export-error]')?.focus()
    // After a retry succeeds the next useful control is the file itself.
    if (status === 'manifest') {
      announce(t('export.readyAnnouncement'))
      if (before === 'running') Array.from(area.current?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === t('export.download'))?.focus()
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  const statusLabels: Record<string, string> = { accepted: t('export.statusAccepted'), completed: t('export.statusCompleted'), failed: t('export.statusFailed'), queued: t('export.statusQueued') }
  let body = null
  if (state?.status === 'running') {
    body = <div role="status" aria-busy={true}><InlineCallout tone="info" title={t('export.progressTitle')} description={t('export.progressDescription')} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} /></div>
  } else if (state?.status === 'manifest') {
    const { manifest } = state
    const label = exportStatus(manifest)
    body = <div role="status" className="space-y-3">
      <InlineCallout tone="success" title={t('export.readyTitle')} actions={[{ label: t('export.download'), variant: 'secondary', onClick: () => download(manifest, manifest.exportId) }]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
        description={<span>{t('export.exportId')} <code className="font-mono text-xs">{manifest.exportId}</code></span>} />
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">{t('export.itemCount')}</dt><dd className="font-medium tabular-nums">{manifest.itemCount}</dd></div>
        <div><dt className="text-muted-foreground">{t('export.maskedCount')}</dt><dd className="font-medium tabular-nums">{manifest.maskedItemCount ?? 0}</dd></div>
        <div><dt className="text-muted-foreground">{t('export.status')}</dt><dd className="font-medium">{label ? statusLabels[label] ?? label : t('export.statusCompleted')}</dd></div>
      </dl>
    </div>
  } else if (state?.status === 'unavailable') {
    const result = state.result
    const code = exportStatus(result)
    const id = exportId(result)
    body = <div role="status"><InlineCallout tone="warning" title={t('export.unavailableTitle')} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
      description={<span className="block space-y-1"><span className="block">{exportMessage(result) ?? (code ? t('export.unavailableStatus', { status: code }) : t('export.unavailableGeneric'))}</span>
        <span className="block">{t('export.unavailableNoFile')}</span>{id && <span className="block">{t('export.request')} <code className="font-mono text-xs">{id}</code></span>}</span>} /></div>
  } else if (state?.status === 'error' && state.failure.status !== 401) {
    const { failure } = state
    body = <div data-export-error tabIndex={-1} className="min-w-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
      {failure.status === 403
        ? <NoAccessEmpty resource={t('export.area')} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
          labels={{ title: () => t('audit.noAccess'), description: () => t('export.noAccessMessage'), request: '', requested: '', sent: '' }} />
        : <ErrorPanel title={t('export.errorTitle')} message={t('export.errorMessage')} code={failure.status ?? null} requestId={failure.requestId} details="" secondaryAction={null} titleAs="h2" announce={true}
          onRetry={exporter.retry} retrying={false} retryLabel={t('export.retry')}
          labels={{ title: t('export.errorTitle'), message: t('export.errorMessage'), support: t('error.support'), retry: t('export.retry'), retrying: t('export.retrying'), retryingStatus: t('export.retrying'),
            requestId: t('error.requestId'), copyRequestId: t('error.copyRequestId'), copied: t('error.copied'), requestIdCopied: t('error.copied'), details: t('error.details') }} />}
    </div>
  }
  return <div ref={area} role="region" aria-label={t('export.area')} className="min-w-0 empty:hidden">{body}</div>
}

function Detail({ record, onClose }: { record: AuditRecord | null; onClose: () => void }) {
  const { t } = useTranslation('pages.console-observability-page')
  const missing = t('detail.missing')
  const items: DescriptionItem[] = record ? [
    { id: 'actor', label: t('detail.actor'), value: `${record.actor.displayName ?? record.actor.actorId} (${record.actor.actorType})` },
    { id: 'resource', label: t('detail.resource'), value: record.resource ? `${record.resource.resourceType} · ${record.resource.resourceId}` : t('detail.noResource') },
    { id: 'correlation', label: t('detail.correlation'), value: record.correlationId ?? missing, mono: true },
    { id: 'origin', label: t('detail.origin'), value: `${record.origin?.originSurface ?? missing} · ${record.origin?.ipAddress ?? t('detail.noIp')}` },
  ] : []
  const viewerLabels = { copyPath: t('json.copyPath'), copyValue: t('json.copyValue'), copied: t('json.copied'), copyFailed: t('json.copyFailed'), selectHint: t('json.selectHint'),
    truncated: t('json.truncated'), copyFullHint: t('json.copyFullHint'), keys: (count: number) => t('json.keys', { count }), items: (count: number) => t('json.items', { count }), root: t('json.root') }
  return <Drawer open={Boolean(record)} onOpenChange={(open) => { if (!open) onClose() }} side="right">
    <DrawerContent size="lg" showClose={true} closeLabel={t('detail.close')} container={undefined}>
      <DrawerHeader><DrawerTitle className="break-all">{t('detail.title', { id: record?.eventId ?? '' })}</DrawerTitle><DrawerDescription>{t('detail.description')}</DrawerDescription></DrawerHeader>
      <DrawerBody className="min-w-0 space-y-4">
        {record && <>
          <DescriptionListCard title={t('detail.summary')} description="" items={items} wrap={true} columns={1} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h3" className="min-w-0"
            labels={{ title: t('detail.summary'), description: '', edit: '', copy: (label) => `${t('json.copyValue')}: ${label}`, copied: (label) => `${t('json.copied')}: ${label}`, copiedToClipboard: t('json.copied') }} />
          <JsonViewer data={{ scope: record.scope, metadata: record.metadata }} label={t('detail.json')} defaultExpandDepth={2} maxDepth={undefined} search="" toolbar={true} maxHeight={288} maxDisplayChars={undefined} emptyContent={undefined} labels={viewerLabels} className="min-w-0" />
        </>}
      </DrawerBody>
    </DrawerContent>
  </Drawer>
}

export function AuditPanel({ filters, onFilters, audit, exporter }: { filters: AuditFilters; onFilters: (filters: AuditFilters) => void; audit: ReturnType<typeof useAudit>; exporter: ReturnType<typeof useExport> }) {
  const { t, i18n } = useTranslation('pages.console-observability-page')
  const announce = useAnnounce()
  const { data } = audit
  const [selected, setSelected] = useState<string | null>(null)
  const returnTo = useRef<string | null>(null)
  const table = useRef<HTMLDivElement>(null)
  const loadedBefore = useRef(0)
  const running = exporter.state?.status === 'running'
  const filterCount = [filters.actorId, filters.category, filters.result, filters.from, filters.to].filter(Boolean).length
  const records = data?.records ?? []
  const record = records.find((item) => item.eventId === selected) ?? null
  const change = (patch: Partial<AuditFilters>) => onFilters({ ...filters, ...patch })
  const status = data?.status
  useEffect(() => { if (status === 'ready') announce(t('audit.loaded', { count: records.length })) }, [status, data?.gen]) // eslint-disable-line react-hooks/exhaustive-deps
  // When Cargar mas disappears with the last page, focus lands on the first appended row.
  useLayoutEffect(() => {
    const first = loadedBefore.current
    loadedBefore.current = records.length
    if (!data?.append.seq || data.hasMore || records.length <= first || first === 0) return
    const id = records[first]?.eventId
    Array.from(table.current?.querySelectorAll<HTMLElement>('[data-audit-event]') ?? []).find((node) => node.dataset.auditEvent === id)?.focus()
  }, [data?.append.seq]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data?.status !== 'ready' || data.append.seq === 0) loadedBefore.current = records.length }, [data?.gen, data?.status]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    const id = selected
    setSelected(null)
    returnTo.current = id
  }
  useEffect(() => {
    if (selected || !returnTo.current) return
    const id = returnTo.current
    returnTo.current = null
    Array.from(table.current?.querySelectorAll<HTMLElement>('[data-audit-event]') ?? []).find((node) => node.dataset.auditEvent === id)?.focus()
  }, [selected])
  const columns: DataTableColumn<AuditRecord>[] = [
    { id: 'event', header: t('audit.event'), sortable: false, variant: 'mono', cell: (row) =>
      <Button type="button" variant="ghost" size="sm" data-audit-event={row.eventId} aria-haspopup="dialog" className="h-auto min-w-0 whitespace-normal break-all p-0 text-left font-mono" onClick={() => setSelected(row.eventId)}>{row.eventId}</Button> },
    { id: 'category', header: t('audit.categoryColumn'), sortable: false, cell: (row) => <Badge tone="neutral" variant="outline">{row.action.category.replace(/_/g, ' ')}</Badge> },
    { id: 'result', header: t('audit.resultColumn'), sortable: false, cell: (row) => {
      const key = outcomeKey(row.result?.outcome ?? 'unknown')
      return <StatusTag status={key} label={t(`audit.result_${key}`)} statuses={{ [key]: { label: t(`audit.result_${key}`), tone: tones[key] } }} uppercase={false} /> } },
    { id: 'date', header: t('audit.date'), sortable: false, cell: (row) => <Timestamp value={row.eventTimestamp} locale={i18n.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'medium' }} live={false} tooltip={false} fallback={row.eventTimestamp} /> },
  ]
  const resultItems = [{ value: '', label: t('audit.resultAll') }, { value: 'success', label: t('audit.resultSuccess') }, { value: 'failure', label: t('audit.resultFailure') }]
  const more = data?.more
  const moreError = more?.status === 'error' ? (more.failure?.requestId ? t('audit.moreErrorId', { requestId: more.failure.requestId }) : t('audit.moreError')) : ''
  return <section aria-label={t('audit.section')} className="min-w-0 space-y-4">
    <PageToolbar search={filters.actorId} defaultSearch="" onSearchChange={(value) => change({ actorId: value })} searchLabel={t('audit.actor')} searchPlaceholder={t('audit.actorPlaceholder')}
      views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('audit.filters')} className="min-w-0"
      filters={<div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field><FieldLabel>{t('audit.category')}</FieldLabel>
          <Input aria-label={t('audit.category')} placeholder={t('audit.categoryPlaceholder')} value={filters.category} onChange={(event) => change({ category: event.target.value })} className="w-full min-w-0" /></Field>
        <Field><FieldLabel>{t('audit.result')}</FieldLabel>
          <SimpleSelect value={filters.result} onValueChange={(value) => change({ result: (value ?? '') as AuditFilters['result'] })} items={resultItems} aria-label={t('audit.result')} placeholder={t('audit.resultAll')} clearable={false} size="md" className="w-full min-w-0" /></Field>
        <Field><FieldLabel>{t('audit.from')}</FieldLabel>
          <DatePicker value={fromDay(filters.from)} onValueChange={(date) => change({ from: toDay(date) })} placeholder={t('audit.fromPlaceholder')} aria-label={t('audit.from')} clearable={true} clearLabel={t('audit.fromClear')} locale={i18n.language} size="md" className="w-full min-w-0" /></Field>
        <Field><FieldLabel>{t('audit.to')}</FieldLabel>
          <DatePicker value={fromDay(filters.to)} onValueChange={(date) => change({ to: toDay(date) })} placeholder={t('audit.toPlaceholder')} aria-label={t('audit.to')} clearable={true} clearLabel={t('audit.toClear')} locale={i18n.language} size="md" className="w-full min-w-0" /></Field>
      </div>} />
    <div className="flex justify-end">
      <Button type="button" variant="primary" className="w-full sm:w-auto" disabled={running} loading={false} aria-busy={running} onClick={exporter.start}>
        <Download aria-hidden={true} className="size-4" />{running ? t('export.running') : t('export.button')}
      </Button>
    </div>
    <ExportArea exporter={exporter} />
    {!data || data.status === 'loading' ? <section role="status" aria-busy={true} aria-label={t('audit.loading')} className="space-y-4">
        <Text>{t('audit.loadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={6} columns={4} label={t('audit.loading')} className="min-w-0" /></div>
      </section>
      : data.status === 'error' ? <FailureState area="audit" failure={data.failure ?? { requestId: '' }} onRetry={audit.retry} />
      : !records.length ? <EmptyState title={t('audit.empty')} description={t('audit.emptyDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false}>
        {filterCount > 0 && <Button type="button" variant="secondary" onClick={() => onFilters({ actorId: '', category: '', result: '', from: '', to: '' })}>{t('audit.clearFilters')}</Button>}
      </EmptyState>
      : <div className="min-w-0 space-y-3">
        <div ref={table} className="min-w-0 max-w-full">
          <DataTable rows={records} columns={columns} getRowId={(row) => row.eventId} getRowLabel={(row) => row.eventId} caption={t('audit.table')} showCaption={false}
            paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
            sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
            resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0"
            labels={{ scrollRegion: t('audit.table'), emptyTitle: t('audit.empty'), emptyDescription: t('audit.emptyDescription'), loading: () => t('audit.loading') }} />
        </div>
        <LoadMoreFooter nextCursor={data.hasMore ? data.nextCursor : null} hasMore={data.hasMore} loading={more?.status === 'loading'} error={moreError}
          onLoadMore={(cursor) => audit.loadMore(cursor)} onRetry={(cursor) => audit.loadMore(cursor)} loadedCount={records.length} lastAppend={data.append} exhaustedFocusTarget="summary" className="min-w-0"
          labels={{ loadMore: t('audit.loadMore'), loading: t('audit.loadingMore'), retry: t('audit.retry'), group: t('audit.moreGroup'), moreAvailable: t('audit.moreAvailable'),
            summary: (count) => t('audit.loadedSummary', { count }), loadedAnnouncement: (count) => t('audit.loadedMore', { count }) }} />
      </div>}
    <Detail record={record} onClose={close} />
  </section>
}
