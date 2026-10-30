import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, Badge, Button, EmptyState, Field, FieldLabel, I18nProvider, Input, Link, LiveAnnouncer, Page, SimpleSelect, SimpleTooltip, StatusTag, Text, Timestamp, ToastProvider, Toaster, useAnnounce, useToast } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, PageHeader, PageToolbar, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import i18n from '../i18n'
import es from '../locales/es/pages.console-flows-page.json'
import en from '../locales/en/pages.console-flows-page.json'
import { createFlowDraft, designerNavigation, listFlows, triggerFlowSchedule, type FlowSummary } from './consoleFlows/api'
import './consoleFlows/page.css'

i18n.addResourceBundle('es', 'pages.console-flows-page', es)
i18n.addResourceBundle('en', 'pages.console-flows-page', en)
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const statusTones = { archived: 'neutral', draft: 'warning', failed: 'destructive', published: 'success' } as const
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId' | 'message'>
function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined, requestId: error.requestId ?? error.correlationId ?? '', message: typeof error.message === 'string' ? error.message : undefined }
}
function useCopy() { return useTranslation('pages.console-flows-page') }
function usePermissionCopy() {
  const permissions = usePermissions()
  const { t } = useCopy()
  const labels = Object.entries(es.roles)
  const roleKey = labels.find(([, label]) => label === permissions.highestRoleLabel)?.[0] ?? 'unknown'
  const reason = permissions.denyReason('workspace.write')
  // Translate the shared permission model's copy without changing its authorization rules.
  const reasonKey = !reason ? 'createDenied' : roleKey === 'tenant_viewer' ? 'viewerReason' : roleKey === 'tenant_developer' ? 'developerReason' : ['none', 'unknown'].includes(roleKey) ? 'unknownReason' : 'genericReason'
  return { canCreate: permissions.can('workspace.write'), role: t(`roles.${roleKey}`), reason: t(reasonKey) }
}
function FailurePanel({ failure, workspace = false, retry }: { failure: Failure; workspace?: boolean; retry: () => void }) {
  const { t } = useCopy()
  const title = t(workspace ? 'workspaceError' : 'errorTitle')
  const description = t(workspace ? 'workspaceErrorDescription' : failure.status === 401 ? 'errors.401' : 'errorDescription')
  return <ErrorPanel title={title} message={description} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={false} retryLabel={t('retry')} retrying={false} onRetry={retry} className="min-w-0"
    labels={{ title, message: description, support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}
function Callout({ title, description }: { title: string; description: string }) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    // The toast announces the failure once; kit 0.11.0 has no callout announce prop.
    const alert = root.current?.querySelector('[role="alert"]')
    alert?.setAttribute('role', 'note')
    alert?.setAttribute('aria-live', 'off')
  }, [title, description])
  return <div ref={root}><InlineCallout tone="destructive" title={title} description={description} actions={[]} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title, description, upgrade: '', viewUsage: '' }} /></div>
}

function useErrorMessage() {
  const { t } = useCopy()
  return (cause: unknown, fallback: string, server = false) => {
    const error = failureFrom(cause)
    // List access and trigger failures may show server reasons, but never transport defaults.
    if (server && error.status && error.message && !/^HTTP_\d+$/.test(error.message) && !['Request failed', 'Unauthorized', 'Forbidden', 'Not Found', 'Conflict', 'Too Many Requests', 'Internal Server Error', 'Bad Gateway', 'Service Unavailable', 'Gateway Timeout'].includes(error.message)) return error.message
    const status = error.status
    return t(status && [401, 403, 404, 409, 429].includes(status) ? `errors.${status}` : status && status >= 500 ? 'errors.server' : fallback)
  }
}
function RunNow({ workspaceId, flow }: { workspaceId: string; flow: FlowSummary }) {
  const { t } = useCopy()
  const navigate = useNavigate()
  const message = useErrorMessage()
  const toast = useToast()
  const reasonId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const inFlight = useRef(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const published = (flow.status?.trim() || 'draft').toLowerCase() === 'published'
  const name = flow.name?.trim() || flow.flowId
  async function confirm() {
    if (inFlight.current || !published) return
    inFlight.current = true; setPending(true); setError('')
    try {
      const ack = await triggerFlowSchedule(workspaceId, flow.flowId)
      setOpen(false)
      navigate(`/console/flows/${encodeURIComponent(flow.flowId)}/runs`, { state: { flowTrigger: { flowId: flow.flowId, scheduleId: ack.scheduleId, triggeredAt: new Date().toISOString() } } })
    } catch (cause) {
      const text = message(cause, 'triggerError', true)
      setOpen(false); setError(text); toast.add({ title: text, tone: 'destructive', priority: 'high' })
    } finally { inFlight.current = false; setPending(false) }
  }
  return <>
    <Button ref={trigger} type="button" variant="primary" size="sm" loading={false} disabled={!published || pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={`w-full whitespace-normal sm:w-auto ${focus}`}
      title={!published ? t('disabledReason') : undefined} aria-describedby={!published ? reasonId : undefined}
      aria-label={t(published ? 'runNamed' : 'runDisabled', { name })} onClick={() => setOpen(true)}>{t(pending ? 'running' : 'run')}</Button>
    {!published && <span id={reasonId} className="sr-only">{t('disabledReason')}</span>}
    {error && <Text as="span" variant="supporting" tone="destructive" data-testid="flow-run-now-error">{error}</Text>}
    <AlertDialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value) }}>
      <AlertDialogContent size="sm" container={undefined} finalFocus={trigger} className="min-w-0 wrap-anywhere">
        <AlertDialogHeader tone="info" icon={null}><AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle><AlertDialogDescription>{t('confirmDescription', { name })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="secondary" size="md" disabled={pending} loading={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={() => setOpen(false)}>{t('cancel')}</Button>
          <Button type="button" variant="primary" size="md" disabled={pending} loading={pending} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={() => void confirm()}>{t('run')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
function Flows({ workspaceId }: { workspaceId: string }) {
  const { t, i18n: language } = useCopy()
  const { canCreate, role, reason } = usePermissionCopy()
  const announce = useAnnounce()
  const message = useErrorMessage()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const table = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [denied, setDenied] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ attempt: number; rows: FlowSummary[]; error: Failure | null }>({ attempt: -1, rows: [], error: null })
  const request = useRef<{ attempt: number; promise: ReturnType<typeof listFlows> } | null>(null)
  const busy = result.attempt !== attempt
  const error = busy ? null : result.error
  useEffect(() => {
    let active = true
    if (request.current?.attempt !== attempt) request.current = { attempt, promise: listFlows(workspaceId) }
    void request.current.promise.then((response) => { if (active) setResult({ attempt, rows: response.items ?? [], error: null }) })
      .catch((cause: unknown) => { if (active) setResult({ attempt, rows: [], error: failureFrom(cause) }) })
    return () => { active = false }
  }, [workspaceId, attempt])
  useEffect(() => { if (error) announce(t('errorTitle'), 'assertive') }, [error, announce, t])
  useLayoutEffect(() => {
    // Kit 0.11.0 has no row-header prop; apply the role to its real cells.
    table.current?.querySelectorAll('tbody tr').forEach((row) => {
      row.firstElementChild?.setAttribute('role', 'rowheader')
    })
  }, [result, busy])
  async function create() {
    if (!canCreate || !name.trim() || inFlight.current) return
    inFlight.current = true; setCreating(true); setCreateError(''); setDenied(false)
    try {
      const created = await createFlowDraft(workspaceId, name.trim())
      designerNavigation.assign(`/console/flows/${encodeURIComponent(created.flowId)}`)
    } catch (cause) {
      const forbidden = failureFrom(cause).status === 403
      const text = forbidden ? reason : message(cause, 'createError')
      setDenied(forbidden); setCreateError(text); toast.add({ title: text, tone: 'destructive', priority: 'high' })
      inFlight.current = false; setCreating(false)
    }
  }
  const hidden = 'hidden sm:table-cell'
  const columns: DataTableColumn<FlowSummary>[] = [
    { id: 'name', header: t('name'), sortable: false, cell: (flow) => <span className="block min-w-0 max-w-32 truncate sm:max-w-64" title={flow.name || flow.flowId}>{flow.name || flow.flowId}</span> },
    { id: 'status', header: t('statusLabel'), sortable: false, className: hidden, headClassName: hidden, cell: (flow) => {
      const status = flow.status?.trim() || 'draft'
      const known = Object.hasOwn(statusTones, status)
      const label = known ? t(`status.${status}`) : status
      return <StatusTag status={status} label={label} statuses={{ [status]: { label, tone: known ? statusTones[status as keyof typeof statusTones] : 'neutral' } }} uppercase={false} />
    } },
    { id: 'updated', header: t('updated'), sortable: false, className: hidden, headClassName: hidden, cell: (flow) => <Timestamp value={flow.updatedAt ?? flow.createdAt ?? ''} format="absolute" locale={language.language} live={false} tooltip={false} dateOptions={{ dateStyle: 'short', timeStyle: 'medium' }} fallback={flow.updatedAt ?? flow.createdAt ?? t('missing')} /> },
    { id: 'actions', header: t('actions'), sortable: false, align: 'right', cell: (flow) => {
      const id = encodeURIComponent(flow.flowId), label = flow.name || flow.flowId
      return <div role="group" aria-label={t('rowActions', { name: label })} className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <Link render={<a href={`/console/flows/${id}`} />} tone="primary" underline="always" external={false} externalLabel="" aria-label={t('designerNamed', { name: label })} className={`whitespace-normal ${focus}`}>{t('designer')}</Link>
        <RunNow workspaceId={workspaceId} flow={flow} />
        <Link render={<RouterLink to={`/console/flows/${id}/runs`} />} tone="primary" underline="always" external={false} externalLabel="" aria-label={t('historyNamed', { name: label })} className={`whitespace-normal ${focus}`}><span className="sm:hidden">{t('historyShort')}</span><span className="hidden sm:inline">{t('history')}</span></Link>
      </div>
    } },
  ]
  return <>
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('create')} searchPlaceholder={t('newName')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('create')} className="console-flows-toolbar min-w-0"
      filters={canCreate ? <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
        <Field invalid={Boolean(createError)} className="w-full min-w-0 sm:w-64"><FieldLabel htmlFor="new-flow-name">{t('newName')}</FieldLabel><Input ref={input} id="new-flow-name" type="text" value={name} placeholder={t('newName')} onChange={(event) => setName(event.target.value)} className="w-full min-w-0" data-testid="new-flow-name-input" /></Field>
        <Button type="button" variant="primary" size="md" loading={false} disabled={creating || !name.trim()} iconOnly={false} icon={undefined} trailingIcon={undefined} className={`w-full sm:w-auto ${focus}`} onClick={() => void create()}>{t(creating ? 'creating' : 'create')}</Button>
      </div> : <SimpleTooltip content={reason} side="top" align="center" kbd="" variant="solid" arrow={true} delay={300} disabled={false} className="max-w-full">
        <Badge tone="warning" variant="outline" size="md" shape="rounded" dot={false} onRemove={undefined} removeLabel="" tabIndex={0} title={reason} data-testid="flows-read-only-indicator" className={`whitespace-normal wrap-anywhere ${focus}`}>{t('readOnly', { role })}<span className="sr-only"> {reason}</span></Badge>
      </SimpleTooltip>} />
    {createError && (denied ? <Callout title={t('restricted')} description={createError} /> : <Text as="p" variant="body" tone="destructive">{createError}</Text>)}
    {error?.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => message(error, 'errors.403', true), request: '', requested: '', sent: '' }} />
      : error?.status === 404 ? <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={<Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('backWorkspaces')}</Link>} titleAs="h2" bordered={false} className="min-w-0" />
      : error ? <FailurePanel failure={error} retry={() => setAttempt((current) => current + 1)} />
      : busy ? <section role="status" aria-label={t('loading')} aria-busy={true}><Text variant="body" tone="muted">{t('loadingDescription')}</Text><TableSkeleton rows={6} columns={4} label={t('loading')} className="min-w-0" /></section>
      : result.rows.length ? <div ref={table}><DataTable rows={result.rows} columns={columns} getRowId={(flow) => flow.flowId} getRowLabel={(flow) => flow.name || flow.flowId} caption={t('caption')} showCaption={false}
        paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false}
        labels={{ scrollRegion: t('caption'), emptyTitle: t('empty'), emptyDescription: t('emptyDescription'), loading: () => t('loading') }} /></div>
      : <EmptyState icon={undefined} title={t('empty')} description={t(canCreate ? 'emptyDescription' : 'emptyReadOnly')} primaryAction={canCreate ? <Button type="button" variant="primary" size="md" disabled={false} loading={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={() => input.current?.focus()}>{t('emptyAction')}</Button> : null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />}
  </>
}

function WorkspaceGate() {
  const { t } = useCopy()
  const context = useConsoleContext()
  const { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (context.loading) return <section role="status" aria-label={t('workspaceLoading')}><Text variant="body" tone="default">{t('workspaceLoading')}</Text><TableSkeleton rows={2} columns={1} label={t('workspaceLoadingDescription')} className="min-w-0" /></section>
  if (context.error) return <FailurePanel failure={context.error} workspace={true} retry={() => { void context.reloadWorkspaces?.() }} />
  return <EmptyState icon={undefined} title={t('workspaceRequired')} description={t('workspaceDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0" primaryAction={context.workspaces.length ?
    <Field invalid={false} className="w-full min-w-0"><FieldLabel htmlFor="flow-workspace">{t('workspaceLabel')}</FieldLabel><SimpleSelect id="flow-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" className="w-full min-w-0"
      items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link>
      : <Text variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}

function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Kit 0.11.0 exposes the close label but no viewport label prop.
    if (!container) return
    const translate = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('notifications')) viewport.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="max-w-full" />}</>
}

export default function ConsoleFlowsPage() {
  const { t, i18n: language } = useCopy()
  const { activeWorkspaceId } = useConsoleContext()
  const description = activeWorkspaceId ? t('description', { workspaceId: activeWorkspaceId }) : ''
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={5000} limit={1} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-flows min-w-0 space-y-4 wrap-anywhere" data-testid="console-flows-page"
      header={<div className="space-y-2"><Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('title')}</Badge><PageHeader as="div" wrapTitle={true} title={t('title')} description={description} breadcrumbs={[]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description, moreActions: t('actions'), sections: t('actions') }} /></div>}>
      {activeWorkspaceId ? <Flows key={activeWorkspaceId} workspaceId={activeWorkspaceId} /> : <WorkspaceGate />}
    </Page>
  <LocalizedToaster /></ToastProvider></LiveAnnouncer></I18nProvider>
}
