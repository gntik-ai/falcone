import { type ComponentProps, type Ref } from 'react'
import { Button, EmptyState, Field, FieldLabel, Input, SimpleSelect, Text } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, FirstRunEmpty, NoAccessEmpty, NoResultsEmpty, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { Failure } from './api'
import { focusRing, useCopy } from './copy'

export function Action({ children, disabled = false, variant = 'secondary', ...props }: Omit<ComponentProps<typeof Button>, 'size' | 'loading' | 'variant'> & { variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' }) {
  return <Button type="button" size="sm" variant={variant} loading={false} disabled={disabled} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props}>{children}</Button>
}
export function Heading({ title, description = '', id, level = 'h2', count }: { title: string; description?: string; id?: string; level?: 'h2' | 'h3'; count?: number }) {
  return <SectionHeader title={title} description={description} count={count} actions={[]} as={level} bordered={false} headingId={id} className="min-w-0" />
}
export function Loading({ label }: { label: string }) { return <TableSkeleton rows={3} columns={3} label={label} className="min-w-0" /> }
export function Prompt({ title }: { title: string }) {
  return <FirstRunEmpty icon={undefined} title={title} description="" actionLabel={null} onAction={undefined} secondary={null} steps={[]} titleAs="h2" bordered={false} className="min-w-0" />
}
export function Empty({ title, description = '', action = null }: { title: string; description?: string; action?: ComponentProps<typeof EmptyState>['primaryAction'] }) {
  return <EmptyState icon={undefined} role="status" title={title} description={description} titleAs="h2" bordered={false} size="md" primaryAction={action} secondaryAction={null} className="min-w-0" />
}
export function NoRows({ title, description, entity }: { title: string; description: string; entity: string }) {
  return <NoResultsEmpty query="" filterCount={0} entity={entity} onClearFilters={undefined} onClearSearch={undefined} titleAs="h3" bordered={false} className="min-w-0"
    labels={{ title: () => title, description: () => description, queryTitle: () => title, clearFilters: '', clearSearch: '' }} />
}
export function TextField({ id, label, help, placeholder, value, onChange, inputRef, disabled = false }: { id: string; label: string; help?: string; placeholder?: string; value: string; onChange: (value: string) => void; inputRef?: Ref<HTMLInputElement>; disabled?: boolean }) {
  return <Field invalid={false} disabled={disabled} className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} ref={inputRef} type="text" size="md" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder={placeholder} aria-describedby={help ? `${id}-help` : undefined} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} />
    {help && <Text id={`${id}-help`} as="p" variant="supporting" tone="muted">{help}</Text>}
  </Field>
}
export function Choice<V extends string>({ id, label, value, items, onChange }: { id: string; label: string; value: V; items: { value: V; label: string }[]; onChange: (value: V) => void }) {
  return <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <SimpleSelect id={id} value={value} defaultValue={value} placeholder={label} clearable={false} size="md" items={items} onValueChange={(next) => { if (next) onChange(next as V) }} className={`w-full min-w-0 ${focusRing}`} />
  </Field>
}

export function DataGrid<T extends object>({ rows, columns, id, label, rowLabel, loadingLabel, emptyTitle }: { rows: T[]; columns: DataTableColumn<T>[]; id: (row: T) => string; label: string; rowLabel?: (row: T) => string; loadingLabel: string; emptyTitle: string }) {
  return <div className="min-w-0 max-w-full"><DataTable rows={rows} columns={columns} getRowId={id} getRowLabel={rowLabel ?? id} caption={label} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: label, emptyTitle, emptyDescription: '', loading: () => loadingLabel }} /></div>
}

type Section = 'rows' | 'keys' | 'workspace'
// Workspace failures always keep Reintentar, 403 included. Rows and key lists show a no-access state on 403.
export function FailureView({ error, section, retry, back }: { error: Failure; section: Section; retry: () => void; back?: ComponentProps<typeof EmptyState>['primaryAction'] }) {
  const { t } = useCopy()
  const noAccess = error.status === 403 && section !== 'workspace', notFound = error.status === 404 && section === 'rows'
  const title = t(noAccess ? 'noAccess' : notFound ? 'notFound' : `errors.${section}`)
  return <div data-testid={`pgdata-failure-${section}`} className="min-w-0">
    {noAccess ? <NoAccessEmpty resource={t(`resources.${section}`)} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0"
        labels={{ title: () => title, description: () => t(`noAccessDescription.${section}`), request: '', requested: '', sent: '' }} />
      : notFound ? <EmptyState icon={undefined} role="status" title={title} description={t('notFoundDescription')} titleAs="h3" bordered={false} size="md" primaryAction={back ?? null} secondaryAction={null} className="min-w-0" />
      : <ErrorPanel title={title} message={t(error.status ? 'serverError' : 'networkError')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true} onRetry={async () => retry()} retrying={false} retryLabel={t('retry')} className="min-w-0"
        labels={{ title, message: t('serverError'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
  </div>
}
