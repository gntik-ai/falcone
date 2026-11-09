import { useTranslation } from 'react-i18next'
import { Link } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import type { Failure } from './state'

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
export function BackLink() {
  const { t } = useTranslation('pages.console-secret-rotation-page')
  return <Link render={<a />} href="/console/secrets" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('back')}</Link>
}
export function ReadFailure({ failure, retry, section }: { failure: Failure; retry: () => void; section: 'history' | 'consumers' }) {
  const { t } = useTranslation('pages.console-secret-rotation-page')
  if (failure.status === 403) return <NoAccessEmpty resource={t(`${section}Title`)} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0"
    labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
  if (failure.status === 404) return <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} icon={undefined} action={<BackLink />} titleAs="h3" bordered={false} className="min-w-0" />
  const title = t(`${section}Error`), message = [t(failure.status ? 'readError' : 'networkError'), !failure.requestId && t('noRequestId')].filter(Boolean).join(' ')
  return <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId} details=""
    onRetry={retry} retrying={false} retryLabel={t('retry')} secondaryAction={null} titleAs="h3" announce={true} className="min-w-0"
    labels={{ title, message, support: t('noRequestId'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}
