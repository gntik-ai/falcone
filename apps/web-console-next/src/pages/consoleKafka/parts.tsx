import { ServerCrash } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button, EmptyState, StatusTag, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, ErrorPanel, InlineCallout, NoAccessEmpty, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import { focusRing, useCopy, useFormat } from './copy'
import type { Failure } from './api'
import { statusMessage } from './hooks'

export function Action({ children, disabled = false, ...props }: Omit<ComponentProps<typeof Button>, 'size' | 'loading' | 'variant'>) {
  return <Button type="button" size="sm" variant="secondary" loading={false} disabled={disabled} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props}>{children}</Button>
}
export function Heading({ title, level = 'h2', actions = [] }: { title: string; level?: 'h2' | 'h3'; actions?: ComponentProps<typeof SectionHeader>['actions'] }) {
  return <SectionHeader title={title} description="" count={undefined} actions={actions} as={level} bordered={false} headingId={undefined} className="min-w-0" />
}
export function Loading({ label }: { label: string }) { return <TableSkeleton rows={3} columns={2} label={label} className="min-w-0" /> }
export function Empty({ title, action = null }: { title: string; action?: ComponentProps<typeof EmptyState>['primaryAction'] }) {
  return <EmptyState icon={undefined} role="status" title={title} description="" titleAs="h3" bordered={false} size="md" primaryAction={action} secondaryAction={null} className="min-w-0" />
}
export function Notice({ children, tone = 'destructive' }: { children: ReactNode; tone?: 'destructive' | 'warning' }) {
  return <InlineCallout tone={tone} title={null} description={children as ComponentProps<typeof InlineCallout>['description']} icon={undefined} actions={[]} labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} open={true} dismissible={false} onDismiss={undefined} className="min-w-0" />
}
export function Status({ value }: { value?: string }) {
  const { formatEnumLabel, statusTone } = useFormat()
  return <StatusTag status={value ?? ''} label={formatEnumLabel(value)} statuses={{ [value ?? '']: { label: formatEnumLabel(value), tone: statusTone(value) } }} uppercase={false} variant="soft" size="sm" shape="rounded" className="" />
}
export function Values({ title, items, raw = false }: { title: string; items: Array<{ label: string; value: unknown }>; raw?: boolean }) {
  const { t } = useCopy(), { formatValue } = useFormat()
  return <DescriptionListCard title={title} description="" items={items.map((item, index) => ({ id: String(index), label: item.label, value: raw ? String(item.value ?? t('missingValueLabel')) : formatValue(item.value), render: undefined, status: undefined, mono: false, copyable: false, copyValue: undefined }))} wrap={true} columns={2} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h3" className="min-w-0"
    labels={{ title, description: '', edit: '', copy: () => t('copy'), copied: () => t('copied'), copiedToClipboard: t('copied'), copyFailed: t('couldNotCopy') }} />
}
export function Grid<T extends object>({ rows, columns, id, label }: { rows: T[]; columns: DataTableColumn<T>[]; id: (row: T) => string; label: string }) {
  const { t } = useCopy()
  // Callers own empty-state copy; an empty table keeps its headers without kit fallback content.
  return <div className="min-w-0 max-w-full"><DataTable rows={rows} columns={columns} getRowId={id} getRowLabel={id} caption={label} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={<></>} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: label, emptyTitle: '', emptyDescription: '', loading: () => t('loadingInventory') }} /></div>
}
export function FailurePanel({ error, title, noAccess, retry, retrying = false, back }: { error: Failure; title: string; noAccess: string; retry: () => void | Promise<void>; retrying?: boolean; back?: () => void }) {
  const { t } = useCopy()
  if (error.status === 403) return <NoAccessEmpty resource={title} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0" labels={{ title: () => noAccess, description: () => '', request: '', requested: '', sent: '' }} />
  if (error.status === 404 && back) return <Empty title={t('theTopicIsNoLongerAvailable')} action={<Action onClick={back}>{t('backToInventory')}</Action>} />
  return <ErrorPanel icon={ServerCrash as unknown as ComponentProps<typeof ErrorPanel>['icon']} title={title} message={statusMessage((key) => key === 'sectionFallback' ? title : t(key), error, 'sectionFallback')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true} onRetry={async () => { await retry() }} retrying={retrying} retryLabel={t('retry')} className="min-w-0"
    labels={{ title, message: title, support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('detail') }} />
}
export function Section<T>({ state, title, loading, noAccess, back, children }: { state: { loading: boolean; error: Failure | null; data: T | null; reload: () => Promise<void> }; title: string; loading: string; noAccess: string; back?: () => void; children: (data: T) => ReactNode }) {
  return <div className="min-w-0 space-y-4">{state.error ? <FailurePanel error={state.error} title={title} noAccess={noAccess} retry={state.reload} retrying={state.loading} back={back} /> : state.loading ? <Loading label={loading} /> : state.data ? children(state.data) : null}</div>
}
export function Muted({ children }: { children: ReactNode }) { return <Text as="p" variant="body" tone="muted">{children}</Text> }
