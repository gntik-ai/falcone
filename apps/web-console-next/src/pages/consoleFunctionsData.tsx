import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Badge, Button, EmptyState, Field, FieldDescription, FieldLabel, I18nProvider, JsonViewer, Link, LiveAnnouncer, Page, SimpleSelect, StatusTag, Text, Textarea, Timestamp, ToastProvider, Toaster, useAnnounce, useToast, type BadgeTone } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, InlineCallout, NoAccessEmpty, NotFoundEmpty, PageHeader, PageToolbar, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { ApiError, JsonValue } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import i18n from '../i18n'
import es from '../locales/es/pages.console-functions-data-page.json'
import en from '../locales/en/pages.console-functions-data-page.json'
import { deployFunction, invokeFunction, listActivations, listFunctions, type ActivationRecord, type FunctionRecord } from './consoleFunctionsData/api'
import './consoleFunctionsData/page.css'

i18n.addResourceBundle('es', 'pages.console-functions-data-page', es)
i18n.addResourceBundle('en', 'pages.console-functions-data-page', en)
const useCopy = () => useTranslation('pages.console-functions-data-page')
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

type Operation = 'deploy' | 'invoke' | 'activations'
type Validation = 'specInvalid' | 'specObject' | 'actionNameRequired' | 'inputInvalid' | 'selectToInvoke' | 'selectForActivations'
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>
interface Stamped<T> { value: T; at: number }

function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId ?? '' }
}
function parseJsonObject(text: string): { ok: true; value: Record<string, JsonValue> } | { ok: false; error: 'specInvalid' | 'specObject' } {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, error: 'specInvalid' } }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'specObject' }
  return { ok: true, value: parsed as Record<string, JsonValue> }
}
const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2)
// Legacy FunctionsConsole.tsx:387-392.
function getActionName(value: Record<string, JsonValue>): string {
  const actionName = value.actionName
  if (typeof actionName === 'string' && actionName.trim() !== '') return actionName
  const legacyName = value.name
  return typeof legacyName === 'string' ? legacyName.trim() : ''
}
const formatFunctionLabel = (fn: FunctionRecord) => `${fn.actionName}${fn.execution?.runtime ? ` (${fn.execution.runtime})` : ''}`
function statusTone(value: string): BadgeTone {
  const normalized = value.toLowerCase()
  if (['success', 'succeeded', 'completed'].includes(normalized)) return 'success'
  if (['failed', 'error', 'rejected'].includes(normalized)) return 'destructive'
  if (['running', 'pending', 'accepted'].includes(normalized)) return 'primary'
  return 'neutral'
}

function FailurePanel({ failure, kind, retry, retrying = false }: { failure: Failure; kind: 'list' | 'deploy' | 'invoke' | 'activations'; retry: () => void; retrying?: boolean }) {
  const { t } = useCopy()
  const title = t(`${kind}Error`), message = t(`${kind}ErrorDescription`)
  return <ErrorPanel title={title} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={false} retryLabel={t('retry')} retrying={retrying} onRetry={retry} className="min-w-0"
    labels={{ title, message, support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
}

function Validations({ validation, id }: { validation: Validation | null; id: string }) {
  const { t } = useCopy()
  if (!validation) return null
  const message = validation === 'specInvalid' ? `${t('specPrefix')}: ${t('jsonInvalid')}`
    : validation === 'specObject' ? `${t('specPrefix')}: ${t('jsonObjectExpected')}`
    : t(validation)
  return <div id={id} className="min-w-0"><InlineCallout tone="destructive" title={t('validationTitle')} labels={{ title: t('validationTitle') }} description={message} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div>
}

function Stale({ label, at, language }: { label: string; at: number; language: string }) {
  const { t } = useCopy()
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <Badge tone="warning" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{label}</Badge>
    <Text as="span" variant="supporting" tone="muted">{t('staleAt')} <Timestamp value={at} format="absolute" locale={language} tone="muted" live={false} tooltip={false} fallback="" /></Text>
  </div>
}

function findRetry(root: RefObject<HTMLElement | null>, label: string) {
  return Array.from(root.current?.querySelectorAll('button') ?? []).find((button) => button.textContent?.trim() === label)
}

function FunctionsConsole({ tenantId, workspaceId }: { tenantId: string; workspaceId: string }) {
  const { t, i18n: language } = useCopy()
  const announce = useAnnounce(), toast = useToast()
  const feedback = useRef({ t, announce, toast })
  // Keep asynchronous feedback localized without restarting the workspace load.
  useLayoutEffect(() => { feedback.current = { t, announce, toast } }, [t, announce, toast])
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0)
  const initial = useRef<ReturnType<typeof listFunctions> | null>(null)
  const announcedInitial = useRef<unknown>(null)
  const focusAfter = useRef<{ op: Operation; viaRetry: boolean } | null>(null)
  const deployButton = useRef<HTMLButtonElement>(null), invokeButton = useRef<HTMLButtonElement>(null), activationsButton = useRef<HTMLButtonElement>(null)
  const deployPanel = useRef<HTMLDivElement>(null), resultPanel = useRef<HTMLDivElement>(null), activationsPanel = useRef<HTMLDivElement>(null)

  const [items, setItems] = useState<FunctionRecord[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<Failure | null>(null)
  const [selected, setSelected] = useState('')
  const [deploySpec, setDeploySpec] = useState('{"name":"hello","runtime":"nodejs","code":"module.exports=async()=>({ok:true})"}')
  const [input, setInput] = useState('{}')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [deployValidation, setDeployValidation] = useState<Validation | null>(null)
  const [invokeValidation, setInvokeValidation] = useState<Validation | null>(null)
  const [deployError, setDeployError] = useState<Failure | null>(null)
  const [invokeError, setInvokeError] = useState<Failure | null>(null)
  const [activationsError, setActivationsError] = useState<Failure | null>(null)
  const [result, setResult] = useState<Stamped<JsonValue> | null>(null)
  const [activations, setActivations] = useState<Stamped<ActivationRecord[]> | null>(null)

  const reload = useCallback(async (pending?: ReturnType<typeof listFunctions>) => {
    const token = ++sequence.current
    setListLoading(true); setListError(null)
    if (!pending || announcedInitial.current !== pending) { feedback.current.announce(feedback.current.t('listLoading'), 'polite'); announcedInitial.current = pending ?? null }
    try {
      const res = await (pending ?? listFunctions(workspaceId))
      if (!mounted.current || token !== sequence.current) return
      const next = res.items ?? []
      setItems(next)
      setSelected((current) => next.some((fn) => fn.resourceId === current) ? current : '')
    } catch (cause) {
      if (mounted.current && token === sequence.current) {
        setItems([]); setListError(failureFrom(cause)); feedback.current.announce(feedback.current.t('listError'), 'assertive')
      }
    } finally { if (mounted.current && token === sequence.current) setListLoading(false) }
  }, [workspaceId])
  useEffect(() => {
    mounted.current = true
    // Reuse the bootstrap request across StrictMode effect replay.
    initial.current ??= listFunctions(workspaceId)
    void reload(initial.current)
    return () => { mounted.current = false }
  }, [workspaceId, reload])

  // Disabled controls drop focus: return it to the trigger, or to Reintentar when a retry failed again.
  useLayoutEffect(() => {
    if (operation !== null || !focusAfter.current) return
    const { op, viaRetry } = focusAfter.current
    focusAfter.current = null
    const failed = { deploy: deployError, invoke: invokeError, activations: activationsError }[op]
    const panel = { deploy: deployPanel, invoke: resultPanel, activations: activationsPanel }[op]
    const trigger = { deploy: deployButton, invoke: invokeButton, activations: activationsButton }[op]
    const target = viaRetry && failed ? findRetry(panel, feedback.current.t('retry')) : trigger.current
    target?.focus()
  }, [operation, deployError, invokeError, activationsError])

  const selectedFunction = items.find((fn) => fn.resourceId === selected) ?? null
  const busy = operation !== null
  const failureAnnounce = (key: string) => feedback.current.announce(feedback.current.t(key), 'assertive')
  const succeeded = (key: string) => {
    const { t: tr, announce: say, toast: notify } = feedback.current
    notify.add({ title: tr(key), tone: 'success', priority: 'low' }); say(tr(key), 'polite')
  }

  function clearSelectionOutputs() {
    setResult(null); setActivations(null)
    setInvokeError(null); setActivationsError(null); setInvokeValidation(null)
  }
  function selectFunction(resourceId: string) {
    setSelected(resourceId); clearSelectionOutputs()
    const fn = items.find((item) => item.resourceId === resourceId)
    announce(fn ? t('selectedSummary', { label: formatFunctionLabel(fn) }) : t('noneSelected'), 'polite')
  }
  function backToList() {
    setSelected(''); clearSelectionOutputs(); void reload()
  }

  async function runOperation(op: Operation, viaRetry: boolean, work: () => Promise<void>) {
    inFlight.current = true; focusAfter.current = { op, viaRetry }; setOperation(op)
    try { await work() } finally { inFlight.current = false; if (mounted.current) setOperation(null) }
  }

  async function deploy(viaRetry = false) {
    if (inFlight.current) return
    setDeployValidation(null)
    const parsed = parseJsonObject(deploySpec)
    if (!parsed.ok) { setDeployValidation(parsed.error); return }
    if (getActionName(parsed.value) === '') { setDeployValidation('actionNameRequired'); return }
    await runOperation('deploy', viaRetry, async () => {
      try {
        const deployed = await deployFunction(workspaceId, parsed.value, tenantId)
        if (!mounted.current) return
        setDeployError(null); setSelected(deployed.resourceId); clearSelectionOutputs()
        succeeded('deployed')
        await reload()
      } catch (cause) {
        if (!mounted.current) return
        setDeployError(failureFrom(cause)); failureAnnounce('deployError')
      }
    })
  }
  async function invoke(viaRetry = false) {
    if (inFlight.current) return
    if (selected === '') { setInvokeValidation('selectToInvoke'); return }
    let payload: JsonValue
    try { payload = JSON.parse(input) as JsonValue } catch { setInvokeValidation('inputInvalid'); return }
    setInvokeValidation(null)
    await runOperation('invoke', viaRetry, async () => {
      try {
        const invocation = await invokeFunction(selected, payload)
        if (!mounted.current) return
        setInvokeError(null); setResult({ value: (invocation.result ?? invocation) as JsonValue, at: Date.now() })
        succeeded('invoked')
      } catch (cause) {
        if (!mounted.current) return
        setInvokeError(failureFrom(cause)); failureAnnounce('invokeError')
      }
    })
  }
  async function viewActivations(viaRetry = false) {
    if (inFlight.current) return
    if (selected === '') { setInvokeValidation('selectForActivations'); return }
    setInvokeValidation(null)
    await runOperation('activations', viaRetry, async () => {
      try {
        const res = await listActivations(selected)
        if (!mounted.current) return
        setActivationsError(null); setActivations({ value: res.items ?? [], at: Date.now() })
        succeeded('activationsLoaded')
      } catch (cause) {
        if (!mounted.current) return
        setActivationsError(failureFrom(cause)); failureAnnounce('activationsError')
      }
    })
  }
  function formatSpec() {
    const parsed = parseJsonObject(deploySpec)
    if (!parsed.ok) { setDeployValidation(parsed.error); return }
    setDeployValidation(null); setDeploySpec(prettyJson(parsed.value))
  }
  function formatInput() {
    try { setInput(prettyJson(JSON.parse(input))); setInvokeValidation(null) } catch { setInvokeValidation('inputInvalid') }
  }

  const columns: DataTableColumn<FunctionRecord>[] = [
    { id: 'actionName', header: t('columnName'), sortable: false, cell: (fn) => fn.actionName },
    { id: 'runtime', header: t('columnRuntime'), sortable: false, cell: (fn) => fn.execution?.runtime ? <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{fn.execution.runtime}</Badge> : null },
    { id: 'resourceId', header: t('columnResourceId'), sortable: false, variant: 'mono', cell: (fn) => fn.resourceId },
  ]
  const activationColumns: DataTableColumn<ActivationRecord>[] = [
    { id: 'activationId', header: t('columnActivationId'), sortable: false, variant: 'mono', cell: (activation) => activation.activationId },
    { id: 'status', header: t('columnStatus'), sortable: false, cell: (activation) => activation.status ? <StatusTag status={activation.status} label={activation.status} statuses={{ [activation.status]: { label: activation.status, tone: statusTone(activation.status) } }} uppercase={false} /> : null },
    { id: 'durationMs', header: t('columnDuration'), sortable: false, variant: 'numeric', cell: (activation) => activation.durationMs != null ? t('durationMs', { ms: activation.durationMs }) : null },
  ]
  const deployInvalid = deployValidation === 'specInvalid' || deployValidation === 'specObject'
  const inputInvalid = invokeValidation === 'inputInvalid'
  const viewerLabels = {
    copyPath: t('jsonCopyPath'), copyValue: t('jsonCopyValue'), copied: t('jsonCopied'), copyFailed: t('jsonCopyFailed'), selectHint: t('jsonSelectHint'),
    truncated: t('jsonTruncated'), copyFullHint: t('jsonCopyFullHint'), keys: (count: number) => t('jsonKeys', { count }), items: (count: number) => t('jsonItems', { count }), root: t('jsonRoot'),
  }
  const viewer = (data: unknown, label: string) => <JsonViewer data={data} label={label} defaultExpandDepth={2} maxDepth={undefined} search="" toolbar={true} maxHeight={288} maxDisplayChars={undefined} emptyContent={undefined} labels={viewerLabels} className="min-w-0" />
  const table = <T,>(rows: T[], cols: DataTableColumn<T>[], rowId: (row: T) => string, caption: string) => <DataTable rows={rows} columns={cols} getRowId={rowId} getRowLabel={rowId} caption={caption} showCaption={false} paginated={false} selectionMode="none" selectable={false} selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0" labels={{ scrollRegion: caption, emptyTitle: caption, emptyDescription: caption, loading: () => t('activationsLoading') }} />

  const noAccess = listError?.status === 403
  const listBody = listLoading
    ? <section aria-busy={true} aria-label={t('listLoading')}><div aria-hidden={true}><TableSkeleton rows={3} columns={3} label={t('listLoading')} className="min-w-0" /></div><Text variant="body" tone="muted">{t('listLoadingDescription')}</Text></section>
    : listError ? <FailurePanel failure={listError} kind="list" retry={() => void reload()} />
    : items.length === 0 ? <EmptyState icon={undefined} title={t('listEmpty')} description={t('listEmptyDescription')} titleAs="h3" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" />
    : <DataTable rows={items} columns={columns} getRowId={(fn) => fn.resourceId} getRowLabel={formatFunctionLabel} caption={t('listLegend')} showCaption={false} paginated={false} selectionMode="single" selectionName="function" aria-label={t('listLegend')} selectedId={selected || null} onSelectedIdChange={selectFunction} isRowDisabled={() => false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0" labels={{ scrollRegion: t('listLegend'), selection: t('selectionColumn'), selectRow: (label) => label, emptyTitle: t('listEmpty'), emptyDescription: t('listEmptyDescription'), loading: () => t('listLoading') }} />

  const listPanel = <section className="min-w-0 space-y-3" aria-label={t('listLegend')} aria-busy={listLoading}>
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('listLegend')} searchPlaceholder={t('listLegend')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('listLegend')} className="functions-data-toolbar min-w-0"
      filters={<div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('listTitle', { count: listLoading || listError ? 0 : items.length })}</h2>{selectedFunction ? <Badge tone="neutral" variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className="max-w-full truncate">{t('selectedBadge', { name: selectedFunction.actionName })}</Badge> : null}</div>} />
    {listBody}
  </section>

  if (noAccess) return <NoAccessEmpty resource={t('listLegend')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />

  const failureView = (failure: Failure, kind: 'invoke' | 'activations', retry: () => void, retrying: boolean) => failure.status === 404
    ? <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={<Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={backToList}>{t('backToList')}</Button>} titleAs="h3" bordered={false} className="min-w-0" />
    : <FailurePanel failure={failure} kind={kind} retry={retry} retrying={retrying} />

  return <section aria-label={t('sectionLabel')} aria-busy={listLoading || busy} className="grid min-w-0 gap-6 xl:grid-cols-5">
    <div className="min-w-0 xl:col-span-2">{listPanel}</div>
    <div className="min-w-0 space-y-6 xl:col-span-3">
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section aria-labelledby="functions-data-deploy" className="min-w-0 space-y-3">
          <SectionHeader title={t('deployTitle')} description={undefined} count={undefined} actions={[]} as="h2" bordered={true} headingId="functions-data-deploy" />
          <Field invalid={deployInvalid} className="min-w-0">
            <FieldLabel htmlFor="functions-data-spec">{t('deploySpecLabel')}</FieldLabel>
            <Textarea id="functions-data-spec" value={deploySpec} onChange={(event) => setDeploySpec(event.target.value)} invalid={deployInvalid} disabled={busy} rows={7} resize="vertical" size="md" className="min-w-0 font-mono" />
            <FieldDescription className="sr-only">{t('deploySpecHelp')}</FieldDescription>
          </Field>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button ref={deployButton} type="button" variant="primary" size="md" loading={false} disabled={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={() => void deploy()}>{operation === 'deploy' ? t('deploying') : t('deploy')}</Button>
            <Button type="button" variant="secondary" size="md" loading={false} disabled={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={formatSpec}>{t('format')}</Button>
          </div>
          <Validations validation={deployValidation} id="functions-data-deploy-validation" />
          <div ref={deployPanel}>{deployError ? <FailurePanel failure={deployError} kind="deploy" retry={() => void deploy(true)} retrying={operation === 'deploy'} /> : null}</div>
        </section>
        <section aria-labelledby="functions-data-invoke" className="min-w-0 space-y-3">
          <SectionHeader title={t('invokeTitle')} description={undefined} count={undefined} actions={[]} as="h2" bordered={true} headingId="functions-data-invoke" />
          <Field invalid={inputInvalid} className="min-w-0">
            <FieldLabel htmlFor="functions-data-input">{t('inputLabel')}</FieldLabel>
            <Textarea id="functions-data-input" value={input} onChange={(event) => setInput(event.target.value)} invalid={inputInvalid} disabled={busy} rows={5} resize="vertical" size="md" className="min-w-0 font-mono" />
            <FieldDescription className="sr-only">{t('inputHelp')}</FieldDescription>
          </Field>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button ref={invokeButton} type="button" variant="primary" size="md" loading={false} disabled={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={() => void invoke()}>{operation === 'invoke' ? t('invoking') : t('invoke')}</Button>
            <Button ref={activationsButton} type="button" variant="secondary" size="md" loading={false} disabled={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={() => void viewActivations()}>{operation === 'activations' ? t('loadingActivationsButton') : t('viewActivations')}</Button>
            <Button type="button" variant="secondary" size="md" loading={false} disabled={busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focus} onClick={formatInput}>{t('format')}</Button>
          </div>
          <Validations validation={invokeValidation} id="functions-data-invoke-validation" />
        </section>
      </div>
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <section aria-labelledby="functions-data-result" className="min-w-0 space-y-3">
          <SectionHeader title={t('resultTitle')} description={undefined} count={undefined} actions={[]} as="h2" bordered={true} headingId="functions-data-result" />
          <div ref={resultPanel} className="min-w-0 space-y-3">
            {invokeError ? failureView(invokeError, 'invoke', () => void invoke(true), operation === 'invoke') : null}
            {result ? <div className="min-w-0 space-y-2">
              {invokeError ? <Stale label={t('resultStale')} at={result.at} language={language.language} /> : null}
              {viewer(result.value, t('resultLabel'))}
            </div>
              : invokeError ? null
              : <EmptyState icon={undefined} title={t('resultEmpty')} description={t('resultEmptyDescription')} titleAs="h3" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" />}
          </div>
        </section>
        <section aria-labelledby="functions-data-activations" className="min-w-0 space-y-3">
          <SectionHeader title={t('activationsTitle')} description={undefined} count={undefined} actions={[]} as="h2" bordered={true} headingId="functions-data-activations" />
          <div ref={activationsPanel} className="min-w-0 space-y-3">
            {operation === 'activations'
              ? <section aria-busy={true} aria-label={t('activationsLoading')}><div aria-hidden={true}><TableSkeleton rows={3} columns={3} label={t('activationsLoading')} className="min-w-0" /></div><Text variant="body" tone="muted">{t('activationsLoadingDescription')}</Text></section>
              : <>
                {activationsError ? failureView(activationsError, 'activations', () => void viewActivations(true), false) : null}
                {activations && activations.value.length > 0 ? <div className="min-w-0 space-y-2">
                  {activationsError ? <Stale label={t('activationsStale')} at={activations.at} language={language.language} /> : null}
                  {table(activations.value, activationColumns, (activation) => activation.activationId, t('activationsLabel'))}
                </div>
                  : activations ? (activationsError ? null : <EmptyState icon={undefined} title={t('activationsEmpty')} description={selectedFunction ? t('activationsEmptyNamed', { name: selectedFunction.actionName }) : t('activationsEmptyUnnamed')} titleAs="h3" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" />)
                  : activationsError ? null
                  : <EmptyState icon={undefined} title={t('activationsIdle')} description={t('activationsIdleDescription')} titleAs="h3" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" />}
              </>}
          </div>
        </section>
      </div>
    </div>
  </section>
}

function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  if (context.loading) return <section role="status" aria-label={t('workspaceLoading')}><Text variant="body" tone="default">{t('workspaceLoading')}</Text><Text variant="body" tone="muted">{t('workspaceLoadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={2} columns={1} label={t('workspaceLoadingDescription')} className="min-w-0" /></div></section>
  if (context.error) return <ErrorPanel title={t('workspaceError')} message={t('workspaceErrorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} onRetry={() => { void context.reloadWorkspaces?.() }} className="min-w-0"
    labels={{ title: t('workspaceError'), message: t('workspaceErrorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
  return <EmptyState icon={undefined} title={t('workspaceRequired')} description={t('workspaceDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0" primaryAction={context.workspaces.length ?
    <Field invalid={false} className="w-full min-w-0"><FieldLabel htmlFor="functions-data-workspace">{t('workspaceLabel')}</FieldLabel><SimpleSelect id="functions-data-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" className="w-full min-w-0" items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
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

export default function ConsoleFunctionsDataPage() {
  const { t, i18n: language } = useCopy()
  const context = useConsoleContext()
  let body
  // The shell sets the tenant only after its workspace load succeeds, so loading and failure take precedence over the blocked state.
  if (context.activeTenantId && context.activeWorkspaceId) body = <FunctionsConsole key={context.activeWorkspaceId} tenantId={context.activeTenantId} workspaceId={context.activeWorkspaceId} />
  else if (context.loading || context.error || context.activeTenantId) body = <WorkspaceGate />
  else body = <EmptyState icon={undefined} role="status" title={t('blockedTitle')} description={t('blockedDescription')} titleAs="h2" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" />
  const description = <>{t('description')} {t('adminPrefix')}{' '}<Link render={<RouterLink to="/console/functions" />} tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('adminLink')}</Link>{t('sentenceEnd')}</>
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={5000} limit={1} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('title')} className="functions-data min-w-0 space-y-6 wrap-anywhere" data-testid="console-functions-data-page" header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={description} breadcrumbs={[]} status="" statuses={{}} meta={[{ label: '', value: <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('category')}</Badge> }]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('title'), sections: t('title') }} />}>
      {body}
    </Page><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
