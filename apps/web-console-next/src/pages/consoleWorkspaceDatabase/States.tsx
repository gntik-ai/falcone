import { Button, EmptyState, Field, FieldLabel, Link, SimpleSelect, Text } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, NoAccessEmpty, TableSkeleton } from '@gntik-ai/blocks'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { describeFailure, focusRing, useCopy, type Failure } from './copy'

export function Action({ children, onClick, disabled = false }: { children: string; onClick: () => void; disabled?: boolean }) {
  return <Button type="button" variant="secondary" size="md" loading={false} disabled={disabled} icon={undefined} trailingIcon={undefined} iconOnly={false} onClick={onClick} className={focusRing}>{children}</Button>
}
export function FailureView({ failure, retry }: { failure: Failure; retry: () => void }) {
  const { t } = useCopy()
  const missing = failure.status === 404
  return <div role="alert" data-database-failure="" className="min-w-0 space-y-3">
    {failure.code === 'DB_SHARED_MODE' ? <div data-database-message="" tabIndex={-1} className={focusRing}><InlineCallout tone="warning" title={t('sharedConflict')} description="" labels={{ title: t('sharedConflict'), description: '', upgrade: '', viewUsage: '' }} actions={[]} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div> : failure.status === 403 ? <>
      <NoAccessEmpty resource="" owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0"
        labels={{ title: () => t('noAccess'), description: () => describeFailure(t, failure), request: '', requested: '', sent: '' }} />
      <Action onClick={retry}>{t('reload')}</Action>
    </> : missing ? <EmptyState title={t('notFound')} description={t('notFoundDescription')} icon={undefined} titleAs="h2" bordered={false} size="md" className="min-w-0" secondaryAction={null} primaryAction={<Action onClick={retry}>{t('reload')}</Action>} />
      : <ErrorPanel title={t('errorTitle')} message={describeFailure(t, failure)} code={failure.status ?? null} requestId={failure.requestId} details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0"
        labels={{ title: t('errorTitle'), message: describeFailure(t, failure), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('requestIdCopied'), requestIdCopied: t('requestIdCopied'), details: t('details') }} />}
  </div>
}
export function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  if (context.loading) return <section role="status" aria-label={t('workspace.loading')}><Text as="p" variant="body" tone="default">{t('workspace.loading')}</Text><TableSkeleton rows={2} columns={1} label={t('workspace.loadingDescription')} className="min-w-0" /></section>
  if (context.error) return <div role="alert"><ErrorPanel title={t('workspace.error')} message={t('workspace.errorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} onRetry={() => context.reloadWorkspaces?.()} className="min-w-0"
    labels={{ title: t('workspace.error'), message: t('workspace.errorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('requestIdCopied'), requestIdCopied: t('requestIdCopied'), details: t('details') }} /></div>
  const action = context.workspaces.length ? <Field invalid={false} disabled={false} className="w-full min-w-0"><FieldLabel htmlFor="database-workspace">{t('workspace.label')}</FieldLabel>
    <SimpleSelect id="database-workspace" value="" defaultValue="" placeholder={t('workspace.placeholder')} clearable={false} size="md" className="w-full min-w-0" items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(value) => { if (value) context.selectWorkspace(value) }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('workspace.create')}</Link>
      : <Text as="p" variant="body" tone="muted">{t('workspace.denied')}</Text>
  return <EmptyState title={t('workspace.title')} description={t('workspace.description')} icon={undefined} titleAs="h2" bordered={false} size="md" className="min-w-0" secondaryAction={null} primaryAction={action} />
}
