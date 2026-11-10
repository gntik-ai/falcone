import { Button, EmptyState, Text } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, TableSkeleton } from '@gntik-ai/blocks'
import { focusRing, useCopy } from './copy'
import { errorKey, type Failure } from './api'

export function Empty({ title, description, action, titleAs = 'h2' }: { title: string; description: string; action?: JSX.Element; titleAs?: 'h2' | 'h3' }) {
  return <EmptyState icon={undefined} title={title} description={description} titleAs={titleAs} bordered={false} size="md" secondaryAction={null} primaryAction={action ?? null} className="min-w-0" />
}

export function ActionButton({ children, onClick }: { children: string; onClick: () => void }) {
  return <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={onClick}>{children}</Button>
}

export function Loading({ title, description }: { title: string; description: string }) {
  return <section role="status" aria-label={title} aria-busy={true} className="min-w-0 space-y-3">
    <Text as="p" variant="body" tone="muted">{description}</Text>
    <TableSkeleton rows={4} columns={4} label={title} className="min-w-0" />
  </section>
}

// 5xx failures carry the request id; every error panel names its recovery action.
export function Failed({ title, failure, retryLabel, retry, fallback }: { title: string; failure: Failure; retryLabel: string; retry: () => void; fallback: string }) {
  const { t } = useCopy()
  const message = t(errorKey(failure, fallback))
  return <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.status && failure.status >= 500 ? failure.requestId ?? '' : ''} details="" secondaryAction={null} titleAs="h2" announce={true}
    retryLabel={retryLabel} retrying={false} onRetry={retry} className="min-w-0"
    labels={{ title, message, support: t('errorPanel.support'), retry: retryLabel, retrying: t('errorPanel.retrying'), retryingStatus: t('errorPanel.retrying'), requestId: t('errorPanel.requestId'), copyRequestId: t('errorPanel.copyRequestId'), copied: t('errorPanel.copied'), requestIdCopied: t('errorPanel.copied'), details: t('errorPanel.details') }} />
}

export function NoAccess() {
  const { t } = useCopy()
  return <NoAccessEmpty resource={t('noAccess.title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0"
    labels={{ title: () => t('noAccess.title'), description: () => t('noAccess.description'), request: '', requested: '', sent: '' }} />
}

export function NotFound({ title, description, action }: { title: string; description: string; action: JSX.Element }) {
  return <NotFoundEmpty title={title} description={description} icon={undefined} action={action} titleAs="h2" bordered={false} className="min-w-0" />
}

export function MutationCallout({ messageKey }: { messageKey: string }) {
  const { t } = useCopy()
  const title = t('mutationError.title'), description = t(messageKey)
  return <div role="alert" className="min-w-0"><InlineCallout tone="destructive" title={title} description={description} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title, description, upgrade: '', viewUsage: '' }} /></div>
}
