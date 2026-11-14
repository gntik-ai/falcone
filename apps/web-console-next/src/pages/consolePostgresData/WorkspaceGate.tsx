import { ErrorPanel } from '@gntik-ai/blocks'
import { Field, FieldLabel, Link, SimpleSelect, Text } from '@gntik-ai/ui'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { focusRing, useCopy } from './copy'
import { Empty, Heading, Loading } from './States'

// The shell's workspace states, as the legacy WorkspaceRequiredState rendered them: loading,
// error with Reintentar (any status, 403 included), picker, create link or denial note.
// The page sends no request of its own in any of them.
export function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  if (context.loading) return <section role="status" className="min-w-0 space-y-4"><Heading title={t('workspaceLoading')} description={t('workspaceLoadingDescription')} /><Loading label={t('workspaceLoading')} /></section>
  if (context.error) {
    const status = context.error.status
    return <div data-testid="pgdata-failure-workspace" className="min-w-0">
      <ErrorPanel title={t('workspaceError')} message={t(status ? 'serverError' : 'networkError')} code={status ?? null} requestId="" details="" secondaryAction={null} titleAs="h3" announce={true} onRetry={async () => { await context.reloadWorkspaces?.() }} retrying={false} retryLabel={t('retry')} className="min-w-0"
        labels={{ title: t('workspaceError'), message: t('serverError'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
    </div>
  }
  const picker = <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="pgdata-workspace">{t('workspacePicker')}</FieldLabel>
    <SimpleSelect id="pgdata-workspace" value="" defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(id) => context.selectWorkspace(id || null)} className={`w-full min-w-0 ${focusRing}`} /></Field>
  const create = <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('workspaceCreate')}</Link>
  const denied = <Text as="p" variant="body" tone="muted">{t('workspaceDenied')}</Text>
  return <Empty title={t('workspaceRequired')} description={t('workspaceDescription')} action={context.workspaces.length ? picker : can('tenant.workspaces.create') ? create : denied} />
}
