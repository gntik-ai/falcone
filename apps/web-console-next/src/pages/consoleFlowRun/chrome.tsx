import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, Field, FieldLabel, Link, SimpleSelect, Text } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty, PageSkeleton, TableSkeleton } from '@gntik-ai/blocks'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { focus } from './controls'
import type { Failure } from './notify'

export const runsHref = (flowId: string) => `/console/flows/${encodeURIComponent(flowId)}/runs`
const errorLabels = (t: (key: string) => string) => ({ title: t('errorTitle'), message: t('errorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') })

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} tone="primary" underline="always" external={false} externalLabel="" className={focus}>{label}</Link>
}

export function Loading() {
  const { t } = useTranslation('pages.console-flow-run-page')
  return <section role="status" aria-label={t('loading')} aria-busy={true} data-testid="run-loading"><h1 className="text-lg font-semibold">{t('loading')}</h1><Text variant="body" tone="muted">{t('loadingDescription')}</Text><PageSkeleton stats={0} rows={4} label={t('loading')} className="min-w-0" /></section>
}

// 403 shows the access-denied empty state with the backend reason, 404 the not-found state linking
// back to the run history, anything else (including a network error) the error panel with retry.
export function LoadFailure({ flowId, error, retry }: { flowId: string; error: Failure; retry: () => void }) {
  const { t } = useTranslation('pages.console-flow-run-page')
  return <section data-testid="run-load-error"><h1 className="text-lg font-semibold">{t('title')}</h1>
    {error.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => error.message || t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : error.status === 404 ? <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={<BackLink href={runsHref(flowId)} label={t('backToRuns')} />} titleAs="h2" bordered={false} className="min-w-0" />
      : <ErrorPanel title={t('errorTitle')} message={t('errorDescription')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0" labels={errorLabels(t)} />}
  </section>
}

// Both missing ids and a missing workspace render the blocked state; only the latter offers a picker.
export function WorkspaceGate({ missingIds = false }: { missingIds?: boolean }) {
  const { t } = useTranslation('pages.console-flow-run-page')
  const context = useConsoleContext()
  const { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (!missingIds && context.loading) return <section role="status" aria-label={t('workspaceLoading')} aria-busy={true}><h2 className="text-lg font-semibold">{t('workspaceLoading')}</h2><Text variant="body" tone="muted">{t('workspaceLoadingDescription')}</Text><TableSkeleton rows={3} columns={1} label={t('workspaceLoading')} className="min-w-0" /></section>
  if (!missingIds && context.error) return <ErrorPanel title={t('workspaceError')} message={t('workspaceErrorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={() => void context.reloadWorkspaces?.()} className="min-w-0" labels={{ ...errorLabels(t), title: t('workspaceError'), message: t('workspaceErrorDescription') }} />
  return <EmptyState icon={undefined} title={t('blocked')} description={t(missingIds ? 'missingIds' : 'workspaceDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0" primaryAction={missingIds ? <BackLink href="/console/flows" label={t('backToFlows')} /> : context.workspaces.length ?
    <Field invalid={false}><FieldLabel htmlFor="run-workspace">{t('workspace')}</FieldLabel><SimpleSelect id="run-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link> : <Text variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}
