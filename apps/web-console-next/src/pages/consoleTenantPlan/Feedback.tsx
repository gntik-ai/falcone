import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import type { Failure } from './api'

export type Scope = 'plan' | 'history' | 'plans' | 'assign'

// Failure states of one scope: 403 no access, 404 not found, anything else an error panel with Reintentar.
// The panel stays mounted while a retry runs so the Reintentar button keeps keyboard focus.
export function FailureSurface({ scope, failure, retrying, onRetry, notFoundAction, values, titleAs, retryRef, hideRetry = false }: {
  scope: Scope
  failure: Failure
  retrying: boolean
  onRetry: () => void
  notFoundAction?: JSX.Element
  values?: Record<string, string>
  titleAs: 'h2' | 'h3'
  retryRef?: Ref<HTMLButtonElement>
  hideRetry?: boolean
}) {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  // The empty states carry no live region of their own, so the wrapper announces their heading when the failure appears.
  if (failure.status === 403) {
    return <div role="alert" className="min-w-0"><NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs={titleAs} bordered={false} className="min-w-0"
      labels={{ title: () => t(`${scope}.noAccessTitle`, values), description: () => t(`${scope}.noAccessDescription`, values), request: '', requested: '', sent: '' }} /></div>
  }
  if (failure.status === 404) {
    return <div role="alert" className="min-w-0"><NotFoundEmpty icon={undefined} title={t(`${scope}.notFoundTitle`, values)} description={t(`${scope}.notFoundDescription`, values)} action={notFoundAction} titleAs={titleAs} bordered={false} className="min-w-0" /></div>
  }
  const title = t(`${scope}.errorTitle`)
  const message = t(failure.status ? `${scope}.errorMessage` : `${scope}.networkMessage`)
  return <div className="min-w-0 space-y-3">
    <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs={titleAs} announce={true}
      onRetry={undefined} retrying={false} retryLabel={t('retry')} className="min-w-0"
      labels={{ title, message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
    {!hideRetry && <Button ref={retryRef} type="button" variant="secondary" aria-disabled={retrying} aria-busy={retrying}
      onClick={() => { if (!retrying) onRetry() }}>{t(retrying ? 'retrying' : 'retry')}</Button>}
  </div>
}
