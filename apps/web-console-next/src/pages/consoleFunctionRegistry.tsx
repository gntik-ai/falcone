import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Badge, Button, EmptyState, Field, FieldLabel, I18nProvider, Input, Link, LiveAnnouncer, Page, SimpleSelect, StatusTag, Text, ToastProvider, Toaster, useAnnounce, useToast } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, FirstRunEmpty, FormSection, NoAccessEmpty, NotFoundEmpty, PageHeader, PageToolbar, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import i18n from '../i18n'
import es from '../locales/es/pages.console-function-registry-page.json'
import en from '../locales/en/pages.console-function-registry-page.json'
import './consoleFunctionRegistry/page.css'

i18n.addResourceBundle('es', 'pages.console-function-registry-page', es)
i18n.addResourceBundle('en', 'pages.console-function-registry-page', en)
const useCopy = () => useTranslation('pages.console-function-registry-page')
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
export interface FunctionRecord {
  id: string; workspace_id: string; name: string; runtime: string; handler: string | null
  source_ref: string | null; runtime_status: string; status: string; created_at: string
}
interface ListResponse { items: FunctionRecord[]; total: number }
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>
function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId ?? '' }
}
function FailurePanel({ failure, kind, retry, retrying = false }: { failure: Failure; kind: 'list' | 'register' | 'workspace'; retry: () => void; retrying?: boolean }) {
  const { t } = useCopy()
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (kind === 'register') {
      const buttons = root.current?.querySelectorAll('button')
      buttons?.forEach((button) => { if (button.textContent === t('retry')) button.focus() })
    }
  }, [failure, kind, t])
  const title = t(`${kind}Error`), message = t(`${kind}ErrorDescription`)
  return <div ref={root}><ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={retrying} onRetry={retry} className="min-w-0"
    labels={{ title, message, support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} /></div>
}
function Registry({ workspaceId }: { workspaceId: string }) {
  const { t } = useCopy()
  const announce = useAnnounce(), toast = useToast()
  const feedback = useRef({ t, announce })
  // Keep asynchronous feedback localized without restarting the workspace load.
  useLayoutEffect(() => { feedback.current = { t, announce } }, [t, announce])
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(false), inFlight = useRef(false)
  const request = useRef<Promise<ListResponse> | null>(null)
  const sequence = useRef(0)
  const announcedRequest = useRef<Promise<ListResponse> | null>(null)
  const [items, setItems] = useState<FunctionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [listError, setListError] = useState<Failure | null>(null)
  const [registerError, setRegisterError] = useState<Failure | null>(null)
  const [name, setName] = useState(''), [runtime, setRuntime] = useState('nodejs:20'), [handler, setHandler] = useState('main')
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/functions`
  const load = useCallback(async (pending?: Promise<ListResponse>) => {
    const token = ++sequence.current
    setLoading(true); setListError(null)
    if (!pending || announcedRequest.current !== pending) { feedback.current.announce(feedback.current.t('loading'), 'polite'); announcedRequest.current = pending ?? null }
    try {
      const result = await (pending ?? requestConsoleSessionJson<ListResponse>(path))
      if (mounted.current && token === sequence.current) setItems(result.items ?? [])
    } catch (cause) {
      if (mounted.current && token === sequence.current) { setItems([]); setListError(failureFrom(cause)); feedback.current.announce(feedback.current.t('listError'), 'assertive') }
    } finally { if (mounted.current && token === sequence.current) setLoading(false) }
  }, [path])
  useEffect(() => {
    mounted.current = true
    // Reuse bootstrap across StrictMode effect replay, as in the shell.
    request.current ??= requestConsoleSessionJson<ListResponse>(path)
    void load(request.current)
    return () => { mounted.current = false }
  }, [path, load])
  async function register() {
    if (!name.trim() || inFlight.current) return
    inFlight.current = true; setBusy(true); setRegisterError(null)
    try {
      await requestConsoleSessionJson(path, { method: 'POST', body: { name: name.trim(), runtime: runtime.trim() || 'nodejs:20', handler: handler.trim() || 'main' } })
      if (!mounted.current) return
      setName('')
      toast.add({ title: t('registered'), tone: 'success', priority: 'low' })
      announce(t('registered'), 'polite')
      await load()
      if (mounted.current) input.current?.focus()
    } catch (cause) {
      if (mounted.current) { setRegisterError(failureFrom(cause)); announce(t('registerError'), 'assertive') }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  const columns: DataTableColumn<FunctionRecord>[] = [
    { id: 'name', header: t('name'), sortable: false, cell: (fn) => fn.name },
    { id: 'runtime', header: t('runtime'), sortable: false, cell: (fn) => <div><Text as="p" variant="body" tone="default">{fn.runtime}</Text><Text as="p" variant="supporting" tone="muted">{t('handlerValue', { handler: fn.handler ?? 'main' })}</Text></div> },
    { id: 'status', header: t('status'), sortable: false, cell: (fn) => <StatusTag status={fn.status} label={fn.status} statuses={{ [fn.status]: { label: fn.status, tone: 'neutral' } }} uppercase={false} /> },
    { id: 'runtime_status', header: t('runtimeStatus'), sortable: false, cell: (fn) => <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{fn.runtime_status}</Badge> },
  ]
  if (listError?.status === 403) return <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
  if (listError?.status === 404) return <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={<Link render={<RouterLink to="/console/overview" />} tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('backOverview')}</Link>} titleAs="h2" bordered={false} className="min-w-0" />
  return <>
    <FormSection title={t('register')} description={null} actions={null} headingLevel="h2" divided={false} labels={{ title: t('register'), description: '' }} className="min-w-0">
      <form className="grid min-w-0 gap-4 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void register() }}>
        <Field invalid={false} className="min-w-0"><FieldLabel htmlFor="function-name">{t('name')}</FieldLabel><Input ref={input} id="function-name" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('namePlaceholder')} required className="w-full min-w-0" /></Field>
        <Field invalid={false} className="min-w-0"><FieldLabel htmlFor="function-runtime">{t('runtime')}</FieldLabel><Input id="function-runtime" type="text" value={runtime} onChange={(event) => setRuntime(event.target.value)} className="w-full min-w-0" /></Field>
        <Field invalid={false} className="min-w-0"><FieldLabel htmlFor="function-handler">{t('handler')}</FieldLabel><Input id="function-handler" type="text" value={handler} onChange={(event) => setHandler(event.target.value)} className="w-full min-w-0" /></Field>
        <div className="sm:col-span-3"><Button type="submit" variant="primary" size="md" loading={false} disabled={busy || !name.trim()} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus}>{t(busy ? 'registering' : 'register')}</Button></div>
      </form>
      {registerError && <div className="mt-4"><FailurePanel failure={registerError} kind="register" retry={() => void register()} retrying={busy} /></div>}
    </FormSection>
    <section className="min-w-0 space-y-4" aria-label={t('listTitle')}>
      <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('listTitle')} searchPlaceholder={t('listTitle')} views={[]} view="" defaultView="" onViewChange={undefined} filters={<div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t('listCount', { count: loading || listError ? 0 : items.length })}</h2><Button type="button" variant="primary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={() => input.current?.focus()}>{t('register')}</Button></div>} primaryAction={null} aria-label={t('listTitle')} className="function-registry-toolbar min-w-0" />
      {loading ? <section aria-busy={true} aria-label={t('loading')}><div aria-hidden={true}><TableSkeleton rows={3} columns={4} label={t('loading')} className="min-w-0" /></div></section>
        : listError ? <FailurePanel failure={listError} kind="list" retry={() => void load()} />
        : items.length ? <DataTable rows={items} columns={columns} getRowId={(fn) => fn.id} getRowLabel={(fn) => fn.name} caption={t('listTitle')} showCaption={false} paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('listTitle'), emptyTitle: t('empty'), emptyDescription: t('empty'), loading: () => t('loading') }} />
        : <FirstRunEmpty icon={undefined} title={t('listTitle')} description={t('empty')} actionLabel={t('register')} onAction={() => input.current?.focus()} secondary={null} steps={[]} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: t('listTitle'), description: t('empty'), action: t('register'), guide: '' }} />}
    </section>
  </>
}
function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (context.loading) return <section role="status" aria-label={t('workspaceLoading')}><Text variant="body" tone="default">{t('workspaceLoading')}</Text><Text variant="body" tone="muted">{t('workspaceLoadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={2} columns={1} label={t('workspaceLoadingDescription')} className="min-w-0" /></div></section>
  if (context.error) return <FailurePanel failure={context.error} kind="workspace" retry={() => { void context.reloadWorkspaces?.() }} />
  return <EmptyState icon={undefined} title={t('workspaceRequired')} description={t('workspaceDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0" primaryAction={context.workspaces.length ?
    <Field invalid={false} className="w-full min-w-0"><FieldLabel htmlFor="registry-workspace">{t('workspaceLabel')}</FieldLabel><SimpleSelect id="registry-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" className="w-full min-w-0" items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link> : <Text variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}
function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    // The pinned kit exposes a close label but no viewport label prop.
    const translate = () => {
      const region = container.querySelector('[role="region"]')
      if (region && region.getAttribute('aria-label') !== t('notifications')) region.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}
export default function ConsoleFunctionRegistryPage() {
  const { t, i18n: language } = useCopy()
  const context = useConsoleContext()
  const workspace = context.workspaces.find((item) => item.workspaceId === context.activeWorkspaceId)
  // Compose resource-index's Page/header/table layout; its demo shell, filters and bulk actions are outside this page's contract.
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={5000} limit={1} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('register')} className="function-registry min-w-0 space-y-6 wrap-anywhere" data-testid="console-function-registry-page" header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={[{ label: '', value: <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('category')}</Badge> }, { label: t('activeWorkspace'), value: workspace?.displayName ?? t('noWorkspace') }]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('register'), sections: t('listTitle') }} />}>
      {context.activeWorkspaceId ? <Registry key={context.activeWorkspaceId} workspaceId={context.activeWorkspaceId} /> : <WorkspaceGate />}
    </Page><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
