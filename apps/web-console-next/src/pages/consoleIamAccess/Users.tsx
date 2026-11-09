import { useLayoutEffect, useRef } from 'react'
import { EnableIcon, SuspendIcon, TrashIcon } from './icons'
import { Button, Pagination, SimpleTooltip, StatusTag, Text } from '@gntik-ai/ui'
import { DataTable, PageToolbar, SectionHeader, type DataTableColumn } from '@gntik-ai/blocks'
import { ActionButton, Empty } from './States'
import { focusRing, useCopy } from './copy'
import { USERS_PAGE_SIZE, isSuspended, userIdOf, type IamUser } from './api'

interface Props {
  total: number
  loaded: number
  loading: boolean
  busy: boolean
  search: string
  filtered: IamUser[]
  paged: IamUser[]
  page: number
  pageCount: number
  selectedUserId: string | null
  onSearch: (value: string) => void
  onClearSearch: () => void
  onPage: (page: number) => void
  onReload: () => void
  onSelect: (userId: string) => void
  onStatus: (user: IamUser, enabled: boolean, focusKey: string) => void
  onDelete: (user: IamUser, opener: HTMLElement) => void
  onCreateFocus: () => void
}

export function Users({ total, loaded, loading, busy, search, filtered, paged, page, pageCount, selectedUserId, onSearch, onClearSearch, onPage, onReload, onSelect, onStatus, onDelete, onCreateFocus }: Props) {
  const { t } = useCopy()
  const toolbar = useRef<HTMLDivElement>(null)
  // PageToolbar owns its search input, so the legacy focus key is attached to it after each commit.
  useLayoutEffect(() => { toolbar.current?.querySelector('input[type="search"]')?.setAttribute('data-focus-key', 'users-search') })
  const from = filtered.length ? (page - 1) * USERS_PAGE_SIZE + 1 : 0
  const to = Math.min(page * USERS_PAGE_SIZE, filtered.length)
  const hint = loading ? t('users.updating') : total > loaded ? t('users.partial', { loaded, total }) : t('users.hint')
  const columns: DataTableColumn<IamUser>[] = [
    { id: 'username', header: t('users.columns.username'), sortable: false, headClassName: 'w-48', cell: (user) => {
      const id = userIdOf(user), selected = selectedUserId === id
      return <div className="min-w-0">
        <button type="button" data-focus-key={`user-row-${id}`} aria-pressed={selected} onClick={() => onSelect(id)}
          className={`inline-flex min-h-6 min-w-6 max-w-full items-center text-left font-medium text-foreground underline-offset-4 hover:underline ${selected ? 'underline' : ''} ${focusRing}`}>{user.username}</button>
        <span className="block break-all font-mono text-xs text-muted-foreground">{id}</span>
      </div>
    } },
    { id: 'email', header: t('users.columns.email'), sortable: false, cell: (user) => user.email ?? t('users.noEmail') },
    { id: 'status', header: t('users.columns.status'), sortable: false, cell: (user) => <StatusTag status={isSuspended(user) ? 'suspended' : 'active'} label={t(isSuspended(user) ? 'users.suspended' : 'users.active')} statuses={{ active: { label: t('users.active'), tone: 'success' }, suspended: { label: t('users.suspended'), tone: 'neutral' } }} variant="soft" size="sm" shape="rounded" uppercase={false} /> },
    { id: 'actions', header: t('users.columns.actions'), sortable: false, align: 'right', cell: (user) => {
      const id = userIdOf(user), suspended = isSuspended(user), key = `status-user-row-${id}`
      const name = t(suspended ? 'users.enableNamed' : 'users.suspendNamed', { name: user.username })
      const remove = t('users.deleteNamed', { name: user.username })
      const tip = { side: 'top' as const, align: 'center' as const, kbd: '', variant: 'solid' as const, arrow: true, delay: 300, disabled: false, className: 'max-w-xs' }
      return <div className="flex justify-end gap-1.5">
        <SimpleTooltip content={name} {...tip}><Button type="button" variant="secondary" size="sm" iconOnly={true} icon={suspended ? EnableIcon : SuspendIcon} trailingIcon={undefined} loading={false} data-focus-key={key} disabled={busy} aria-label={name} className={focusRing} onClick={() => onStatus(user, suspended, key)} /></SimpleTooltip>
        <SimpleTooltip content={remove} {...tip}><Button type="button" variant="destructive" size="sm" iconOnly={true} icon={TrashIcon} trailingIcon={undefined} loading={false} data-focus-key={`delete-user-${id}`} disabled={busy} aria-label={remove} className={focusRing} onClick={(event) => onDelete(user, event.currentTarget)} /></SimpleTooltip>
      </div>
    } },
  ]
  return <section aria-labelledby="iam-users-heading" aria-busy={loading} className="min-w-0 space-y-4">
    <SectionHeader title={t('users.heading', { count: filtered.length })} description={hint} count={undefined} actions={[]} as="h2" headingId="iam-users-heading" bordered={false} className="min-w-0" />
    <div ref={toolbar} className="min-w-0">
      <PageToolbar search={search} defaultSearch="" onSearchChange={onSearch} searchLabel={t('users.searchLabel')} searchPlaceholder={t('users.searchPlaceholder')} filters={null} views={[]} view="" defaultView="" onViewChange={undefined} aria-label={t('users.toolbar')} className="min-w-0"
        primaryAction={{ id: 'reload', label: t(loading ? 'users.reloading' : 'users.reload'), variant: 'secondary', disabled: loading || busy, onClick: onReload }} />
    </div>
    <Text as="p" variant="body" tone="muted" role="status" aria-live="polite" id="iam-users-pagination-status">{t('users.pageStatus', { page, pages: pageCount })}</Text>
    {loaded === 0 && !loading
      ? <Empty title={t('users.empty.title')} description={t('users.empty.description')} action={<ActionButton onClick={onCreateFocus}>{t('users.empty.action')}</ActionButton>} />
      : filtered.length === 0
        ? <Empty title={t('users.noResults.title')} description={t('users.noResults.description')} action={<ActionButton onClick={onClearSearch}>{t('users.noResults.action')}</ActionButton>} />
        : <>
          <DataTable<IamUser> rows={paged} columns={columns} getRowId={userIdOf} getRowLabel={(user) => user.username} caption={t('users.tableLabel')} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false}
            rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]}
            hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0 iam-users-table" labels={{ scrollRegion: t('users.tableLabel'), emptyTitle: t('users.noResults.title'), emptyDescription: '', loading: () => t('loading.title') }} />
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <Text as="p" variant="body" tone="muted">{t('users.summary', { from, to, total: filtered.length })}</Text>
            <Pagination page={page} pageCount={pageCount} onPageChange={onPage} size="sm" siblingCount={1} labels={{ nav: t('users.pagination'), previous: t('users.previous'), next: t('users.next'), page: (value: number) => t('users.pageNamed', { page: value }) }} />
          </div>
        </>}
  </section>
}
