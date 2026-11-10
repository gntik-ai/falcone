import type { ComponentProps } from 'react'
import { Lock } from 'lucide-react'
import { Button, EmptyState, Text } from '@gntik-ai/ui'
import { ErrorPanel, NotFoundEmpty, TableSkeleton } from '@gntik-ai/blocks'
import type { Failure } from './api'
import { describeSecretError, describeWrite, focusRing, requestIdOf, useCopy, type WriteKind } from './copy'

type EmptyIcon = ComponentProps<typeof EmptyState>['icon']
// The kit icon slot types come from another lucide build than the installed one.
const lockIcon = Lock as unknown as EmptyIcon

export function Loading() {
  const { t } = useCopy()
  return <section role="status" aria-label={t('loading.title')} aria-busy={true} className="min-w-0 space-y-3" data-testid="workspace-secrets-loading">
    <Text as="p" variant="body" tone="muted">{t('loading.description')}</Text>
    <TableSkeleton rows={4} columns={4} label={t('loading.title')} className="min-w-0" />
  </section>
}

export function RecoveryButton({ children, onClick }: { children: string; onClick: () => void }) {
  return <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={onClick}>{children}</Button>
}

// The in-page no-access state: legacy permission message and correlation id, no request-access action.
export function NoAccess({ target, title, failure, action, context = 'mutate' }: { target: 'list' | 'create' | 'table'; title: string; failure: Failure; action?: JSX.Element; context?: 'list' | 'mutate' }) {
  const { t } = useCopy()
  return <div role="alert" data-secret-state={target} className="min-w-0" data-testid={`workspace-secrets-no-access-${target}`}>
    <EmptyState icon={lockIcon} title={title} description={describeSecretError(t, failure, context)} titleAs="h2" bordered={false} size="md" secondaryAction={null} primaryAction={action ?? null} className="min-w-0" />
  </div>
}

export function NotFound({ target, title, failure, action, context = 'mutate' }: { target: 'list' | 'create' | 'table'; title: string; failure: Failure; action?: JSX.Element; context?: 'list' | 'mutate' }) {
  const { t } = useCopy()
  return <div role="alert" data-secret-state={target} className="min-w-0" data-testid={`workspace-secrets-not-found-${target}`}>
    <NotFoundEmpty icon={undefined} title={title} description={describeSecretError(t, failure, context)} action={action} titleAs="h2" bordered={false} className="min-w-0" />
  </div>
}

// 5xx and network failures keep the entered values and offer Reintentar. The raw server message is shown
// only in the technical details, and the request id and the correlation id both stay visible.
export function FailurePanel({ target, title, message, failure, retry, retrying }: { target: 'list' | 'next' | 'create' | 'confirm'; title: string; message: string; failure: Failure; retry: () => void; retrying: boolean }) {
  const { t } = useCopy()
  return <div data-secret-failure={target} className="min-w-0 max-w-full" data-testid={`workspace-secrets-failure-${target}`}>
    <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.status ? requestIdOf(failure) : ''} details={failure.status ? failure.message ?? '' : ''} secondaryAction={null} titleAs="h2" announce={true}
      retryLabel={t('errorPanel.retry')} retrying={retrying} onRetry={retry} className="min-w-0 max-w-full"
      labels={{ title, message, support: t('errorPanel.support'), retry: t('errorPanel.retry'), retrying: t('errorPanel.retrying'), retryingStatus: t('errorPanel.retrying'), requestId: t('errorPanel.requestId'), copyRequestId: t('errorPanel.copyRequestId'), copied: t('errorPanel.copied'), requestIdCopied: t('errorPanel.copied'), details: t('errorPanel.details') }} />
  </div>
}

export const writeTitleKey = (kind: WriteKind) => `errors.writeTitle${kind === 'create' ? 'Create' : kind === 'replace' ? 'Replace' : 'Delete'}`

export function WriteFailure({ kind, failure, retry, retrying, target }: { kind: WriteKind; failure: Failure; retry: () => void; retrying: boolean; target: 'create' | 'confirm' }) {
  const { t } = useCopy()
  return <FailurePanel target={target} title={t(writeTitleKey(kind))} message={describeWrite(t, kind, failure)} failure={failure} retry={retry} retrying={retrying} />
}
