import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, EmptyState, Field, FieldDescription, FieldLabel, I18nProvider, Input, JsonViewer, Link, LiveAnnouncer, Page, SimpleSelect, Text, Textarea, ToastProvider, Toaster, useAnnounce, useHasLiveAnnouncer, useToast } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, FormSection, InlineCallout, NoAccessEmpty, NotFoundEmpty, PageHeader, PageToolbar, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { ApiError, JsonValue } from '@in-falcone/console-api/http'
import { STRUCTURAL_WRITE_ADMIN_ROLES } from '@in-falcone/console-api/permissions'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import i18n from '../i18n'
import es from '../locales/es/pages.console-events-data-page.json'
import en from '../locales/en/pages.console-events-data-page.json'
import { consumeMessages, createTopic, listTopics, publishMessage, type EventMessage, type TopicRecord } from './consoleEventsData/api'
import './consoleEventsData/page.css'

i18n.addResourceBundle('es', 'pages.console-events-data-page', es)
i18n.addResourceBundle('en', 'pages.console-events-data-page', en)
const useCopy = () => useTranslation('pages.console-events-data-page')
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
type Failure = { status?: number; requestId: string; message: string }
type Operation = 'create' | 'publish' | 'consume'
const failureFrom = (cause: unknown): Failure => {
  const error = (cause ?? {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId ?? '', message: typeof error.message === 'string' ? error.message : '' }
}
function Empty({ title, description = '', action = null }: { title: string; description?: string; action?: ComponentProps<typeof EmptyState>['primaryAction'] }) {
  return <EmptyState icon={undefined} title={title} description={description} titleAs="h2" bordered={false} primaryAction={action} secondaryAction={null} className="min-w-0" />
}
function FailurePanel({ failure, retry, workspace = false }: { failure: Failure; retry: () => void; workspace?: boolean }) {
  const { t } = useCopy(), title = t(workspace ? 'workspaceError' : failure.status ? 'listError' : 'networkError')
  return <ErrorPanel title={title} message={failure.message || t('requestFailed')} code={failure.status ?? null} requestId={failure.requestId} details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0" labels={{ title, message: failure.message || t('requestFailed'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}
function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  if (context.loading) return <section role="status"><h2>{t('workspaceLoading')}</h2><Text as="p" variant="body" tone="muted">{t('workspaceLoadingDescription')}</Text><TableSkeleton rows={2} columns={1} label={t('workspaceLoading')} className="min-w-0" /></section>
  if (context.error) return <FailurePanel workspace={true} failure={failureFrom(context.error)} retry={() => void context.reloadWorkspaces?.()} />
  return <Empty title={t('workspaceRequired')} description={t('workspaceDescription')} action={context.workspaces.length
    ? <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="events-workspace">{t('workspaceLabel')}</FieldLabel><SimpleSelect id="events-workspace" value="" defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(id) => { if (id) context.selectWorkspace(id) }} className={`w-full min-w-0 ${focus}`} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link>
    : <Text as="p" variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}
function EventsConsole({ workspaceId, canWrite }: { workspaceId: string; canWrite: boolean }) {
  const { t } = useCopy(), announce = useAnnounce(), toast = useToast()
  const feedback = useRef({ t, announce, toast })
  useLayoutEffect(() => { feedback.current = { t, announce, toast } }, [t, announce, toast])
  const mounted = useRef(false), sequence = useRef(0), pending = useRef(false)
  const initial = useRef<ReturnType<typeof listTopics> | null>(null), announced = useRef(false)
  const listRoot = useRef<HTMLElement>(null), restoreList = useRef(false), restoreAction = useRef<Operation | null>(null)
  const [topics, setTopics] = useState<TopicRecord[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState<Failure | null>(null)
  const [selected, setSelected] = useState(''), [newTopic, setNewTopic] = useState(''), [input, setInput] = useState('{"value":{}}')
  const [messages, setMessages] = useState<EventMessage[]>([]), [consumed, setConsumed] = useState(false), [timedOut, setTimedOut] = useState(false)
  const [operation, setOperation] = useState<Operation | null>(null), [error, setError] = useState<Failure | null>(null), [validation, setValidation] = useState(''), [notFound, setNotFound] = useState(false)
  const reload = useCallback(async (request?: ReturnType<typeof listTopics>) => {
    const token = ++sequence.current
    setLoading(true); setLoadError(null)
    if (!request || !announced.current) { feedback.current.announce(feedback.current.t('loading'), 'polite'); announced.current = true }
    try {
      const result = await (request ?? listTopics(workspaceId))
      if (!mounted.current || token !== sequence.current) return
      setTopics(result.items); setSelected((current) => result.items.some((topic) => topic.topic === current) ? current : '')
    } catch (cause) {
      if (!mounted.current || token !== sequence.current) return
      setTopics([]); setMessages([]); setConsumed(false); setTimedOut(false); setLoadError(failureFrom(cause))
      feedback.current.announce(feedback.current.t('listError'), 'assertive')
    } finally { if (mounted.current && token === sequence.current) setLoading(false) }
  }, [workspaceId])
  useEffect(() => {
    mounted.current = true
    // StrictMode replays effects; reuse the initial request instead of sending it twice.
    initial.current ??= listTopics(workspaceId)
    void reload(initial.current)
    return () => { mounted.current = false }
  }, [workspaceId, reload])
  useLayoutEffect(() => {
    if (loading || !restoreList.current) return
    restoreList.current = false
    const target = listRoot.current?.querySelector<HTMLElement>(loadError ? 'button' : 'table')
    if (target) { target.tabIndex = -1; target.classList.add(...focus.split(' ')); target.focus() }
  }, [loading, loadError])
  useLayoutEffect(() => {
    if (operation || !restoreAction.current) return
    const op = restoreAction.current; restoreAction.current = null
    const target = document.getElementById(notFound ? 'events-back' : `events-${op}-button`) as HTMLButtonElement | null
    if (op === 'create' && target?.disabled) document.getElementById('events-new-topic')?.focus()
    else target?.focus()
  }, [operation, notFound])
  const busy = operation !== null
  const notify = (key: string, target: string, count?: number) => {
    const { t: tr, announce: say, toast: show } = feedback.current
    const title = tr(key, { topic: target, count }); show.add({ title, tone: 'success', priority: 'low' }); say(title, 'polite')
  }
  async function run(op: Operation) {
    if (pending.current || ((op === 'create' || op === 'publish') && !canWrite)) return
    const target = selected, name = newTopic.trim()
    if (op === 'create' && !name) return
    if (op !== 'create' && !target) { setValidation(op === 'publish' ? 'selectPublish' : 'selectConsume'); return }
    let payload: JsonValue = null
    setValidation(''); setError(null)
    if (op === 'publish') {
      try { payload = JSON.parse(input) as JsonValue } catch { setValidation('invalidJson'); announce(t('invalidJson'), 'assertive'); return }
    }
    pending.current = true; setOperation(op); restoreAction.current = op
    try {
      if (op === 'create') {
        const created = await createTopic(workspaceId, name)
        if (!mounted.current) return
        const createdTopic = created.topic || name
        setNewTopic(''); await reload()
        if (!mounted.current) return
        setSelected(createdTopic); notify('created', createdTopic)
      } else if (op === 'publish') {
        await publishMessage(workspaceId, target, payload)
        if (mounted.current) notify('published', target)
      } else {
        const result = await consumeMessages(workspaceId, target, { maxMessages: 10 })
        if (!mounted.current) return
        setMessages(result.items); setConsumed(true); setTimedOut(result.status === 'timeout'); notify('consumed', target, result.items.length)
      }
    } catch (cause) {
      if (!mounted.current) return
      const failure = failureFrom(cause)
      if (failure.status === 404 && op !== 'create') setNotFound(true)
      else if (!failure.status) { setMessages([]); setConsumed(false); setTimedOut(false); setLoadError(failure) }
      else setError(failure)
      announce(`${t('errorTitle')}: ${failure.message || t('requestFailed')}`, 'assertive')
    } finally { pending.current = false; if (mounted.current) setOperation(null) }
  }
  function select(topic: string) { setSelected(topic); setError(null); setValidation(''); announce(t('selected', { topic }), 'polite') }
  function back() { setSelected(''); setNotFound(false); setError(null); setMessages([]); setConsumed(false); setTimedOut(false); restoreList.current = true; void reload() }
  const columns: DataTableColumn<TopicRecord>[] = [
    { id: 'topic', header: t('name'), sortable: false, cell: (topic) => topic.topic },
    { id: 'partitions', header: t('partitions'), sortable: false, cell: (topic) => topic.partitions == null ? null : String(topic.partitions) },
  ]
  const viewerLabels = { copyPath: t('jsonCopyPath'), copyValue: t('jsonCopyValue'), copied: t('jsonCopied'), copyFailed: t('jsonCopyFailed'), selectHint: t('jsonSelectHint'), truncated: t('jsonTruncated'), copyFullHint: t('jsonCopyFullHint'), keys: (count: number) => t('jsonKeys', { count }), items: (count: number) => t('jsonItems', { count }), root: t('jsonRoot') }
  const callout = (description: string, tone: 'info' | 'destructive') => <InlineCallout tone={tone} title={tone === 'destructive' ? t('errorTitle') : t('readBadge')} description={description} actions={[]} labels={{ title: tone === 'destructive' ? t('errorTitle') : t('readBadge') }} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" />
  const action = (op: Operation, disabled: boolean, label: string) => <Button id={`events-${op}-button`} type={op === 'consume' ? 'button' : 'submit'} variant="primary" size="md" loading={false} disabled={disabled} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={op === 'consume' ? () => void run(op) : undefined}>{label}</Button>
  if (loadError?.status === 403) return <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => loadError.message || t('requestFailed'), request: '', requested: '', sent: '' }} />
  return <div className="min-w-0 space-y-6">
    {!canWrite ? callout(t('readNote'), 'info') : null}
    {error || validation ? <div id="events-validation">{callout(validation ? t(validation) : error?.message || t('requestFailed'), 'destructive')}</div> : null}
    {canWrite ? <form onSubmit={(event) => { event.preventDefault(); void run('create') }} className="min-w-0">
      <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('newTopic')} searchPlaceholder={t('placeholder')} views={[]} view="" defaultView="" onViewChange={undefined} className="events-toolbar min-w-0" aria-label={t('create')} primaryAction={null} filters={<div className="min-w-0 space-y-3"><Field invalid={false} disabled={busy} className="min-w-0"><FieldLabel htmlFor="events-new-topic">{t('newTopic')}</FieldLabel><Input id="events-new-topic" value={newTopic} onChange={(event) => setNewTopic(event.target.value)} placeholder={t('placeholder')} disabled={busy} invalid={false} size="md" aria-describedby="events-new-help" className={focus} /><FieldDescription id="events-new-help">{t('newTopicHelp')}</FieldDescription><Text as="p" variant="supporting" tone="muted">{t('createHelp')}</Text></Field>{action('create', busy || !newTopic.trim(), t(operation === 'create' ? 'creating' : 'create'))}</div>} />
    </form> : null}
    <section ref={listRoot} className="min-w-0 space-y-3" aria-label={t('listLegend')}>
      <SectionHeader title={t('listTitle', { count: topics.length })} description={t('listHelp')} count={undefined} actions={[]} as="h2" bordered={true} headingId="events-topics-heading" />
      {loading ? <div aria-busy={true} aria-label={t('loading')}><div aria-hidden={true}><TableSkeleton rows={3} columns={2} label={t('loading')} className="min-w-0" /></div></div>
        : loadError ? <FailurePanel failure={loadError} retry={() => { restoreList.current = true; void reload() }} />
        : !topics.length ? <Empty title={t('empty')} />
        : <DataTable rows={topics} columns={columns} getRowId={(topic) => topic.topic} getRowLabel={(topic) => topic.topic} caption={t('listLegend')} showCaption={false} paginated={false} selectionSummary={false} selectionMode="single" selectionName="topic" aria-label={t('listLegend')} selectedId={selected || null} onSelectedIdChange={select} isRowDisabled={() => false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className={`min-w-0 ${focus}`} labels={{ scrollRegion: t('listLegend'), selection: t('selection'), selectRow: (label) => label, emptyTitle: t('empty'), emptyDescription: '', loading: () => t('loading') }} />}
      <Text as="p" id="events-selected" variant="body" tone="muted" aria-live="polite">{selected ? t('selected', { topic: selected }) : t('noneSelected')}</Text>
    </section>
    {loadError ? null : notFound ? <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={<Button id="events-back" type="button" variant="secondary" size="md" disabled={false} loading={false} iconOnly={false} icon={undefined} trailingIcon={undefined} onClick={back} className={focus}>{t('back')}</Button>} titleAs="h2" bordered={false} className="min-w-0" />
      : <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        {canWrite ? <form onSubmit={(event) => { event.preventDefault(); void run('publish') }} className="min-w-0"><FormSection title={t('publish')} description={t('publishHelp')} headingLevel="h2" divided={false} actions={null} labels={{ title: t('publish'), description: t('publishHelp') }} className="min-w-0">
          <Field invalid={validation === 'invalidJson'} disabled={busy} className="min-w-0"><FieldLabel htmlFor="events-json">{t('messageJson', { example: '{ "value": { ... } }' })}</FieldLabel><Textarea id="events-json" value={input} onChange={(event) => setInput(event.target.value)} invalid={validation === 'invalidJson'} aria-invalid={validation === 'invalidJson'} aria-describedby={`events-selected events-json-help${validation ? ' events-validation' : ''}`} disabled={busy} rows={7} resize="vertical" size="md" className={`min-w-0 font-mono ${focus}`} /><FieldDescription id="events-json-help">{t('jsonHelp')}</FieldDescription></Field>
          {action('publish', busy || !selected, t(operation === 'publish' ? 'publishing' : 'publish'))}
        </FormSection></form> : null}
        <section className="min-w-0 space-y-3" aria-labelledby="events-consume-heading"><SectionHeader title={t('consumeTitle')} description={t('consumeHelp')} count={undefined} actions={[]} as="h2" bordered={true} headingId="events-consume-heading" />
          <Text as="p" variant="supporting" tone="muted">{messages.length ? t('messageCount', { count: messages.length }) : t('noMessagesLoaded')}</Text>
          {action('consume', busy || !selected, t(operation === 'consume' ? 'consuming' : 'consume'))}
          {operation === 'consume' ? <Text as="p" role="status" variant="body" tone="muted">{t('consumingStatus')}</Text> : <>
            {timedOut ? <Text as="p" role="status" variant="body" tone="muted">{t('timeout')}</Text> : null}
            {messages.length ? <ul className="min-w-0 space-y-4">{messages.map((message, index) => <li key={`${String(message.offset ?? index)}-${index}`} className="min-w-0 space-y-2"><JsonViewer data={message.value} label={t('messageValue', { index: index + 1 })} defaultExpandDepth={2} maxDepth={undefined} search="" toolbar={true} maxHeight={288} maxDisplayChars={undefined} emptyContent={undefined} labels={viewerLabels} className="min-w-0" /><div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
              {message.key != null ? <Text as="span" variant="supporting" tone="muted">{t('messageKey', { key: message.key })}</Text> : null}{message.partition != null ? <Text as="span" variant="supporting" tone="muted">{t('messagePartition', { partition: message.partition })}</Text> : null}{message.offset != null ? <Text as="span" variant="supporting" tone="muted">{t('messageOffset', { offset: message.offset })}</Text> : null}{message.timestamp ? <Text as="span" variant="supporting" tone="muted">{message.timestamp}</Text> : null}
            </div></li>)}</ul> : !timedOut ? <Empty title={t(consumed ? 'noMessages' : 'beforePoll')} /> : null}
          </>}
        </section>
      </div>}
  </div>
}
function LocalizedToaster() {
  const { t } = useCopy(), [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    const sync = () => {
      const region = container.querySelector('[role="region"]')
      if (region && region.getAttribute('aria-label') !== t('notifications')) region.setAttribute('aria-label', t('notifications'))
      region?.querySelectorAll('button[aria-hidden="true"]').forEach((button) => button.setAttribute('aria-hidden', 'false'))
    }
    sync(); const observer = new MutationObserver(sync)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-hidden'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}
export default function ConsoleEventsDataPage() {
  const { t, i18n: language } = useCopy(), context = useConsoleContext()
  const canWrite = (readConsoleShellSession()?.principal?.platformRoles ?? []).some((role) => STRUCTURAL_WRITE_ADMIN_ROLES.has(role))
  const Announcer = useHasLiveAnnouncer() ? Fragment : LiveAnnouncer
  const description = t(canWrite ? 'description' : 'readDescription')
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.loading': t('loading'), 'common.copy': t('copy'), 'common.copied': t('copied'), 'common.copyFailed': t('copyFailed') }}><Announcer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('title')} className="events-data min-w-0 space-y-6 wrap-anywhere" data-testid="console-events-data-page" header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={description} breadcrumbs={[]} status="" statuses={{}} meta={[{ label: '', value: <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t(canWrite ? 'writeBadge' : 'readBadge')}</Badge> }]} tabs={null} actions={[]} labels={{ title: t('title'), description, moreActions: t('title'), sections: t('title') }} />}>
      {context.activeWorkspaceId ? <EventsConsole key={context.activeWorkspaceId} workspaceId={context.activeWorkspaceId} canWrite={canWrite} /> : <WorkspaceGate />}
    </Page><LocalizedToaster />
  </ToastProvider></Announcer></I18nProvider>
}
