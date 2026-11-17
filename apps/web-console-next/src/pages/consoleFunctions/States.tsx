import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { Button, EmptyState, StatusTag, Text, type BadgeTone } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, NotFoundEmpty, NoAccessEmpty, TableSkeleton } from '@gntik-ai/blocks'
import type { Failure } from './api'
import { describeFailure, focusRing, statusLabel, titleKey, useCopy, type Section } from './copy'

// Legacy :367-383, expressed with kit tones only.
export function statusTone(value?: string | null): BadgeTone {
  const normalized = value?.toLowerCase()
  if (!normalized) return 'neutral'
  if (['active', 'succeeded', 'success', 'completed', 'available'].includes(normalized)) return 'success'
  if (['failed', 'failure', 'error', 'invalid', 'degraded', 'timed_out', 'cancelled'].includes(normalized)) return 'destructive'
  if (['accepted', 'queued', 'running', 'provisioning', 'deploying'].includes(normalized)) return 'primary'
  if (['suspended', 'historical', 'inactive'].includes(normalized)) return 'warning'
  return 'neutral'
}

export function FunctionStatus({ value }: { value?: string | null }) {
  const { t } = useCopy()
  const label = statusLabel(t, value)
  return <StatusTag status={value ?? ''} label={label} statuses={{ [value ?? '']: { label, tone: statusTone(value) } }} uppercase={false} className="max-w-full whitespace-normal break-words" />
}

export function Loading({ label, rows = 3, columns = 3 }: { label: string; rows?: number; columns?: number }) {
  return <section role="status" aria-busy={true} aria-label={label} className="min-w-0 space-y-2" data-fn-loading="">
    <Text as="p" variant="body" tone="muted">{label}</Text>
    <div aria-hidden={true}><TableSkeleton rows={rows} columns={columns} label={label} className="min-w-0" /></div>
  </section>
}

export function Empty({ title, description, testId }: { title: string; description?: string; testId?: string }) {
  return <div data-testid={testId} className="min-w-0"><EmptyState icon={undefined} title={title} description={description} titleAs="h3" bordered={true} size="md" primaryAction={null} secondaryAction={null} className="min-w-0" /></div>
}

// One failed request: the message follows the status, with the request id and a retry for that request only.
export function FailurePanel({ section, failure, message, retry, retrying = false, canRetry = true }: { section: Section; failure: Failure; message?: string; retry: () => void; retrying?: boolean; canRetry?: boolean }) {
  const { t } = useCopy()
  const title = t(titleKey(section))
  const text = message ?? describeFailure(t, failure, section)
  return <div role="alert" data-fn-failure={section} className="min-w-0 max-w-full">
    <ErrorPanel title={title} message={text} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={false} retryLabel={t('retry')} retrying={retrying}
      onRetry={canRetry ? retry : undefined} className="min-w-0 max-w-full"
      labels={{ title, message: text, support: t('errorPanel.support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('errorPanel.requestId'), copyRequestId: t('errorPanel.copyRequestId'), copied: t('errorPanel.copied'), requestIdCopied: t('errorPanel.copied'), details: t('errorPanel.details') }} />
  </div>
}

export function NoAccess({ title, message }: { title: string; message: string }) {
  return <div role="alert" data-fn-state="no-access" className="min-w-0">
    <NoAccessEmpty resource={title} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h3" bordered={true} className="min-w-0"
      labels={{ title: () => title, description: () => message, request: '', requested: '', sent: '' }} />
  </div>
}

export function NotFound({ message, onBack }: { message: string; onBack: () => void }) {
  const { t } = useCopy()
  return <div role="alert" data-fn-state="not-found" className="min-w-0">
    <NotFoundEmpty icon={undefined} title={t('notFound.title')} description={message} titleAs="h3" bordered={true} className="min-w-0"
      action={<Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={onBack}>{t('notFound.back')}</Button>} />
  </div>
}

// Section failure with the 403 and 404 states that replace the pane instead of offering a retry.
export function SectionFailure({ section, failure, retry, retrying, onBack }: { section: Section; failure: Failure; retry: () => void; retrying: boolean; onBack?: () => void }) {
  const { t } = useCopy()
  if (failure.status === 403 && section === 'detail') return <NoAccess title={t('noAccess.detail')} message={t('errors.403')} />
  if (failure.status === 404 && section === 'detail' && onBack) return <NotFound message={t('errors.404')} onBack={onBack} />
  return <FailurePanel section={section} failure={failure} retry={retry} retrying={retrying} />
}

// The legacy amber notice, as an inline callout with the reason linked to the disabled actions by id.
export function WriteBlocked({ id, reason }: { id: string; reason: string }) {
  const { t } = useCopy()
  return <div id={id} data-testid="functions-write-disabled" className="min-w-0">
    <InlineCallout tone="warning" title={t('write.blocked')} labels={{ title: t('write.blocked') }} description={reason} actions={[]} icon={Lock as never} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" />
  </div>
}

export const Body = ({ children }: { children: ReactNode }) => <div className="min-w-0 space-y-4">{children}</div>
