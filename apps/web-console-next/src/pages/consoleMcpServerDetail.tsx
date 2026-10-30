import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { Badge, Button, CodeBlock, CopyButton, EmptyState, Field, FieldLabel, I18nProvider, JsonViewer, Link, LiveAnnouncer, Page, SimpleSelect, StatusTag, Tabs, TabsList, TabsPanel, TabsTab, Text, Textarea, useAnnounce } from '@gntik-ai/ui'
import { DescriptionListCard, ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, PageHeader, PageSkeleton, SectionHeader, StatusTimeline } from '@gntik-ai/blocks'
import { ResourceDetailPage } from '@gntik-ai/templates'
import type { JsonValue, ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import './consoleMcpServerDetail/page.css'
import i18n from '../i18n'
import es from '../locales/es/pages.console-mcp-server-detail-page.json'
import en from '../locales/en/pages.console-mcp-server-detail-page.json'
import { connectionSnippets, fetchMcpServerDetail, invokeMcpTool, toMcpServerDetailViewModel, type InvokeMcpToolResult, type McpServerDetailView } from './consoleMcpServerDetail/api'

i18n.addResourceBundle('es', 'pages.console-mcp-server-detail-page', es)
i18n.addResourceBundle('en', 'pages.console-mcp-server-detail-page', en)
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const useCopy = () => useTranslation('pages.console-mcp-server-detail-page')
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>
function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined, requestId: error.requestId ?? error.correlationId }
}
function Copy({ value, name }: { value: string; name: string }) {
  const { t } = useCopy()
  const [failed, setFailed] = useState(false)
  return <><CopyButton value={value} display="label" label={t('copy', { name })} copiedLabel={t('copied')} announcement={t('copyAnnouncement')}
    failureLabel={t('copyFailure')} failureAnnouncement={t('copyFailure')} failurePoliteness="assertive" tooltip={false} resetAfter={2500}
    onCopy={() => setFailed(false)} onCopyError={() => setFailed(true)} variant="secondary" size="sm" loading={false} disabled={false} type="button" className={`max-w-full whitespace-normal ${focus}`} />{failed && <Text as="p" variant="body" tone="muted">{t('clipboardUnavailable')}</Text>}</>
}
function Loading({ workspace = false }: { workspace?: boolean }) {
  const { t } = useCopy()
  return <section role="status" aria-label={t(workspace ? 'workspaceLoading' : 'loading')} aria-busy={true}>
    <Text as="p" variant="body" tone="muted">{t(workspace ? 'workspaceLoadingDescription' : 'loadingDescription')}</Text>
    <PageSkeleton stats={0} rows={3} label={t(workspace ? 'workspaceLoading' : 'loading')} className="min-w-0" />
  </section>
}
function FailurePanel({ failure, workspace = false, retry }: { failure: Failure; workspace?: boolean; retry: () => void }) {
  const { t } = useCopy()
  const title = t(workspace ? 'workspaceError' : 'errorTitle'), message = t(workspace ? 'workspaceErrorDescription' : failure.status && [401, 409, 429].includes(failure.status) ? `errors.${failure.status}` : failure.status && failure.status >= 500 ? 'errors.server' : 'errorDescription')
  return <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.status === 500 ? failure.requestId ?? '' : ''}
    details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0"
    labels={{ title, message, support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copyAnnouncement'), details: t('details') }} />
}
function Callout({ title, description }: { title: string; description: string }) {
  return <InlineCallout tone="info" title={title} description={description} actions={[]} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title, description, upgrade: '', viewUsage: '' }} />
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
function Connect({ view }: { view: McpServerDetailView }) {
  const { t } = useCopy()
  return <section className="min-w-0 space-y-4" data-testid="mcp-connect-panel">
    <SectionHeader title={t('connectTitle')} description={t('connectDescription')} count={undefined} actions={[]} as="h2" bordered={false} headingId="mcp-connect-heading" className="min-w-0" />
    <SectionHeader title={t('snippetsTitle')} description={t('snippetsDescription')} count={undefined} actions={[]} as="h3" bordered={false} headingId="mcp-snippets-heading" className="min-w-0" />
    {connectionSnippets(view).map(({ id, code, slug, endpoint }) => <div key={id} aria-labelledby={`mcp-${id}`} className="min-w-0 space-y-2">
      <h4 id={`mcp-${id}`} className="text-base font-semibold">{t(id)}</h4>
      <CodeBlock code={code} language={undefined} filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={384} highlight={undefined} label={t(id)} className="min-w-0 max-w-full" />
      <Copy value={code} name={t(id)} />
      <Text as="p" variant="body" tone="muted">{t('oauthNote')}</Text>
      {!view.endpoint && <Text as="p" variant="body" tone="muted">{t('endpointNote')}</Text>}
      <Text as="p" variant="body" tone="muted">{t(`${id}Note`, { slug, endpoint })}</Text>
    </div>)}
  </section>
}
function Playground({ workspaceId, serverId, view }: { workspaceId: string; serverId: string; view: McpServerDetailView }) {
  const { t } = useCopy()
  const announce = useAnnounce()
  const [toolName, setToolName] = useState(view.tools[0]?.name ?? '')
  const [argumentsText, setArgumentsText] = useState('{}')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'invalidJson' | 'invokeError' | null>(null)
  const [result, setResult] = useState<InvokeMcpToolResult | null>(null)
  const pending = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      if (document.activeElement === document.body || document.activeElement === trigger.current) trigger.current?.focus()
      restoreFocus.current = false
    }
  }, [busy])
  const selected = view.tools.find((tool) => tool.name === toolName)
  const disabled = !view.endpoint || !selected || busy || !view.runtimeReady
  async function invoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || pending.current) return
    setError(null); setResult(null)
    let args: Record<string, JsonValue>
    try { args = JSON.parse(argumentsText || '{}') as Record<string, JsonValue> }
    catch { setError('invalidJson'); announce(t('invalidJson'), 'assertive'); return }
    restoreFocus.current = document.activeElement === trigger.current
    pending.current = true; setBusy(true)
    const request = new AbortController(); controller.current = request
    try {
      const response = await invokeMcpTool(workspaceId, view.id ?? serverId, toolName, args, request.signal)
      if (!request.signal.aborted) { setResult(response); announce(t('resultAnnouncement'), 'polite') }
    } catch {
      if (!request.signal.aborted) { setError('invokeError'); announce(t('invokeError'), 'assertive') }
    } finally { if (!request.signal.aborted) { pending.current = false; setBusy(false) } }
  }
  if (!view.tools.length) return <EmptyState icon={undefined} title={t('playgroundEmpty')} description={t('playgroundEmptyDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} size="md" className="min-w-0" />
  return <form onSubmit={(event) => void invoke(event)} aria-busy={busy} className="min-w-0 space-y-5" data-testid="mcp-playground">
    <SectionHeader title={t('playground')} description={t('playgroundDescription')} count={undefined} actions={[]} as="h2" bordered={false} headingId="mcp-playground-heading" className="min-w-0" />
    <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
      <Field invalid={false} className="min-w-0 space-y-2"><FieldLabel htmlFor="mcp-tool">{t('tool')}</FieldLabel>
        <SimpleSelect id="mcp-tool" value={toolName} defaultValue="" placeholder={t('toolPlaceholder')} clearable={false} size="md" disabled={busy} className={`w-full min-w-0 ${focus}`} aria-describedby="mcp-tool-context"
          items={view.tools.map((tool) => ({ value: tool.name, label: tool.mutates ? t('mutatingOption', { name: tool.name }) : tool.name }))} onValueChange={(value) => setToolName(value ?? '')} />
        <div id="mcp-tool-context" className="space-y-2 wrap-anywhere">
          {selected?.description && <Text as="p" variant="body" tone="muted">{selected.description}</Text>}
          <Text as="p" variant="body" tone="muted">{t(selected?.mutates ? 'mutatingNote' : 'readOnlyNote')}{selected?.scope ? t('suggestedScope', { scope: selected.scope }) : ''}</Text>
        </div>
      </Field>
      <Field invalid={error === 'invalidJson'} className="min-w-0 space-y-2"><FieldLabel htmlFor="mcp-arguments">{t('arguments')}</FieldLabel>
        <Textarea id="mcp-arguments" value={argumentsText} defaultValue="" onValueChange={setArgumentsText} rows={7} disabled={busy} invalid={error === 'invalidJson'} aria-invalid={error === 'invalidJson'} aria-describedby={error ? 'mcp-args-help mcp-invoke-error' : 'mcp-args-help'} clearable={false} clearLabel="" onClear={undefined} autosize={false} resize="vertical" size="md" className={`w-full min-w-0 font-mono ${focus}`} />
        <Text as="p" id="mcp-args-help" variant="body" tone="muted">{t('argumentsHelp')}</Text>
      </Field>
    </div>
    {!view.endpoint && <Callout title={t('noEndpoint')} description={t('noEndpointDescription')} />}
    {!view.runtimeReady && <Callout title={t('runtimeUnavailable')} description="" />}
    {busy && <Callout title={t('invoking')} description="" />}
    <Button ref={trigger} type="submit" variant="secondary" size="md" loading={false} disabled={disabled} aria-busy={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={`w-full sm:w-auto ${focus}`}>{t(busy ? 'invoking' : 'invoke')}</Button>
    {error && <Text as="p" id="mcp-invoke-error" variant="body" tone="destructive">{t(error)}</Text>}
    {result && <section aria-labelledby="mcp-result-heading" className="min-w-0 space-y-3"><h3 id="mcp-result-heading" className="font-semibold">{t('result')}</h3>
      <JsonViewer data={result} label={t('result')} defaultExpandDepth={3} maxDepth={20} search="" toolbar={false} maxHeight={384} maxDisplayChars={100000} emptyContent={t('missing')} className="min-w-0 max-w-full"
        labels={{ copyPath: t('jsonCopyPath'), copyValue: t('jsonCopyValue'), copied: t('copied'), copyFailed: t('copyFailure'), selectHint: t('jsonSelect'), truncated: t('jsonTruncated'), copyFullHint: t('jsonFull'), keys: (count) => t('jsonKeys', { count }), items: (count) => t('jsonItems', { count }), root: t('jsonRoot') }} />
    </section>}
  </form>
}
function Content({ workspaceId, serverId }: { workspaceId: string; serverId: string }) {
  const { t } = useCopy()
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ attempt: number; view?: McpServerDetailView; error?: Failure }>({ attempt: -1 })
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    // Defer starting until effect replay settles, without sharing an aborted request.
    void Promise.resolve().then(async () => {
      if (!active) return
      try {
        const payload = await fetchMcpServerDetail(workspaceId, serverId, controller.signal)
        if (active) setLoaded({ attempt, view: toMcpServerDetailViewModel(payload) })
      } catch (cause) { if (active) setLoaded({ attempt, error: failureFrom(cause) }) }
    })
    return () => { active = false; controller.abort() }
  }, [workspaceId, serverId, attempt])
  const view = loaded.attempt === attempt ? loaded.view : undefined
  const error = loaded.attempt === attempt ? loaded.error : undefined
  if (!view) return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0" header={<Header />}>
    {error?.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : error?.status === 404 ? <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} titleAs="h2" bordered={false} className="min-w-0" action={<Link href="/console/overview" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('backOverview')}</Link>} />
        : error ? <FailurePanel failure={error} retry={() => setAttempt((value) => value + 1)} /> : <Loading />}
  </Page>
  const status = view.status ?? t('noStatus')
  return <>
    <ResourceDetailPage shell={null} readOnly={true} name={view.name ?? serverId} description={t('description')} status="" breadcrumbs={[]} meta={[]} actions={[]} details={[]}
      overviewTitle={t('configuration')} overviewDescription="" historyTitle={t('history')} history={[]} events={[]} activity={[]} dangerActions={[]}
      onEditDetails={undefined} onSaveSettings={undefined} onDangerAction={undefined} tabs={[]} defaultTab="" onTabChange={undefined}
      labels={{ overview: t('configuration'), activity: t('history'), settings: t('configuration'), sections: t('tabs') }} />
    <div className="space-y-6 p-4 sm:p-6" data-testid="mcp-server-detail">
      <DescriptionListCard title={t('configuration')} description="" items={[
        { id: 'endpoint', label: t('endpoint'), value: view.endpoint ?? t('unpublished'), mono: false, copyable: false, render: <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="break-all" data-testid="mcp-detail-endpoint">{view.endpoint ?? t('unpublished')}</span>{view.endpoint && <Copy value={view.endpoint} name={t('endpoint')} />}</span> },
        { id: 'version', label: t('version'), value: view.version ?? t('missing'), mono: false, copyable: false },
        { id: 'status', label: t('status'), value: status, mono: false, copyable: false, render: <StatusTag status={status} label={status} statuses={{ [status]: { label: status, tone: 'neutral' } }} uppercase={false} /> },
      ]} wrap={true} columns={3} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="mcp-description min-w-0"
        labels={{ title: t('configuration'), description: '', edit: '', copy: (name) => t('copy', { name }), copied: () => t('copied'), copiedToClipboard: t('copyAnnouncement') }} />
      <div className="space-y-3"><SectionHeader title={t('history')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId="mcp-history-heading" className="min-w-0" />
        <StatusTimeline events={[]} label={t('history')} emptyLabel={t('emptyHistory')} showFewerLabel={t('showFewer')} showEarlierLabel={(count) => t('showEarlier', { count })} actorLabel={t('actor')} maxVisible={undefined} timeFormat="absolute" className="min-w-0" />
      </div>
      <section aria-labelledby="mcp-tools-heading" className="min-w-0 space-y-3">
        <SectionHeader title={<span className="flex flex-wrap items-center gap-2">{t('tools')}<Badge tone="neutral" variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('toolCount', { count: view.tools.length })}</Badge></span>} description={null} count={undefined} actions={[]} as="h2" bordered={true} headingId="mcp-tools-heading" className="min-w-0" />
        {view.tools.length ? <ul className="divide-y divide-border" data-testid="mcp-detail-tools">{view.tools.map((tool) => <li key={tool.name} className="min-w-0 space-y-2 py-3">
          <div className="flex flex-wrap items-center gap-2"><span className="break-all font-medium">{tool.name}</span>{tool.mutates && <Badge tone="neutral" variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('mutates')}</Badge>}{tool.scope && <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className="max-w-full whitespace-normal break-all">{t('scope', { scope: tool.scope })}</Badge>}</div>
          {tool.description && <Text as="p" variant="body" tone="muted">{tool.description}</Text>}
        </li>)}</ul> : <EmptyState icon={undefined} title={t('noTools')} description={null} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false} size="sm" className="min-w-0" />}
      </section>
      <Tabs variant="underline" defaultValue="connect" orientation="horizontal" className="min-w-0">
        <TabsList activateOnFocus={true} indicator={false} fullWidth={false} aria-label={t('tabs')} className="flex max-w-full flex-wrap"><TabsTab value="connect" className={focus}>{t('connect')}</TabsTab><TabsTab value="playground" className={focus}>{t('playground')}</TabsTab></TabsList>
        <TabsPanel value="connect" className={`min-w-0 ${focus}`}><Connect view={view} /></TabsPanel>
        <TabsPanel value="playground" className={`min-w-0 ${focus}`}><Playground workspaceId={workspaceId} serverId={serverId} view={view} /></TabsPanel>
      </Tabs>
    </div>
  </>
}
function Header() {
  const { t } = useCopy()
  return <PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('tabs') }} />
}
export default function ConsoleMcpServerDetailPage() {
  const { t, i18n: language } = useCopy()
  const { mcpServerId = '' } = useParams()
  const { activeWorkspaceId } = useConsoleContext()
  return <I18nProvider locale={language.language}><LiveAnnouncer><div className="console-mcp-server-detail min-w-0 wrap-anywhere" data-testid="console-mcp-server-detail-page">
    {activeWorkspaceId ? <Content key={`${activeWorkspaceId}/${mcpServerId}`} workspaceId={activeWorkspaceId} serverId={mcpServerId} /> : <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} header={<Header />} className="min-w-0"><WorkspaceGate /></Page>}
  </div></LiveAnnouncer></I18nProvider>
}
