import { type ComponentProps, type ReactNode } from 'react'
import { Button, EmptyState, Field, FieldLabel, Input, Text } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, FirstRunEmpty, NoAccessEmpty, NoResultsEmpty, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { Failure } from './api'
import { focusRing, useCopy } from './copy'

export function Action({ children, busy = false, disabled = false, variant = 'secondary', ...props }: Omit<ComponentProps<typeof Button>, 'size' | 'loading'> & { busy?: boolean }) {
  return <Button type="button" size="sm" variant={variant} loading={busy} disabled={busy || disabled} aria-busy={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props}>{children}</Button>
}
export function Heading({ title, description = '', id, level = 'h2', actions = [] }: { title: string; description?: string; id?: string; level?: 'h2' | 'h3'; actions?: ComponentProps<typeof SectionHeader>['actions'] }) {
  return <SectionHeader title={title} description={description} count={undefined} actions={actions} as={level} bordered={false} headingId={id} className="min-w-0" />
}
export function Loading({ label }: { label: string }) { return <TableSkeleton rows={3} columns={3} label={label} className="min-w-0" /> }
export function Empty({ title, description = '', action = null }: { title: string; description?: string; action?: ComponentProps<typeof EmptyState>['primaryAction'] }) {
  return <EmptyState icon={undefined} title={title} description={description} titleAs="h3" bordered={false} size="md" primaryAction={action} secondaryAction={null} className="min-w-0" />
}
export function FirstRun({ title, description }: { title: string; description: string }) {
  return <FirstRunEmpty icon={undefined} title={title} description={description} actionLabel={null} onAction={undefined} secondary={null} steps={[]} labels={{ title, description, action: '', guide: '' }} titleAs="h3" bordered={false} className="min-w-0" />
}
export function NoResults({ title, description }: { title: string; description: string }) {
  return <NoResultsEmpty query="" filterCount={0} entity="" onClearFilters={undefined} onClearSearch={undefined} titleAs="h3" bordered={false} className="min-w-0"
    labels={{ queryTitle: () => title, title: () => title, description: () => description, clearFilters: '', clearSearch: '' }} />
}
export function TextField({ id, label, placeholder, value, onChange, inputRef, disabled = false }: { id: string; label: string; placeholder?: string; value: string; onChange: (value: string) => void; inputRef?: React.Ref<HTMLInputElement>; disabled?: boolean }) {
  return <Field invalid={false} disabled={disabled} className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} ref={inputRef} type="text" size="md" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder={placeholder} aria-describedby={undefined} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} />
  </Field>
}
export function Table<T extends object>({ rows, columns, id, label }: { rows: T[]; columns: DataTableColumn<T>[]; id: (row: T, index: number) => string; label: string }) {
  const { t } = useCopy()
  const keys = new Map(rows.map((row, index) => [row, id(row, index)]))
  return <div className="min-w-0 max-w-full"><DataTable rows={rows} columns={columns} getRowId={(row) => keys.get(row) ?? ''} getRowLabel={(row) => keys.get(row) ?? ''} caption={label} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: label, emptyTitle: t('none'), emptyDescription: '', loading: () => label }} /></div>
}

// A failed load. 403 is a no-access state, 5xx and network errors are error-panels with Reintentar.
// The 404 state is the caller's, because only the rows read has a Volver action.
export function FailureView({ error, section, message, retry, testId }: { error: Failure; section: string; message: string; retry: () => void; testId: string }) {
  const { t } = useCopy()
  const title = t(error.status === 403 ? 'noAccess' : message)
  const body: ReactNode = error.status === 403
    ? <NoAccessEmpty resource={section} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0" labels={{ title: () => title, description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
    : <ErrorPanel title={title} message={t(error.status ? 'serverError' : 'networkError')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true} onRetry={async () => retry()} retrying={false} retryLabel={t('retry')} className="min-w-0"
        labels={{ title, message: t('serverError'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
  return <div data-testid={testId} className="min-w-0">{body}</div>
}
export function Note({ children }: { children: ReactNode }) { return <Text as="p" variant="body" tone="muted">{children}</Text> }
