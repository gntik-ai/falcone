import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Link } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import type { Failure } from './api'

// One failure vocabulary for the metrics and audit areas: 401 belongs to the shell, 403 and 404 are in-page
// empty states, everything else is an error-panel with the request id. No backend text is rendered.
export function FailureState({ area, failure, onRetry }: { area: 'metrics' | 'audit'; failure: Failure; onRetry: () => void }) {
  const { t } = useTranslation('pages.console-observability-page')
  if (failure.status === 401) return null
  if (failure.status === 403) {
    return <NoAccessEmpty resource={t(`${area}.noAccess`)} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
      labels={{ title: () => t(`${area}.noAccess`), description: () => t(`${area}.noAccessDescription`), request: '', requested: '', sent: '' }} />
  }
  if (failure.status === 404) {
    return <NotFoundEmpty title={t(`${area}.notFound`)} description={t(`${area}.notFoundDescription`)} titleAs="h2" bordered={false}
      action={<Link render={<RouterLink to="/console/overview" />} underline="always" external={false} externalLabel="">{t('backToOverview')}</Link>} />
  }
  return <ErrorPanel title={t(`${area}.errorTitle`)} message={t(`${area}.errorMessage`)} code={failure.status ?? null} requestId={failure.requestId} details="" secondaryAction={null} titleAs="h2" announce={true}
    onRetry={onRetry} retrying={false} retryLabel={t('error.retry')}
    labels={{ title: t(`${area}.errorTitle`), message: t(`${area}.errorMessage`), support: t('error.support'), retry: t('error.retry'), retrying: t('error.retrying'), retryingStatus: t('error.retrying'),
      requestId: t('error.requestId'), copyRequestId: t('error.copyRequestId'), copied: t('error.copied'), requestIdCopied: t('error.copied'), details: t('error.details') }} />
}
