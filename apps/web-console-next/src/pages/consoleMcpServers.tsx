import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { EmptyState, Field, FieldLabel, I18nProvider, Link, SimpleSelect, Page, StatusTag, Text } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, PageHeader, PageSkeleton } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import i18n from '../i18n'
import es from '../locales/es/pages.console-mcp-servers-page.json'
import en from '../locales/en/pages.console-mcp-servers-page.json'
import { listMcpServers, type McpServerSummary } from './consoleMcpServers/api'

i18n.addResourceBundle('es', 'pages.console-mcp-servers-page', es)
i18n.addResourceBundle('en', 'pages.console-mcp-servers-page', en)
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const useCopy = () => useTranslation('pages.console-mcp-servers-page')
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>
function FailurePanel({ failure, workspace = false, retry }: { failure: Failure; workspace?: boolean; retry: () => void }) {
  const { t } = useCopy()
  const title = t(workspace ? 'workspaceError' : 'errorTitle'), message = t(workspace ? 'workspaceErrorDescription' : failure.status && [401, 409, 429].includes(failure.status) ? `errors.${failure.status}` : failure.status && failure.status >= 500 ? 'errors.server' : 'errorDescription')
  return <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.status === 500 ? failure.requestId ?? '' : ''}
    details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0"
    labels={{ title, message, support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copyAnnouncement'), details: t('details') }} />
}
function Loading({ workspace = false }: { workspace?: boolean }) {
  const { t } = useCopy()
  return <section role="status" aria-label={t(workspace ? 'workspaceLoading' : 'loading')} aria-busy={true}>
    <Text as="p" variant="body" tone="muted">{t(workspace ? 'workspaceLoadingDescription' : 'loadingDescription')}</Text>
    <PageSkeleton stats={0} rows={3} label={t(workspace ? 'workspaceLoading' : 'loading')} className="min-w-0" />
  </section>
}
function WorkspaceGate() {
  const { t } = useCopy()
  const context = useConsoleContext()
  const { can } = usePermissions()
  if (context.loading) return <Loading workspace={true} />
  if (context.error) return <FailurePanel failure={context.error} workspace={true} retry={() => { void context.reloadWorkspaces?.() }} />
  return <EmptyState icon={undefined} title={t('workspaceRequired')} description={t('workspaceDescription')} titleAs="h2" bordered={false} size="md" secondaryAction={null} className="min-w-0"
    primaryAction={context.workspaces.length ? <Field invalid={false} className="w-full min-w-0"><FieldLabel htmlFor="mcp-workspace">{t('workspaceLabel')}</FieldLabel>
      <SimpleSelect id="mcp-workspace" value="" defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" disabled={false} className={`w-full min-w-0 ${focus}`}
        items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(value) => { if (value) context.selectWorkspace(value) }} />
    </Field> : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link>
      : <Text as="p" variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}
function Content({ workspaceId }: { workspaceId: string }) {
  const { t } = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ attempt: number; rows?: McpServerSummary[]; error?: Failure }>({ attempt: -1 })
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    // Wait for effect replay to settle so StrictMode also starts just one request.
    void Promise.resolve().then(async () => {
      if (!active) return
      try {
        const response = await listMcpServers(workspaceId, controller.signal)
        if (active) setLoaded({ attempt, rows: response.items })
      } catch (cause) { if (active) {
        const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
        setLoaded({ attempt, error: { status: error.status, requestId: error.requestId ?? error.correlationId } })
      } }
    })
    return () => { active = false; controller.abort() }
  }, [workspaceId, attempt])
  const rows = loaded.attempt === attempt ? loaded.rows : undefined
  const error = loaded.attempt === attempt ? loaded.error : undefined
  if (error?.status === 403) return <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
  if (error?.status === 404) return <EmptyState icon={undefined} title={t('unavailable')} description={t('unavailableDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />
  if (error) return <FailurePanel failure={error} retry={() => setAttempt((value) => value + 1)} />
  if (!rows) return <Loading />
  if (!rows.length) return <EmptyState icon={undefined} title={t('empty')} description={t('emptyDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />
  return <table className="w-full table-fixed text-left"><caption className="sr-only">{t('title')}</caption><thead><tr>{['name', 'status', 'lifecycle'].map((key) => <th key={key} scope="col" className="p-2">{t(key)}</th>)}</tr></thead>
    <tbody>{rows.map((server) => <tr key={server.serverId} className="border-t border-border">
      <th scope="row" className="p-2 font-normal"><Link render={<RouterLink to={`/console/mcp/servers/${encodeURIComponent(server.serverId)}`} />} tone="primary" underline="always" external={false} externalLabel="" className={`wrap-anywhere ${focus}`}>{server.name.trim() || server.serverId}</Link></th>
      <td className="p-2"><StatusTag status={server.status} label={t(`statuses.${server.status}`)} statuses={{ [server.status]: { label: t(`statuses.${server.status}`), tone: 'neutral' } }} uppercase={false} /></td>
      <td className="p-2 wrap-anywhere">{server.lifecycleStatus || server.version || t('missing')}</td>
    </tr>)}</tbody></table>
}
export default function ConsoleMcpServersPage() {
  const { t, i18n: language } = useCopy()
  const { activeWorkspaceId } = useConsoleContext()
  return <I18nProvider locale={language.language}><Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-4 wrap-anywhere" data-testid="console-mcp-servers-page"
    header={<PageHeader as="div" wrapTitle={true} title={t('title')} description="" breadcrumbs={[]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description: '', moreActions: t('actions'), sections: t('actions') }} />}>
    {activeWorkspaceId ? <Content key={activeWorkspaceId} workspaceId={activeWorkspaceId} /> : <WorkspaceGate />}
  </Page></I18nProvider>
}
