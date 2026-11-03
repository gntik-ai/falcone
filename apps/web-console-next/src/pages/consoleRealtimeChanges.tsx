import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState, Field, FieldLabel, I18nProvider, Link, LiveAnnouncer, Page, SimpleSelect, Text } from '@gntik-ai/ui'
import { ErrorPanel, PageHeader, TableSkeleton } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import i18n from '../i18n'
import es from '../locales/es/pages.console-realtime-changes-page.json'
import en from '../locales/en/pages.console-realtime-changes-page.json'
import { RealtimeConsole } from './consoleRealtimeChanges/Console'

i18n.addResourceBundle('es', 'pages.console-realtime-changes-page', es)
i18n.addResourceBundle('en', 'pages.console-realtime-changes-page', en)
const useCopy = () => useTranslation('pages.console-realtime-changes-page')
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

// Legacy WorkspaceRequiredState: loading, error with Reintentar, picker, create link gated by permission, else a denial note.
function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (context.loading) return <section role="status" aria-label={t('workspaceLoading')}><Text variant="body" tone="default">{t('workspaceLoading')}</Text><Text variant="body" tone="muted">{t('workspaceLoadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={2} columns={1} label={t('workspaceLoadingDescription')} className="min-w-0" /></div></section>
  if (context.error) return <ErrorPanel title={t('workspaceError')} message={t('workspaceErrorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} onRetry={() => { void context.reloadWorkspaces?.() }} className="min-w-0"
    labels={{ title: t('workspaceError'), message: t('workspaceErrorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
  return <EmptyState icon={undefined} title={t('workspaceRequired')} description={t('workspaceDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0" primaryAction={context.workspaces.length ?
    <Field invalid={false} className="w-full min-w-0"><FieldLabel htmlFor="realtime-changes-workspace">{t('workspaceLabel')}</FieldLabel><SimpleSelect id="realtime-changes-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" className="w-full min-w-0" items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link> : <Text variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}

export default function ConsoleRealtimeChangesPage() {
  const { t, i18n: language } = useCopy()
  const context = useConsoleContext()
  // Keyed by workspace so a switch closes the open stream.
  const body = context.activeWorkspaceId ? <RealtimeConsole key={context.activeWorkspaceId} workspaceId={context.activeWorkspaceId} /> : <WorkspaceGate />
  return <I18nProvider locale={language.language}><LiveAnnouncer>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('title')} className="console-realtime-changes min-w-0 space-y-6 wrap-anywhere" data-testid="console-realtime-changes-page"
      header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('title'), sections: t('title') }} />}>
      {body}
    </Page>
  </LiveAnnouncer></I18nProvider>
}
