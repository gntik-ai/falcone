import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, EmptyState, I18nProvider, LiveAnnouncer, Page, Tabs, TabsList, TabsPanel, TabsTab, Text, ToastProvider, useAnnounce, useHasLiveAnnouncer, useToast } from '@gntik-ai/ui'
import { DescriptionListCard, PageHeader, StatusTimeline, TableSkeleton } from '@gntik-ai/blocks'
import { getWorkspaceDatabase, provisionWorkspaceDatabase, rotateWorkspaceDatabaseCredential, type DatabaseConnection, type RotateResponse, type WorkspaceDatabaseRecord } from '@in-falcone/console-api/clients'
import { useConsoleContext } from '../shell/context'
import { ConfirmRotation } from './consoleWorkspaceDatabase/ConfirmRotation'
import { describeFailure, failureOf, focusRing, notRotatedKey, useCopy, type Failure } from './consoleWorkspaceDatabase/copy'
import { Result } from './consoleWorkspaceDatabase/Results'
import { Action, FailureView, WorkspaceGate } from './consoleWorkspaceDatabase/States'
import { LocalizedToaster } from './consoleWorkspaceDatabase/Toaster'

function Header({ workspace, actions, loading }: { workspace: string | null; actions: ReactNode; loading: boolean }) {
  const { t } = useCopy()
  return <div className="min-w-0 space-y-4"><PageHeader as="div" wrapTitle={true} titleRef={undefined} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={t('description')} breadcrumbs={[]} status="workspace-database" statuses={{ 'workspace-database': { label: t('title'), tone: 'neutral' } }} meta={loading ? [] : [{ label: '', value: workspace ? t('activeWorkspace', { name: workspace }) : t('noWorkspace'), icon: undefined, mono: false }]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('tabs') }} />{loading && <TableSkeleton rows={1} columns={3} label={t('loading')} className="min-w-0" />}{actions}</div>
}
function Surface({ id, workspace }: { id: string; workspace: string }) {
  const { t } = useCopy(), announce = useAnnounce(), toast = useToast()
  const [record, setRecord] = useState<WorkspaceDatabaseRecord | null>(null)
  const [connection, setConnection] = useState<DatabaseConnection | null>(null)
  const [rotation, setRotation] = useState<RotateResponse | null>(null)
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(false), [failure, setFailure] = useState<Failure | null>(null)
  const [dialog, setDialog] = useState(false), [tab, setTab] = useState('summary')
  const [revision, setRevision] = useState(0)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const mounted = useRef(false), flight = useRef(false), intent = useRef<string | null>(null)
  const notify = (message: string, error = false) => {
    announce(message, error ? 'assertive' : 'polite')
    toast.add({ title: message, description: undefined, tone: error ? 'destructive' : 'success', priority: 'low' })
  }
  const clearResults = () => { setConnection(null); setRotation(null) }
  async function load(userStarted = true) {
    if (flight.current) return
    flight.current = true
    setLoading(true); setRecord(null); setEmpty(false); setFailure(null); clearResults(); setTab('summary')
    announce(t('loading'), 'polite')
    try {
      const response = await getWorkspaceDatabase(id)
      if (!mounted.current) return
      setRecord(response.database)
      if (userStarted) intent.current = 'h1'
    } catch (cause) {
      if (!mounted.current) return
      const error = failureOf(cause, 'load')
      if (error.status === 404) { setEmpty(true); if (userStarted) intent.current = '[data-database-provision] button' }
      else { setFailure(error); if (userStarted) intent.current = error.status === 403 ? '[data-database-failure] h2' : '[data-database-failure] button:last-child' }
    } finally {
      flight.current = false
      if (mounted.current) setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    if (!started.current) { started.current = true; void load(false) }
    return () => { mounted.current = false }
  }, [id])
  // Resolve focus after the outcome exists and the dialog has released its trap.
  useLayoutEffect(() => {
    if (!intent.current || dialog || loading || busy) return
    const targets = root.current?.querySelectorAll<HTMLElement>(intent.current)
    const target = targets?.item(targets.length - 1)
    if (!target) return
    intent.current = null
    if (target.matches('h1,h2')) target.tabIndex = -1
    target.focus()
  }, [dialog, loading, busy, record, failure, connection, rotation, revision])
  const openRotation = () => { if (!flight.current) { setTab('summary'); setDialog(true) } }
  async function mutate(operation: 'provision' | 'rotate') {
    if (flight.current) return
    flight.current = true
    setBusy(true); setFailure(null); clearResults(); setTab('summary')
    try {
      if (operation === 'provision') {
        const response = await provisionWorkspaceDatabase(id)
        if (!mounted.current) return
        setRecord(response.database); setEmpty(false); setConnection(response.connection)
        notify(t('provisioned'))
      } else {
        const response = await rotateWorkspaceDatabaseCredential(id)
        if (!mounted.current) return
        setRotation({ ...response, mode: response.mode ?? record?.mode })
        notify(t(response.rotated ? 'rotationWarning' : notRotatedKey(response.mode ?? record?.mode, response.reason)))
      }
      intent.current = '[data-database-result]'
    } catch (cause) {
      if (!mounted.current) return
      const error = failureOf(cause, operation)
      setFailure(error)
      notify(error.status === 403 ? t('noAccess') : error.status === 404 ? t('notFound') : describeFailure(t, error), true)
      intent.current = error.code === 'DB_SHARED_MODE' ? '[data-database-message]' : error.status === 403 || error.status === 404 ? '[data-database-failure] h2' : '[data-database-failure] button:last-child'
    } finally {
      flight.current = false
      if (mounted.current) { setBusy(false); setRevision((value) => value + 1) }
    }
  }
  const retry = () => {
    if (!failure || failure.operation === 'load' || failure.status === 403 || failure.status === 404) void load()
    else if (failure.operation === 'provision') void mutate('provision')
    else openRotation()
  }
  const outcome = <div data-testid="database-outcome" className="min-w-0 space-y-4">
    {failure && failure.operation !== 'load' && <FailureView failure={failure} retry={retry} />}
    <Result connection={connection} rotation={rotation} />
  </div>
  const rotationAction = record && !loading ? <div ref={trigger}><Action disabled={busy} onClick={openRotation}>{t(busy ? 'processing' : 'rotate')}</Action></div> : null
  return <div ref={root} className="min-w-0">
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="workspace-database-page" header={<Header workspace={workspace} actions={rotationAction} loading={loading} />}>
      {loading ? <section aria-busy="true" aria-label={t('loading')} className="min-w-0 space-y-4"><TableSkeleton rows={4} columns={2} label={t('loading')} className="min-w-0" /></section>
        : failure?.operation === 'load' ? <FailureView failure={failure} retry={retry} />
          : record ? <Tabs value={tab} defaultValue="summary" onValueChange={(value) => setTab(String(value))}>
            <TabsList activateOnFocus={true} aria-label={t('tabs')} className="max-w-full flex-wrap"><TabsTab value="summary" className={focusRing}>{t('summary')}</TabsTab><TabsTab value="history" className={focusRing}>{t('history')}</TabsTab></TabsList>
            <TabsPanel value="summary" keepMounted={false} className="min-w-0 space-y-4">
              <DescriptionListCard title={t('recordTitle')} description="" titleAs="h2" wrap={true} columns={2} onEdit={undefined} editLabel="" onCopy={undefined} className="min-w-0" labels={{ title: t('recordTitle'), description: '', edit: '', copy: () => t('copy'), copied: () => t('copied'), copiedToClipboard: t('copied'), copyFailed: t('copyFailed') }}
                items={(['database', 'host', 'port', 'user', 'engine', 'mode', 'status'] as const).map((key) => {
                  const value = key === 'database' ? record.database_name : key === 'user' ? record.username : String(record[key])
                  return { id: key, label: t(key), value, render: ['engine', 'mode', 'status'].includes(key) ? <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" aria-label={`${t(key)}: ${value}`}>{value}</Badge> : undefined, status: undefined, mono: true, copyable: false, copyValue: value }
                })} />
              {outcome}
            </TabsPanel>
            <TabsPanel value="history" keepMounted={false} className="min-w-0 space-y-4"><StatusTimeline events={[{ id: 'created', status: t('created'), title: '', description: undefined, tone: 'neutral', at: record.created_at, actor: undefined, live: false }]} label={t('history')} emptyLabel="" showFewerLabel={t('fewer')} showEarlierLabel={(count) => t('earlier', { count })} actorLabel={t('actor')} maxVisible={undefined} timeFormat="absolute" className="min-w-0" /><Text as="p" variant="body" tone="muted">{t('historyUnavailable')}</Text></TabsPanel>
          </Tabs> : empty ? <>
            <div data-database-provision=""><EmptyState title={t('emptyTitle')} description={t('emptyDescription')} icon={undefined} titleAs="h2" bordered={false} size="md" secondaryAction={null} className="min-w-0" primaryAction={<Action disabled={busy} onClick={() => void mutate('provision')}>{t(busy ? 'provisioning' : 'provision')}</Action>} /></div>
            {outcome}
          </> : null}
    </Page>
    {dialog && record && <ConfirmRotation name={record.database_name} trigger={trigger.current?.querySelector('button') ?? null} close={() => setDialog(false)} confirm={() => mutate('rotate')} />}
  </div>
}
export default function ConsoleWorkspaceDatabasePage() {
  const { t, i18n } = useCopy(), context = useConsoleContext()
  const Announcer = useHasLiveAnnouncer() ? Fragment : LiveAnnouncer
  const initialized = useRef<string | null>(null)
  // Session revalidation can reload shell workspaces during NavLink arrival. Keep an already
  // initialized surface for the same selection; a first load still waits for shell resolution.
  const id = !context.error && (!context.loading || initialized.current === context.activeWorkspaceId) ? context.activeWorkspaceId : null
  initialized.current = id
  const workspace = context.workspaces.find((item) => item.workspaceId === id)
  // Keying the surface drops all one-time values before a workspace switch can paint stale data.
  // resource-detail composition supplies only real data; the template's project samples are not used.
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'secret.hidden': t('hidden'), 'common.copied': t('copied'), 'common.copyFailed': t('copyFailed') }}><Announcer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    {id ? <Surface key={id} id={id} workspace={workspace?.displayName ?? id} /> : <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6" data-testid="workspace-database-page" header={<Header workspace={null} actions={null} loading={false} />}><WorkspaceGate /></Page>}
    <LocalizedToaster />
  </ToastProvider></Announcer></I18nProvider>
}
