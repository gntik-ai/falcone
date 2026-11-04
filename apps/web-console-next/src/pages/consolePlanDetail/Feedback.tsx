import { forwardRef } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Text } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import type { Failure } from './api'
import { isKnownCode, isLifecycle, retryable, type Action } from './model'

const NAMESPACE = 'pages.console-plan-detail-page'
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

// The failure of one mutation. Only localized copy renders: the transport message never leaves api.ts.
export const MutationFeedback = forwardRef<HTMLDivElement, { action: Action; failure: Failure; busy: boolean; onRetry: () => void; titleAs: 'h2' | 'h3' }>(
  function MutationFeedback({ action, failure, busy, onRetry, titleAs }, ref) {
    const { t } = useTranslation(NAMESPACE)
    if (failure.status === 401 && !failure.sessionRenewed) return null // The shared session transport redirects to the login.
    const title = t(isLifecycle(action) ? 'feedback.lifecycleTitle' : action.kind === 'delete' ? 'feedback.deleteTitle' : action.kind === 'set' ? 'limits.saveFailedTitle' : 'limits.resetFailedTitle')
    const attempted = action.kind === 'set' ? t('limits.attempted', { key: action.key, value: action.value }) : null
    const known = isKnownCode(failure.code)
    let body: JSX.Element
    if (failure.status === 401) {
      body = <InlineCallout tone="info" title={t('feedback.sessionTitle')} description={t('feedback.sessionDescription')} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
        labels={{ title: t('feedback.sessionTitle'), description: t('feedback.sessionDescription'), upgrade: '', viewUsage: '' }} />
    } else if (failure.status === 403) {
      body = <NoAccessEmpty resource={t('pageTitle')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs={titleAs} bordered={false} className="min-w-0"
        labels={{ title: () => t('feedback.noAccessTitle'), description: () => t('feedback.noAccessDescription'), request: '', requested: '', sent: '' }} />
    } else if (failure.status === 404) {
      body = <NotFoundEmpty icon={undefined} title={t('feedback.notFoundTitle')} description={t('feedback.notFoundDescription')} titleAs={titleAs} bordered={false} className="min-w-0"
        action={<RouterLink to="/console/plans" className={`underline ${focus}`}>{t('back')}</RouterLink>} />
    } else if (retryable(failure)) {
      const message = known ? t(`feedback.code.${failure.code}`) : failure.code ? t('feedback.codeMessage', { code: failure.code })
        : failure.status === undefined ? t(isLifecycle(action) ? 'feedback.outcomeUnknown' : 'feedback.networkMessage') : t('feedback.errorMessage')
      body = <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs={titleAs} announce={true}
        onRetry={onRetry} retrying={busy} retryLabel={t('retry')}
        labels={{ title, message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
    } else {
      // A business rejection is a decision of the backend: it is explained, not retried.
      const message = known ? t(`feedback.code.${failure.code}`) : failure.code ? t('feedback.codeMessage', { code: failure.code }) : t('feedback.errorMessage')
      body = <InlineCallout tone="destructive" title={title} description={message} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
        labels={{ title, description: message, upgrade: '', viewUsage: '' }} />
    }
    return <div ref={ref} tabIndex={-1} data-testid="mutation-feedback" className={`min-w-0 space-y-2 ${focus}`}>
      {body}
      {attempted && failure.status !== 403 && <Text variant="supporting" tone="muted">{attempted}</Text>}
    </div>
  },
)
