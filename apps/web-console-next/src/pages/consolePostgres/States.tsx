import { type ComponentProps } from 'react'
import { Button, EmptyState, Field, FieldLabel, Input, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, ErrorPanel, NoAccessEmpty, NotFoundEmpty, SectionHeader, TableSkeleton, type DataTableColumn, type DescriptionItem } from '@gntik-ai/blocks'
import type { Failure } from './api'
import { focusRing, useCopy } from './copy'

export function Action({ children, busy = false, disabled = false, ...props }: Omit<ComponentProps<typeof Button>, 'size' | 'loading'> & { busy?: boolean }) {
  return <Button type="button" size="sm" variant="secondary" loading={busy} disabled={busy || disabled} aria-busy={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props}>{children}</Button>
}
export function Heading({ title, description = '', id, level = 'h2' }: { title: string; description?: string; id?: string; level?: 'h2' | 'h3' }) {
  return <SectionHeader title={title} description={description} count={undefined} actions={[]} as={level} bordered={false} headingId={id} className="min-w-0" />
}
export function Loading({ label }: { label: string }) { return <TableSkeleton rows={3} columns={2} label={label} className="min-w-0" /> }
export function Empty({ title, description = '', action = null }: { title: string; description?: string; action?: ComponentProps<typeof EmptyState>['primaryAction'] }) {
  return <EmptyState icon={undefined} title={title} description={description} titleAs="h3" bordered={false} size="md" primaryAction={action} secondaryAction={null} className="min-w-0" />
}
export function TextField({ id, label, help, placeholder, value, onChange, busy = false, inputRef }: { id: string; label: string; help?: string; placeholder: string; value: string; onChange: (value: string) => void; busy?: boolean; inputRef?: React.Ref<HTMLInputElement> }) {
  return <Field invalid={false} disabled={busy} className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} ref={inputRef} type="text" size="md" value={value} onChange={(event) => onChange(event.target.value)} readOnly={busy} autoComplete="off" spellCheck={false} placeholder={placeholder} aria-describedby={help ? `${id}-help` : undefined} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} />
    {help && <Text id={`${id}-help`} as="p" variant="supporting" tone="muted">{help}</Text>}
  </Field>
}
export function Details({ title, description = '', items }: { title: string; description?: string; items: { id: string; label: string; value: string; render?: DescriptionItem['render'] }[] }) {
  const { t } = useCopy()
  return <DescriptionListCard title={title} description={description} items={items.map((item) => ({ ...item, mono: false, copyable: false, copyValue: undefined, status: undefined }))} wrap={true} columns={1} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h3" className="min-w-0"
    labels={{ title, description, edit: '', copy: () => t('copy'), copied: () => t('copied'), copiedToClipboard: t('copied'), copyFailed: t('copyFailed') }} />
}
export function Table<T extends object>({ rows, columns, id, label }: { rows: T[]; columns: DataTableColumn<T>[]; id: (row: T) => string; label: string }) {
  const { t } = useCopy()
  return <div className="min-w-0 max-w-full"><DataTable rows={rows} columns={columns} getRowId={id} getRowLabel={id} caption={label} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: label, emptyTitle: t('none'), emptyDescription: '', loading: () => t('loading.databases') }} /></div>
}

export function FailureView({ error, section, retry }: { error: Failure; section: string; retry: () => void }) {
  const { t } = useCopy()
  const title = t(error.status === 403 ? 'noAccess' : error.status === 404 ? 'notFound' : `errors.${section}`)
  return <div data-testid={`pg-failure-${section}`} className="min-w-0">
    {error.status === 403 ? <NoAccessEmpty resource={t(section)} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0" labels={{ title: () => title, description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : error.status === 404 ? <NotFoundEmpty icon={undefined} title={title} description={t('notFoundDescription')} action={null} titleAs="h3" bordered={false} className="min-w-0" />
      : <ErrorPanel title={title} message={error.message ?? t(error.status ? 'serverError' : 'networkError')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true} onRetry={async () => retry()} retrying={false} retryLabel={t('retry')} className="min-w-0"
        labels={{ title, message: t('serverError'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
  </div>
}
