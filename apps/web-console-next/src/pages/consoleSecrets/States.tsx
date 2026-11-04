import { useTranslation } from 'react-i18next'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import type { Failure } from './api'

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
export function FailureState({ failure, retry, pending = false, name, version }: { failure: Failure; retry: () => void; pending?: boolean; name?: string; version?: number }) {
  const { t } = useTranslation('pages.console-secrets-page')
  const variables = { name, version }
  const description = t(name ? 'revokeFailureDescription' : 'inventoryFailureDescription', variables)
  if (failure.status === 403) return <NoAccessEmpty resource={name ?? t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0"
    labels={{ title: () => t('noAccess'), description: () => description, request: '', requested: '', sent: '' }} />
  if (failure.status === 404) return <NotFoundEmpty title={t('notFound')} description={description} icon={undefined} action={null} titleAs="h2" bordered={false} className="min-w-0" />
  const title = t(name ? 'revokeError' : 'inventoryError'), message = t('errorDescription')
  return <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={pending} onRetry={retry} className="min-w-0"
    labels={{ title, message, support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}
