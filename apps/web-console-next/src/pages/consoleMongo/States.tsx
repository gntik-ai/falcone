import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { Badge, Button, EmptyState, Field, FieldLabel, Input, StatusTag, Text } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, NoAccessEmpty, NotFoundEmpty, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { Failure } from './api'
import { focusRing, useCopy } from './copy'

// The panel also holds a copy-request-id button, so Reintentar is found by its label.
export const retryButton = (root: HTMLElement | null, label: string) => Array.from(root?.querySelectorAll<HTMLElement>('button') ?? []).find((node) => node.textContent?.trim() === label)

export function Action({ children, busy = false, disabled = false, ...props }: Omit<ComponentProps<typeof Button>, 'size' | 'loading'> & { busy?: boolean }) {
  return <Button type="button" size="sm" variant="secondary" loading={busy} disabled={busy || disabled} aria-busy={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props}>{children}</Button>
}
export function Heading({ title, description = '', id, level = 'h2', count }: { title: string; description?: string; id?: string; level?: 'h2' | 'h3'; count?: number }) {
  return <SectionHeader title={title} description={description} count={count} actions={[]} as={level} bordered={false} headingId={id} className="min-w-0" />
}
export function Loading({ label }: { label: string }) { return <TableSkeleton rows={3} columns={2} label={label} className="min-w-0" /> }
export function Empty({ title, description = '', action = null, level = 'h3' }: { title: string; description?: string; action?: ComponentProps<typeof EmptyState>['primaryAction']; level?: 'h2' | 'h3' }) {
  return <EmptyState icon={undefined} role="status" title={title} description={description} titleAs={level} bordered={false} size="md" primaryAction={action} secondaryAction={null} className="min-w-0" />
}
export function Tag({ label, tone }: { label: string; tone: 'neutral' | 'success' | 'warning' | 'destructive' | 'info' }) {
  return <StatusTag status={label} statuses={{ [label]: { label, tone } }} label={label} uppercase={false} variant="soft" size="sm" shape="rounded" className="max-w-full" />
}
export function Chip({ children }: { children: ComponentProps<typeof Badge>['children'] }) {
  return <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{children}</Badge>
}
export function TextField({ id, label, placeholder, value, onChange, busy = false }: { id: string; label: string; placeholder: string; value: string; onChange: (value: string) => void; busy?: boolean }) {
  return <Field invalid={false} disabled={busy} className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} type="text" size="md" value={value} onChange={(event) => onChange(event.target.value)} readOnly={busy} autoComplete="off" spellCheck={false} placeholder={placeholder} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} />
  </Field>
}
export function Details({ term, value }: { term: string; value: ReactNode }) {
  return <div className="min-w-0"><Text as="p" variant="label" tone="default">{term}</Text><Text as="p" variant="body" tone="default">{value}</Text></div>
}
export function Table<T extends object>({ rows, columns, id, label, loadingLabel }: { rows: T[]; columns: DataTableColumn<T>[]; id: (row: T) => string; label: string; loadingLabel: string }) {
  const { t } = useCopy()
  return <div className="min-w-0 max-w-full"><DataTable rows={rows} columns={columns} getRowId={id} getRowLabel={id} caption={label} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: label, emptyTitle: t('none'), emptyDescription: '', loading: () => loadingLabel }} /></div>
}

// 403 stays in the failing section, 404 offers the breadcrumb way back, everything else is an error panel with the request id.
export function FailureView({ error, section, title, retry }: { error: Failure; section: string; title?: string; retry: () => void }) {
  const { t } = useCopy()
  const heading = title ?? t(`errors.${section}`)
  return <div data-testid={`mongo-failure-${section}`} className="min-w-0">
    {error.status === 403 ? <NoAccessEmpty resource={t(section)} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : error.status === 404 ? <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={null} titleAs="h3" bordered={false} className="min-w-0" />
      : <ErrorPanel title={heading} message={t(error.status ? 'serverError' : 'networkError')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true} onRetry={() => retry()} retrying={false} retryLabel={t('retry')} className="min-w-0"
        labels={{ title: heading, message: t('serverError'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
  </div>
}

// One section of the drill-down. It owns the heading, the skeleton, the failure view and the focus hand-off after Reintentar:
// a recovered section moves focus to its own region, a failed retry keeps focus on Reintentar.
export function Section({ id, name, title, description, busy, error, retry, children, level = 'h2' }: { id: string; name: string; title: string; description?: string; busy: boolean; error: Failure | null; retry: () => void; children: ReactNode; level?: 'h2' | 'h3' }) {
  const { t } = useCopy()
  const region = useRef<HTMLElement>(null), retried = useRef(false)
  useEffect(() => {
    if (!retried.current || busy) return
    retried.current = false
    if (error) (retryButton(region.current, t('retry')) ?? region.current)?.focus()
    else region.current?.focus()
  }, [busy, error])
  return <section id={id} ref={region} tabIndex={-1} className={`min-w-0 space-y-4 ${focusRing}`} aria-label={title} aria-busy={busy}>
    <Heading title={title} description={description} level={level} />
    {busy ? <Loading label={t(`loading.${name}`)} /> : error ? <FailureView section={name} error={error} retry={() => { retried.current = true; retry() }} /> : children}
  </section>
}
