import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorPanel, TableSkeleton } from '@gntik-ai/blocks'
import { EmptyState, Field, FieldLabel, Link, SimpleSelect, Text } from '@gntik-ai/ui'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { focusRing } from './Failure'

// States before a workspace is active: loading, a workspace load failure, no organization, and the
// workspace picker. Parity with the legacy WorkspaceRequiredState.
export function Gate({ focusHeading }: { focusHeading: boolean }) {
  const { t } = useTranslation('pages.console-service-accounts-page')
  const context = useConsoleContext()
  const { can } = usePermissions()
  const container = useRef<HTMLDivElement>(null)
  // A tenant failure keeps the blocked state; a workspace failure after tenants loaded is retryable.
  const state = context.loading ? 'loading' : context.tenantsError ? 'blocked' : context.error && context.tenants.length ? 'error' : !context.activeTenantId ? 'blocked' : 'required'
  // After a context switch the keyboard lands on the settled state's heading, once loading ends.
  useEffect(() => {
    if (!focusHeading || state === 'loading') return
    const target = container.current?.querySelector<HTMLElement>('h2')
    if (target) { target.tabIndex = -1; target.focus() }
  }, [focusHeading, state])
  if (state === 'loading') return <section role="status" aria-label={t('states.workspaceLoading')} aria-busy={true} className="min-w-0">
    <Text as="p" variant="body" tone="muted">{t('states.workspaceLoadingDescription')}</Text>
    <TableSkeleton rows={3} columns={6} label={t('states.workspaceLoading')} className="min-w-0" />
  </section>
  if (state === 'error') return <div ref={container} className="min-w-0">
    <ErrorPanel title={t('states.workspaceError')} message={t('states.workspaceErrorDescription')} code={context.error?.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={true}
      retryLabel={t('failure.retry')} retrying={false} onRetry={() => { void context.reloadWorkspaces?.() }} className="min-w-0"
      labels={{ title: t('states.workspaceError'), message: t('states.workspaceErrorDescription'), support: t('failure.support'), retry: t('failure.retry'), retrying: t('failure.retrying'), retryingStatus: t('failure.retrying'), requestId: t('failure.requestId'), copyRequestId: t('failure.copyRequestId'), copied: t('failure.copiedLabel'), requestIdCopied: t('failure.requestIdCopied'), details: t('failure.details') }} />
  </div>
  if (state === 'blocked') return <div ref={container} className="min-w-0">
    <EmptyState icon={undefined} title={t('states.blockedTitle')} description={t('states.blockedDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} size="md" className="min-w-0" />
  </div>
  return <div ref={container} className="min-w-0">
    <EmptyState icon={undefined} title={t('states.workspaceRequired')} description={t('states.workspaceRequiredDescription')} secondaryAction={null} titleAs="h2" bordered={false} size="md" className="min-w-0"
      primaryAction={context.workspaces.length
        ? <Field invalid={false} className="w-full min-w-0"><FieldLabel htmlFor="service-accounts-workspace">{t('states.workspaceLabel')}</FieldLabel>
          <SimpleSelect id="service-accounts-workspace" value="" defaultValue="" placeholder={t('states.workspacePlaceholder')} clearable={false} size="md" disabled={false} className={`w-full min-w-0 ${focusRing}`}
            items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(value) => { if (value) context.selectWorkspace(value) }} /></Field>
        : can('tenant.workspaces.create')
          ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('states.createWorkspace')}</Link>
          : <Text as="p" variant="body" tone="muted">{t('states.workspaceDenied')}</Text>} />
  </div>
}
