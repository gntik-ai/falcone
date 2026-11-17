import { RotateCcw } from 'lucide-react'
import { Alert, Button, Text } from '@gntik-ai/ui'
import { DataTable, SectionHeader, type DataTableColumn } from '@gntik-ai/blocks'
import type { FunctionVersion } from './api'
import { describeFailure, focusRing, formatEnumLabel, formatValue, useCopy } from './copy'
import { Empty, FailurePanel, FunctionStatus, Loading } from './States'
import type { Fn } from './useFunctions'

export const WRITE_REASON_ID = 'functions-write-disabled-reason'

export function VersionsTab({ s }: { s: Fn }) {
  const { t } = useCopy()
  const { versions, rollbackOp } = s
  const items = versions.data?.items ?? []
  const eligible = items.filter((item) => item.rollbackEligible)
  const columns: DataTableColumn<FunctionVersion>[] = [
    { id: 'version', header: t('versions.version'), sortable: false, hideable: false, variant: 'numeric', align: 'left', cell: (row) => formatValue(t, row.versionNumber) },
    { id: 'versionId', header: t('versions.versionId'), sortable: false, variant: 'mono', cell: (row) => <span className="block max-w-40 break-all whitespace-normal">{row.versionId}</span> },
    { id: 'status', header: t('versions.status'), sortable: false, cell: (row) => <FunctionStatus value={row.status} /> },
    { id: 'origin', header: t('versions.origin'), sortable: false, cell: (row) => formatEnumLabel(row.originType) },
    { id: 'createdAt', header: t('versions.createdAt'), sortable: false, className: 'text-muted-foreground', cell: (row) => <span className="block whitespace-normal break-words">{formatValue(t, row.timestamps?.createdAt)}</span> },
  ]
  let body
  if (versions.failure) body = <FailurePanel section="versions" failure={versions.failure} retry={s.retryVersions} retrying={versions.phase === 'loading'} />
  else if (versions.phase !== 'ok') body = <Loading label={t('versions.loading')} rows={3} columns={5} />
  else if (items.length === 0) body = <Empty title={t('versions.empty')} testId="functions-versions-empty" />
  else body = <>
    <DataTable rows={items} columns={columns} getRowId={(row) => row.versionId} getRowLabel={(row) => String(row.versionNumber ?? row.versionId)} caption={t('versions.caption')} showCaption={false} paginated={false}
      selectionMode="single" selectionName="rollback-version" aria-label={t('versions.legend')} selectedId={s.rollbackTarget} onSelectedIdChange={s.setRollbackTarget} isRowDisabled={(row) => !row.rollbackEligible || s.writeBlocked}
      rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false}
      views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0"
      labels={{ scrollRegion: t('versions.caption'), selection: t('versions.selection'), selectRow: (label: string) => label, emptyTitle: t('versions.empty'), emptyDescription: t('versions.empty'), loading: () => t('versions.loading') }} />
    <div className="min-w-0 space-y-3">
      <Button type="button" variant="primary" size="md" loading={false} disabled={s.writeBlocked || eligible.length === 0 || !s.rollbackTarget || rollbackOp.busy} iconOnly={false} icon={RotateCcw as never} trailingIcon={undefined}
        aria-describedby={s.writeReason ? WRITE_REASON_ID : undefined} aria-busy={rollbackOp.busy} className={focusRing} onClick={() => void s.rollback()}>{rollbackOp.busy ? t('versions.rollingBack') : t('versions.rollback')}</Button>
      {eligible.length === 0 && <Text as="p" variant="body" tone="muted">{t('versions.noneEligible')}</Text>}
      {rollbackOp.failure && <FailurePanel section="rollback" failure={rollbackOp.failure} message={describeFailure(t, rollbackOp.failure, 'rollback')} retry={() => void s.rollback()} retrying={rollbackOp.busy} />}
      {rollbackOp.data && <div role="status" data-testid="functions-rollback-result"><Alert tone="success" title={t('versions.accepted', { status: rollbackOp.data.status })} description={rollbackOp.data.requestedVersionId} actions={undefined} icon={undefined} onDismiss={undefined} dismissLabel="" /></div>}
    </div>
  </>
  return <section aria-label={t('versions.title')} className="min-w-0 space-y-4" data-testid="functions-versions">
    <SectionHeader title={t('versions.title')} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
    {body}
  </section>
}
