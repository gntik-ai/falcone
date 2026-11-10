import { useLayoutEffect, useRef } from 'react'
import { Badge, Button, Text, Timestamp } from '@gntik-ai/ui'
import { DataTable, SectionHeader, type DataTableColumn } from '@gntik-ai/blocks'
import { readSecretName, secretEnvVarName, type WorkspaceSecret } from './api'
import { describeSecretError, focusRing, useCopy } from './copy'
import { SECTION_TITLE_ID } from './focus'
import { FailurePanel } from './States'
import type { ListState } from './useWorkspaceSecrets'

interface Props {
  list: ListState
  workspaceLabel: string
  environment: string | null
  locale: string
  onReplace: (secret: WorkspaceSecret) => void
  onDelete: (secret: WorkspaceSecret) => void
  onLoadMore: () => void
  onRetryNext: () => void
}

const hideBelowMd = 'hidden md:table-cell'
const hideBelowLg = 'hidden lg:table-cell'
const hideBelowXl = 'hidden xl:table-cell'
// Identifiers wrap on word boundaries; names too long for their column break anywhere so the actions
// column is never pushed out of the table scroll region.
const identifier = (value: string) => `max-w-[18rem] whitespace-normal break-words ${value.length > 40 ? 'break-all' : ''}`

export function SecretsTable({ list, workspaceLabel, environment, locale, onReplace, onDelete, onLoadMore, onRetryNext }: Props) {
  const { t } = useCopy()
  const root = useRef<HTMLDivElement>(null)
  // The kit renders every body cell as td; the name cell identifies its row, so it is exposed as the row header.
  useLayoutEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('tbody tr[data-row-id]').forEach((row) => {
      const cell = row.firstElementChild as HTMLElement | null
      if (!cell) return
      cell.setAttribute('role', 'rowheader')
      cell.dataset.secretRowHeader = row.dataset.rowId ?? ''
    })
  })
  const date = (value: string | null | undefined) => {
    if (!value) return t('list.none')
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value : <Timestamp value={parsed} format="absolute" locale={locale} dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} tooltip={false} live={false} />
  }
  const columns: DataTableColumn<WorkspaceSecret>[] = [
    { id: 'name', header: t('list.name'), sortable: false, hideable: false, className: 'max-w-[18rem] whitespace-normal break-words font-medium text-foreground', headClassName: 'whitespace-nowrap', cell: (row) => <span className={identifier(readSecretName(row))}>{readSecretName(row)}</span> },
    { id: 'envVar', header: t('list.envVar'), sortable: false, className: 'whitespace-normal', cell: (row) => <code className="inline-block max-w-[16rem] break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{secretEnvVarName(readSecretName(row))}</code> },
    { id: 'functions', header: t('list.functions'), sortable: false, variant: 'numeric', align: 'left', accessor: (row) => row.resolvedRefCount ?? 0 },
    { id: 'created', header: t('list.created'), sortable: false, className: `${hideBelowLg} text-muted-foreground`, headClassName: hideBelowLg, cell: (row) => date(row.timestamps?.createdAt) },
    { id: 'updated', header: t('list.updated'), sortable: false, className: `${hideBelowXl} text-muted-foreground`, headClassName: hideBelowXl, cell: (row) => date(row.timestamps?.updatedAt) },
    { id: 'description', header: t('list.description'), sortable: false, className: `${hideBelowMd} max-w-[16rem] whitespace-normal break-words text-muted-foreground`, headClassName: hideBelowMd, cell: (row) => row.description || t('list.none') },
    { id: 'actions', header: t('list.actions'), sortable: false, align: 'right', cell: (row) => <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="secondary" size="sm" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} data-secret-action="replace" data-secret-name={readSecretName(row)} aria-label={t('list.replaceAria', { name: readSecretName(row) })} onClick={() => onReplace(row)}>{t('list.replace')}</Button>
      <Button type="button" variant="destructive" size="sm" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} data-secret-action="delete" data-secret-name={readSecretName(row)} aria-label={t('list.deleteAria', { name: readSecretName(row) })} onClick={() => onDelete(row)}>{t('list.delete')}</Button>
    </div> },
  ]
  const paged = Boolean(list.nextCursor) || list.next.loading || Boolean(list.next.failure)
  return <section aria-labelledby={SECTION_TITLE_ID} aria-busy={list.refreshing} className="min-w-0 space-y-3" data-testid="workspace-secrets-list">
    <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <SectionHeader title={t('list.title')} description={environment ? t('list.scopeEnvironment', { workspace: workspaceLabel, environment }) : t('list.scope', { workspace: workspaceLabel })} count={undefined} actions={[]} as="h2" bordered={false} headingId={SECTION_TITLE_ID} className="min-w-0" />
      <Badge tone="neutral" variant="outline" size="md" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('list.count', { count: list.rows.length })}</Badge>
    </div>
    <Text as="p" variant="supporting" tone="muted"><span className="font-medium text-foreground">{t('list.functions')}</span> {t('list.functionsNote')}</Text>
    <div ref={root} className="min-w-0 max-w-full">
      <DataTable rows={list.rows} columns={columns} getRowId={readSecretName} getRowLabel={readSecretName} caption={t('list.caption')} showCaption={false}
        paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
        sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
        resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false}
        labels={{ scrollRegion: t('list.ariaLabel'), emptyTitle: t('empty.title'), emptyDescription: t('empty.title'), loading: () => t('loading.title') }} />
    </div>
    {paged && <div role="group" aria-label={t('paging.group')} aria-busy={list.next.loading} className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Text as="p" variant="supporting" tone="muted" aria-live="polite" aria-atomic={true}>{t('paging.summary', { count: list.rows.length })}{list.nextCursor ? ` ${t('paging.moreAvailable')}` : ''}</Text>
      {list.nextCursor && <Button type="button" variant="secondary" size="md" loading={list.next.loading} disabled={list.next.loading || list.refreshing} aria-busy={list.next.loading} iconOnly={false} icon={undefined} trailingIcon={undefined} className={`w-full sm:w-auto ${focusRing}`} onClick={onLoadMore}>{list.next.loading ? t('paging.loadingMore') : t('paging.loadMore')}</Button>}
    </div>}
    {list.next.failure && <FailurePanel target="next" title={t('pageError.title')} message={describeSecretError(t, list.next.failure, 'list')} failure={list.next.failure} retry={onRetryNext} retrying={list.next.loading} />}
  </section>
}
