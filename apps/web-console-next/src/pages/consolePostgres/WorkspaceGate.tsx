import { useState } from 'react'
import { EmptyState, Field, FieldLabel, Link, SimpleSelect, Text } from '@gntik-ai/ui'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { FailureView, Loading } from './Parts'
import { focusRing, useCopy } from './copy'

export function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (context.loading) return <div className="space-y-2"><Loading label={t('workspaceLoading')} /><Text as="p" variant="body" tone="muted">{t('workspaceLoadingDescription')}</Text></div>
  if (context.error) return <FailureView retryAllStatuses={true} failure={context.error} message={t('workspaceError')} retry={() => { void context.reloadWorkspaces?.() }} />
  return <EmptyState icon={undefined} title={t('workspaceRequired')} description={t('workspaceDescription')} titleAs="h3" bordered={false} size="md" secondaryAction={null} className="min-w-0" primaryAction={context.workspaces.length ?
    <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="pg-workspace">{t('workspacePicker')}</FieldLabel><SimpleSelect id="pg-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" className={`w-full min-w-0 ${focusRing}`} items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('createWorkspace')}</Link> : <Text as="p" variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}
