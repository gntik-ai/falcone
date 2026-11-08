import type { ComponentProps } from 'react'
import { Alert, Button, Collapsible, CollapsiblePanel, CollapsibleTrigger, EmptyState, Input, type ButtonProps } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty } from '@gntik-ai/blocks'
import { type Failure } from './api'
import { focusRing, useCopy } from './copy'

export function Action(props: ButtonProps) {
  return <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} {...props} />
}
export function Control(props: ComponentProps<typeof Input>) {
  return <Input type="text" size="md" disabled={false} invalid={false} placeholder={undefined} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`min-w-0 ${focusRing}`} {...props} />
}
export function Empty({ title, description }: { title: ComponentProps<typeof EmptyState>['title']; description: string }) {
  return <EmptyState icon={undefined} title={title} description={description} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />
}
export const createTitleKey = (status?: number) => status === 403 ? 'deniedTitle' : status === 404 ? 'notFoundTitle' : 'failureTitle'
export const createMessageKey = (status?: number) => ({ 403: 'deniedDescription', 404: 'notFoundDescription', 409: 'conflict', 422: 'invalidData' } as Record<number, string>)[status ?? 0] ?? 'failureDescription'
export const quotaTitleKey = (status?: number) => status === 403 ? 'quotaDenied' : status === 404 ? 'quotaNotFound' : 'quotaFailure'

export function FailureView({ failure, quota, titleRef }: { failure: Failure; quota: boolean; titleRef?: (node: HTMLElement | null) => void }) {
  const { t } = useCopy()
  const titleText = t(quota ? quotaTitleKey(failure.status) : createTitleKey(failure.status))
  const description = t(quota ? 'quotaFailureDescription' : createMessageKey(failure.status))
  const title = <span ref={titleRef}>{titleText}</span>
  const technical = [failure.message, failure.code, failure.requestId].filter(Boolean).join('\n')
  return <div ref={(node) => titleRef?.(node?.querySelector('h2') ?? null)} className="min-w-0 space-y-4 wrap-anywhere">
    {failure.status === 403 ? <NoAccessEmpty resource="" owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => titleText, description: () => description, request: '', requested: '', sent: '' }} /> :
      failure.status === 404 ? <NotFoundEmpty title={title} description={description} icon={undefined} action={undefined} titleAs="h2" bordered={false} className="min-w-0" /> :
      !quota && [409, 422].includes(failure.status ?? 0) ? <Alert tone="destructive" title={<span role="heading" aria-level={2}>{titleText}</span>} icon={undefined} description={undefined} actions={null} onDismiss={undefined} dismissLabel={t('close')} role="presentation">{description}</Alert> :
      <ErrorPanel title={title} message={description} icon={undefined} code={failure.status ?? null} requestId={failure.requestId ?? ''} details={quota ? '' : technical} onRetry={undefined} retrying={false} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={false} className="min-w-0 wrap-anywhere"
        labels={{ title: titleText, message: description, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
    {!quota && [403, 404, 409, 422].includes(failure.status ?? 0) && <Collapsible defaultOpen={false} disabled={false} className="min-w-0"><CollapsibleTrigger className={focusRing}>{t('details')}</CollapsibleTrigger><CollapsiblePanel className="min-w-0"><pre className="whitespace-pre-wrap break-all text-sm">{technical}</pre></CollapsiblePanel></Collapsible>}
  </div>
}
