import { useEffect, useLayoutEffect, useRef, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, useAnnounce } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import { isNetwork, type Action, type Failure } from './api'

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
export type Scope = Action | 'list'
export type Presentation = 'no-access' | 'not-found' | 'panel' | 'alert'

// 403 and 404 replace the surface body; 5xx and network failures get Reintentar; every other
// mutation status is a localized alert in place. Any list failure keeps Reintentar (item 1).
export function presentationOf(scope: Scope, failure: Failure): Presentation {
  if (failure.status === 403) return 'no-access'
  if (failure.status === 404) return 'not-found'
  if (scope === 'list' || isNetwork(failure) || failure.status! >= 500) return 'panel'
  return 'alert'
}
export function reasonOf(failure: Failure): 'revoked' | 'conflict' | 'rateLimit' | 'unavailable' | 'session' | 'generic' {
  if (failure.code === 'CREDENTIAL_REVOKED') return 'revoked'
  if (failure.status === 409) return 'conflict'
  if (failure.status === 429) return 'rateLimit'
  if (failure.status === 401) return 'session'
  if (failure.status !== undefined && failure.status >= 500) return 'unavailable'
  return 'generic'
}

interface Props {
  scope: Scope
  failure: Failure
  name: string
  pending: boolean
  // Omitted when a resend is not allowed, which hides Reintentar.
  onRetry: (() => void) | undefined
  // Closes the surface; the caller returns focus to the triggering control.
  onClose: () => void
  // Closes the surface, refetches the list and moves focus to the page heading (404 only).
  onBack: () => void
  closeRef?: Ref<HTMLButtonElement>
  // Called for alert failures, which keep the surrounding controls usable.
  onAlertShown?: () => void
  autoFocus?: boolean
}

export function FailureView({ scope, failure, name, pending, onRetry, onClose, onBack, closeRef, onAlertShown, autoFocus = true }: Props) {
  const { t } = useTranslation('pages.console-service-accounts-page')
  const announce = useAnnounce()
  const wrapper = useRef<HTMLDivElement>(null)
  const kind = presentationOf(scope, failure)
  const action = scope === 'list' ? 'create' : scope
  const variables = { name }
  const title = scope === 'list' ? t(kind === 'no-access' ? 'states.listNoAccessTitle' : kind === 'not-found' ? 'states.listNotFoundTitle' : 'states.listError')
    : t(kind === 'no-access' ? 'failure.noAccessTitle' : kind === 'not-found' ? 'failure.notFoundTitle' : `failure.title.${action}`)
  const detail = kind === 'no-access' ? (scope === 'list' ? t('states.listNoAccess') : t(`failure.noAccess.${action}`, variables))
    : kind === 'not-found' ? (scope === 'list' ? t('states.listNotFound') : t(`failure.notFound.${action}`, variables))
      : kind === 'panel' && isNetwork(failure) ? t('failure.networkMessage')
        : kind === 'panel' && reasonOf(failure) === 'generic' ? t('failure.errorMessage') : t(`errors.${reasonOf(failure)}`)
  // Announce once per failure; the visible panel does not own a second live region.
  useEffect(() => { announce(t('failure.announce', { title, detail }), 'assertive') }, [failure]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!autoFocus) return
    if (kind === 'alert') { onAlertShown?.(); return }
    // Reintentar for panels; Cerrar for 403 and 404. Never the request-id copy button.
    if (kind === 'panel') {
      const retry = Array.from(wrapper.current?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === t('failure.retry'))
      retry?.focus()
    }
  }, [failure]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (autoFocus && (kind === 'no-access' || kind === 'not-found')) wrapper.current?.querySelector<HTMLButtonElement>('[data-failure-close]')?.focus()
  }, [failure]) // eslint-disable-line react-hooks/exhaustive-deps
  if (kind === 'alert') return <div ref={wrapper}><Alert tone="destructive" role="alert" title={undefined} description={detail} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('confirm.close')} /></div>
  return <div ref={wrapper} className="min-w-0 space-y-3">
    {kind === 'no-access'
      ? <NoAccessEmpty resource={title} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0"
        labels={{ title: () => title, description: () => detail, request: '', requested: '', sent: '' }} />
      : kind === 'not-found'
        ? <NotFoundEmpty title={title} description={detail} icon={undefined} action={null} titleAs="h3" bordered={false} className="min-w-0" />
        : <ErrorPanel title={title} message={detail} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={false}
          retryLabel={t('failure.retry')} retrying={pending} onRetry={onRetry} className="min-w-0"
          labels={{ title, message: detail, support: t('failure.support'), retry: t('failure.retry'), retrying: t('failure.retrying'), retryingStatus: t('failure.retrying'), requestId: t('failure.requestId'), copyRequestId: t('failure.copyRequestId'), copied: t('failure.copiedLabel'), requestIdCopied: t('failure.requestIdCopied'), details: t('failure.details') }} />}
    {(kind === 'no-access' || kind === 'not-found') && scope !== 'list' && <div className="flex flex-wrap gap-3">
      <Button ref={closeRef} type="button" variant="secondary" size="md" loading={false} disabled={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} data-failure-close="" className={focusRing} onClick={onClose}>{t('confirm.close')}</Button>
      {kind === 'not-found' && <Button type="button" variant="secondary" size="md" loading={false} disabled={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={onBack}>{t('failure.backToList')}</Button>}
    </div>}
    {kind === 'not-found' && scope === 'list' && <Button type="button" variant="secondary" size="md" loading={false} disabled={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={onBack}>{t('states.chooseWorkspace')}</Button>}
  </div>
}
