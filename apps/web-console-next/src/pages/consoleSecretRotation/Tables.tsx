import { useTranslation } from 'react-i18next'
import { EmptyState, PaginationCompact, StatusTag, Text, Timestamp } from '@gntik-ai/ui'
import { DataTable, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { SecretConsumerStatus } from './api'
import { ReadFailure } from './States'
import { useConsumers, useHistory } from './useRotationReads'
import { formatRotationTime } from './formatTime'

type Row = Record<string, unknown>
function RotationTable<T>({ rows, columns, label, rowId }: { rows: T[]; columns: DataTableColumn<T>[]; label: string; rowId: (row: T) => string }) {
  const { t } = useTranslation('pages.console-secret-rotation-page')
  return <DataTable rows={rows} columns={columns} getRowId={rowId} getRowLabel={() => label} caption={label} showCaption={false} paginated={false}
    selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null}
    showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="rotation-table min-w-0"
    labels={{ scrollRegion: label, emptyTitle: t('emptyTitle'), emptyDescription: t('emptyDescription'), loading: () => t('loading') }} />
}
export function RotationLists({ path }: { path: string }) {
  const { t, i18n } = useTranslation('pages.console-secret-rotation-page')
  const history = useHistory(path), consumers = useConsumers(path)
  const fallback = (value: unknown) => String(value ?? t('missing'))
  const historyColumns: DataTableColumn<Row>[] = [
    { id: 'event', header: t('event'), sortable: false, cell: (row) => fallback(row.event_type ?? row.eventType) },
    { id: 'actor', header: t('actor'), sortable: false, cell: (row) => fallback(row.actor_id ?? row.actorId) },
    { id: 'time', header: t('occurredAt'), sortable: false, cell: (row) => (row.occurred_at ?? row.occurredAt) ? <Timestamp value={String(row.occurred_at ?? row.occurredAt)} locale={i18n.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} live={false} tooltip={false} fallback={t('missing')} /> : t('missing') },
    { id: 'new', header: t('versionNew'), sortable: false, cell: (row) => fallback(row.vault_version_new ?? row.vaultVersionNew) },
    { id: 'old', header: t('versionOld'), sortable: false, cell: (row) => fallback(row.vault_version_old ?? row.vaultVersionOld) },
  ]
  type Consumer = SecretConsumerStatus['consumers'][number]
  const consumerColumns: DataTableColumn<Consumer>[] = [
    { id: 'id', header: t('consumer'), sortable: false, cell: (row) => row.consumer_id },
    { id: 'mechanism', header: t('mechanism'), sortable: false, cell: (row) => row.reload_mechanism },
    { id: 'state', header: t('state'), sortable: false, cell: (row) => <StatusTag status={row.state} label={t(['confirmed', 'pending', 'timeout'].includes(row.state) ? `states.${row.state}` : 'states.unknown')} statuses={{ confirmed: { label: t('states.confirmed'), tone: 'success' }, pending: { label: t('states.pending'), tone: 'warning' }, timeout: { label: t('states.timeout'), tone: 'destructive' } }} variant="soft" size="sm" shape="rounded" uppercase={false} /> },
  ]
  const empty = (section: 'history' | 'consumers') => <EmptyState title={t(`${section}Empty`)} description={t(`${section}EmptyDescription`)} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false} className="min-w-0" />
  const skeleton = (columns: number) => <div role="status" aria-label={t('loading')} aria-busy={true}><TableSkeleton rows={3} columns={columns} label={t('loading')} className="min-w-0" /></div>
  return <div className="min-w-0 space-y-8">
    <section aria-labelledby="rotation-history-heading" className="min-w-0 space-y-4" data-testid="rotation-history">
      <SectionHeader title={t('historyTitle')} description={t('historyCount', { count: history.data?.total ?? 0 })} count={history.data?.total ?? 0} actions={[]} as="h2" bordered={false} headingId="rotation-history-heading" className="min-w-0" />
      {history.failure ? <ReadFailure failure={history.failure} section="history" retry={history.retry} /> : !history.data ? skeleton(5) : !history.data.items.length ? empty('history') : <RotationTable rows={history.data.items} columns={historyColumns} label={t('historyTitle')} rowId={(row) => String(history.data!.items.indexOf(row))} />}
      {history.data && history.data.total > 20 && <PaginationCompact page={Math.floor(history.offset / 20) + 1} pageSize={20} total={history.data.total} onPageChange={(page) => history.setOffset((page - 1) * 20)} locale={i18n.language} ofLabel={t('of')} size="sm" labels={{ nav: t('pagination'), previous: t('previous'), next: t('next') }} className="min-w-0 flex-wrap gap-3" />}
    </section>
    <section aria-labelledby="rotation-consumers-heading" className="min-w-0 space-y-4" data-testid="rotation-consumers">
      <SectionHeader title={t('consumersTitle')} description={t('consumerCount', { count: consumers.data?.consumers.length ?? 0 })} count={consumers.data?.consumers.length ?? 0} actions={[]} as="h2" bordered={false} headingId="rotation-consumers-heading" className="min-w-0" />
      {consumers.failure && <ReadFailure failure={consumers.failure} section="consumers" retry={consumers.retry} />}
      {consumers.failure && consumers.data && <Text as="p" variant="supporting" tone="warning">{t('stale', { time: formatRotationTime(consumers.updatedAt, i18n.language, t('missing')) })}</Text>}
      {!consumers.data ? !consumers.failure && skeleton(3) : consumers.data.consumers.length ? <RotationTable rows={consumers.data.consumers} columns={consumerColumns} label={t(consumers.failure ? 'staleTable' : 'consumersTitle')} rowId={(row) => row.consumer_id} /> : !consumers.failure && empty('consumers')}
    </section>
  </div>
}
