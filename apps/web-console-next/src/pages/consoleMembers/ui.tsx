import type { ComponentProps } from 'react'
import { Button, EmptyState, Input, Text, Timestamp, type ButtonProps } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import { Link } from 'react-router-dom'
import { useCopy, focusRing } from './copy'
import { invitationLink, type Failure, type Proof } from './api'

export function Action({ children, ...props }: ButtonProps) {
  return <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props}>{children}</Button>
}
export function Notice({ message, description = null }: { message: string; description?: string | null }) {
  return <div><InlineCallout tone="destructive" title={message} description={description} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: message, description: '', upgrade: '', viewUsage: '' }} className="min-w-0" /></div>
}
export function Empty({ title, description = null }: { title: string; description?: string | null }) {
  return <EmptyState icon={undefined} title={title} description={description} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />
}
export function Heading({ title, description = null }: { title: string; description?: string | null }) {
  return <SectionHeader title={title} description={description} count={undefined} actions={[]} as="h2" headingId={undefined} bordered={false} className="min-w-0" />
}
export function Loading({ label }: { label: string }) {
  return <section role="status" aria-label={label} aria-busy={true}><TableSkeleton rows={3} columns={4} label={label} className="min-w-0" /></section>
}
export function failureKey(failure: Failure, fallback: string) {
  if (failure.status && failure.status >= 500) return 'serviceUnavailable'
  return ({ 401: 'sessionExpired', 403: 'noAccess', 404: 'notFound', 409: 'conflict', 429: 'rateLimited' } as Record<number, string>)[failure.status ?? 0] ?? fallback
}
export function ListFailure({ failure, retry, kind }: { failure: Failure; retry: () => void; kind: 'users' | 'roles' }) {
  const { t } = useCopy()
  if (failure.status === 403) return <NoAccessEmpty resource={t(kind)} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccess'), request: '', requested: '', sent: '' }} />
  if (failure.status === 404) return <NotFoundEmpty title={t('notFound')} description={t('notFound')} icon={undefined} action={<Link to="/console/overview" className={`underline ${focusRing}`}>{t('backOverview')}</Link>} titleAs="h2" bordered={false} className="min-w-0" />
  const message = t(failureKey(failure, `${kind}Failure`)), label = t(`${kind}Retry`)
  return <ErrorPanel title={message} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={label} retrying={false} onRetry={retry} className="min-w-0"
    labels={{ title: message, message, support: t('support'), retry: label, retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}
export function Table<T extends object>({ rows, columns, id, label }: { rows: T[]; columns: DataTableColumn<T>[]; id: (row: T) => string; label: string }) {
  const { t } = useCopy()
  return <DataTable rows={rows} columns={columns} getRowId={id} getRowLabel={id} caption={label} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null}
    showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0 members-table" labels={{ scrollRegion: label, emptyTitle: t('empty'), emptyDescription: '', loading: () => t('loading') }} />
}
export function Control(props: ComponentProps<typeof Input>) {
  return <Input size="md" disabled={false} invalid={false} placeholder={undefined} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`min-w-0 ${focusRing}`} {...props} />
}
export function ProofView({ tenantId, proof, onClose, closeLabel }: { tenantId: string; proof: Proof; onClose: () => void; closeLabel: string }) {
  const { t, i18n: language } = useCopy()
  return <section aria-label={t('invitationReady')} className="min-w-0 space-y-4">
    <Heading title={t('invitationReady')} />
    <label className="block space-y-2"><Text as="span" variant="body" tone="default">{t('oneTimeLink')}</Text><Control readOnly value={invitationLink(tenantId, proof)} /></label>
    <Text as="p" variant="body" tone="default">{t('linkHelp')}</Text>
    <Text as="p" variant="body" tone="default">{t('expires')}<Timestamp value={proof.expiresAt} locale={language.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} live={false} tooltip={false} fallback={t('unavailable')} /></Text>
    <Action onClick={onClose}>{closeLabel}</Action>
  </section>
}
