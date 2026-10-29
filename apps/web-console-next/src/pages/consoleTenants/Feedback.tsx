import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Text } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import type { Failure } from './api'

export function Feedback({ failure, area, retry, close, secondary = null, polite = false }: {
  failure: Failure; area: 'inventory' | 'catalog' | 'precheck' | 'submit'; retry: (() => void) | null; close: (() => void) | null; secondary?: ReactNode; polite?: boolean
}) {
  const { t } = useTranslation('pages.console-tenants-page')
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (polite || failure.status === 401) return
    const heading = panel.current?.querySelector('h2')
    if (heading) { heading.tabIndex = -1; heading.classList.add('focus-visible:outline-2', 'focus-visible:outline-offset-2', 'focus-visible:outline-focus-ring'); heading.focus() }
    else panel.current?.focus()
  }, [failure, polite])
  const title = t(`${area}.${failure.status === 403 ? 'noAccess' : failure.status === 404 ? 'notFound' : 'error'}`)
  const message = t(failure.status === 409 ? 'conflict' : failure.status === 422 ? 'invalidData' : `${area}.description`)
  if (failure.status === 401) return failure.renewed ? <Text role="status">{t('sessionRenewed')}</Text> : null
  return <div ref={panel} tabIndex={-1} role={polite ? 'status' : 'region'} aria-label={title} aria-live={polite ? 'polite' : undefined}
    className="min-w-0 space-y-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
    {failure.status === 403 ? <NoAccessEmpty resource={title} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
      labels={{ title: () => title, description: () => message, request: '', requested: '', sent: '' }} />
      : failure.status === 404 ? <NotFoundEmpty title={title} description={message} action={null} titleAs="h2" bordered={false} />
        : <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" onRetry={undefined} retrying={false}
          retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={false}
          labels={{ title, message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
    <div className="flex flex-wrap gap-3">
      {retry && <Button type="button" variant="secondary" onClick={retry}>{t(area === 'precheck' ? 'retryPrecheck' : 'retry')}</Button>}
      {close && <Button type="button" variant="secondary" onClick={close}>{t('closeWizard')}</Button>}
      {secondary}
    </div>
  </div>
}
