import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildIdempotencyKey, deleteFunction, deployFunction, failureOf, getAction, getActivation, getActivationLogs, getActivationResult, invokeFunction, listActivations, listVersions, loadInventory,
  rollbackFunction, ROLLBACK_REASON, InventoryError,
  type ActivationCollection, type ActivationLog, type ActivationResult, type DeployDraft, type Failure, type FunctionAction, type FunctionActivation, type FunctionInventory, type InvocationAccepted,
  type MutationAccepted, type ResponseMode, type RollbackAccepted, type VersionCollection,
} from './api'
import { isMappedStatus, writeDisabledKey } from './copy'

export type Tab = 'detail' | 'versions' | 'activations' | 'triggers' | 'invoke' | 'deploy'
export const TABS: readonly Tab[] = ['detail', 'versions', 'activations', 'triggers', 'invoke', 'deploy']
export type ActivationPart = 'activation' | 'logs' | 'result'
export type Notice = { kind: 'deployed' | 'created' | 'invoked' | 'rolledBack' | 'deleted'; name?: string }

// A read section: its own phase, data and failure, so one failing never touches another. A retry keeps the
// failure on screen (retrying) until the request settles, so keyboard focus stays on the retry button.
export interface Sect<T> { phase: 'idle' | 'loading' | 'ok' | 'error'; data: T | null; failure: Failure | null; retrying: boolean }
const idle = <T,>(): Sect<T> => ({ phase: 'idle', data: null, failure: null, retrying: false })

function useSect<T>() {
  const [state, setState] = useState<Sect<T>>(idle<T>())
  const token = useRef(0)
  const run = useCallback(async (load: () => Promise<T>, options: { retry?: boolean; failure?: (cause: unknown) => Failure } = {}): Promise<T | null> => {
    const mine = ++token.current
    setState((current) => ({ phase: 'loading', data: null, failure: options.retry ? current.failure : null, retrying: Boolean(options.retry) }))
    try {
      const data = await load()
      if (token.current !== mine) return null
      setState({ phase: 'ok', data, failure: null, retrying: false })
      return data
    } catch (cause) {
      // A superseded request never overwrites the section that replaced it.
      if (token.current !== mine) return null
      setState({ phase: 'error', data: null, failure: (options.failure ?? failureOf)(cause), retrying: false })
      return null
    }
  }, [])
  const reset = useCallback(() => { token.current += 1; setState(idle<T>()) }, [])
  return [state, run, reset] as const
}

// A write: busy while in flight, the accepted result or the failure afterwards.
export interface Op<T> { busy: boolean; data: T | null; failure: Failure | null }
const idleOp = <T,>(): Op<T> => ({ busy: false, data: null, failure: null })

export type DraftIssue = { fieldId: string; message: 'required' | 'pattern' }
export const EMPTY_DRAFT: DeployDraft = { actionName: '', runtime: '', entrypoint: '', inlineCode: '', timeoutMs: '', memoryMb: '' }
export const draftFrom = (action: FunctionAction): DeployDraft => ({
  actionName: action.actionName,
  runtime: action.execution?.runtime ?? '',
  entrypoint: action.execution?.entrypoint ?? '',
  inlineCode: action.source?.inlineCode ?? '',
  timeoutMs: action.execution?.limits?.timeoutMs ? String(action.execution.limits.timeoutMs) : '',
  memoryMb: action.execution?.limits?.memoryMb ? String(action.execution.limits.memoryMb) : '',
})
export const FIELD_IDS = { actionName: 'functions-action-name', runtime: 'functions-runtime', entrypoint: 'functions-entrypoint', timeoutMs: 'functions-timeout-ms', memoryMb: 'functions-memory-mb', inlineCode: 'functions-inline-code' } as const

// Legacy :781-790: required fields, then the name pattern. The summary lists every problem, so all are collected.
export function validateDraft(draft: DeployDraft): DraftIssue[] {
  const issues: DraftIssue[] = (['actionName', 'runtime', 'entrypoint'] as const)
    .filter((field) => !draft[field].trim())
    .map((field) => ({ fieldId: FIELD_IDS[field], message: 'required' }))
  if (draft.actionName.trim() && !/^[a-z][a-z0-9-]{1,62}$/.test(draft.actionName.trim())) issues.push({ fieldId: FIELD_IDS.actionName, message: 'pattern' })
  return issues
}

// Legacy lib/editor-ux.ts:24-35.
export function parseJsonObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: 'json' | 'object' } {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, error: 'json' } }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'object' }
  return { ok: true, value: parsed as Record<string, unknown> }
}

// Legacy :457-466.
export function resolveActivationId(invocation: InvocationAccepted, collection: ActivationCollection | null): string | null {
  if (invocation.activationId) return invocation.activationId
  const match = collection?.items.find((item) => item.invocationId === invocation.invocationId)
  if (match) return match.activationId
  if (invocation.invocationId?.startsWith('act_')) return invocation.invocationId
  return collection?.items[0]?.activationId ?? null
}

// The inventory error carries both attempts; the fallback decides the copy when its status is mapped, else the first attempt does.
const inventoryFailure = (cause: unknown): Failure => {
  if (!(cause instanceof InventoryError)) return failureOf(cause)
  const fallback = failureOf(cause.fallback)
  const first = failureOf(cause.inventory)
  return isMappedStatus(fallback.status) || !isMappedStatus(first.status) ? fallback : first
}

interface Options { tenantId: string; workspaceId: string; notify: (notice: Notice) => void }

export function useFunctions({ tenantId, workspaceId, notify }: Options) {
  const [inventory, runInventory] = useSect<FunctionInventory>()
  const [detail, runDetail, resetDetail] = useSect<FunctionAction>()
  const [versions, runVersions, resetVersions] = useSect<VersionCollection>()
  const [activations, runActivations, resetActivations] = useSect<ActivationCollection>()
  const [activation, runActivation, resetActivation] = useSect<FunctionActivation>()
  const [logs, runLogs, resetLogs] = useSect<ActivationLog>()
  const [result, runResult, resetResult] = useSect<ActivationResult>()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'create' | 'edit'>('edit')
  const [tab, setTab] = useState<Tab>('detail')
  const [activationId, setActivationId] = useState<string | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null)
  const [parametersJson, setParametersJson] = useState('{}')
  const [responseMode, setResponseMode] = useState<ResponseMode>('accepted')
  const [invokeOp, setInvokeOp] = useState<Op<InvocationAccepted> & { validation: 'json' | 'object' | null }>({ ...idleOp<InvocationAccepted>(), validation: null })
  const [deployOp, setDeployOp] = useState<Op<MutationAccepted>>(idleOp<MutationAccepted>())
  const [rollbackOp, setRollbackOp] = useState<Op<RollbackAccepted>>(idleOp<RollbackAccepted>())
  const [deleteOp, setDeleteOp] = useState<{ open: boolean } & Op<MutationAccepted>>({ open: false, ...idleOp<MutationAccepted>() })
  const [draft, setDraft] = useState<DeployDraft>(EMPTY_DRAFT)
  const [issues, setIssues] = useState<DraftIssue[]>([])
  const [submitCount, setSubmitCount] = useState(0)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Idempotency keys (legacy :506-509): one per write, kept after any failed attempt, replaced only after a success.
  // A delete key belongs to one resource.
  const invokeKey = useRef('')
  const deployKey = useRef('')
  const rollbackKey = useRef('')
  const deleteKey = useRef<{ resourceId: string; key: string } | null>(null)
  const keyOf = (ref: { current: string }) => (ref.current ||= buildIdempotencyKey())
  const selected = useRef<string | null>(null)
  selected.current = selectedId
  const started = useRef(false)

  const loadInventoryNow = useCallback((retry = false) => runInventory(() => loadInventory(workspaceId), { retry, failure: inventoryFailure }), [runInventory, workspaceId])
  useEffect(() => {
    // One load per workspace, also under StrictMode's repeated effect run.
    if (started.current) return
    started.current = true
    void loadInventoryNow()
  }, [loadInventoryNow])

  const selectedRow = inventory.data?.actions.find((item) => item.resourceId === selectedId) ?? null
  const effective = detail.data ?? selectedRow
  const writeReason = writeDisabledKey(effective)
  const writeBlocked = writeReason !== null
  const baseline = mode === 'edit' && detail.data ? draftFrom(detail.data) : EMPTY_DRAFT
  const dirty = (Object.keys(baseline) as (keyof DeployDraft)[]).some((field) => draft[field] !== baseline[field])
  // The form follows the loaded function (legacy :670-681).
  useEffect(() => { if (mode === 'edit' && detail.data) setDraft(draftFrom(detail.data)) }, [detail.data, mode])

  const resetSelection = useCallback(() => {
    resetDetail(); resetVersions(); resetActivations(); setActivationId(null); resetActivation(); resetLogs(); resetResult()
    setInvokeOp({ ...idleOp<InvocationAccepted>(), validation: null })
    setDeployOp(idleOp<MutationAccepted>()); setRollbackTarget(null); setRollbackOp(idleOp<RollbackAccepted>())
    setDraft(EMPTY_DRAFT); setIssues([]); setTab('detail')
  }, [resetDetail, resetVersions, resetActivations, resetActivation, resetLogs, resetResult])

  const loadDetail = useCallback((id: string, retry = false) => runDetail(() => getAction(id), { retry }), [runDetail])
  const loadVersions = useCallback(async (id: string, retry = false) => {
    const data = await runVersions(() => listVersions(id), { retry })
    // The first eligible version is preselected on every load (legacy :563-564).
    if (data && selected.current === id) setRollbackTarget((data.items ?? []).find((item) => item.rollbackEligible)?.versionId ?? null)
    return data
  }, [runVersions])
  const loadActivations = useCallback((id: string, retry = false) => runActivations(() => listActivations(id), { retry }), [runActivations])

  const select = (id: string) => {
    setNotice(null); setMode('edit'); setSelectedId(id); resetSelection()
    void loadDetail(id); void loadVersions(id)
  }
  const openCreate = () => {
    setNotice(null); setSelectedId(null); resetSelection(); setMode('create'); setTab('deploy')
  }

  // Activation metadata, logs and result settle independently (legacy :649-665) and retry one at a time.
  const loadPart = useCallback((part: ActivationPart, id: string, actionId: string, retry = false) => {
    if (part === 'activation') return runActivation(() => getActivation(actionId, id), { retry })
    if (part === 'logs') return runLogs(() => getActivationLogs(actionId, id), { retry })
    return runResult(() => getActivationResult(actionId, id), { retry })
  }, [runActivation, runLogs, runResult])
  const openActivation = useCallback((id: string) => {
    const actionId = selected.current
    if (!actionId) return
    setActivationId(id)
    for (const part of ['activation', 'logs', 'result'] as const) void loadPart(part, id, actionId)
  }, [loadPart])
  const retryPart = (part: ActivationPart) => { if (selectedId && activationId) void loadPart(part, activationId, selectedId, true) }

  const changeTab = (next: Tab) => {
    setTab(next)
    if (next === 'activations' && selectedId && activations.phase === 'idle') void loadActivations(selectedId)
    if (next === 'versions' && selectedId && versions.phase === 'idle') void loadVersions(selectedId)
  }

  const invoke = async () => {
    const id = selectedId
    if (!id || invokeOp.busy || writeBlocked) return
    const parsed = parametersJson.trim() ? parseJsonObject(parametersJson) : { ok: true as const, value: {} }
    if (!parsed.ok) { setInvokeOp({ ...idleOp<InvocationAccepted>(), validation: parsed.error }); return }
    setInvokeOp({ ...idleOp<InvocationAccepted>(), busy: true, validation: null })
    try {
      const data = await invokeFunction(id, parsed.value, responseMode, keyOf(invokeKey))
      invokeKey.current = ''
      setInvokeOp({ ...idleOp<InvocationAccepted>(), data, validation: null })
      notify({ kind: 'invoked' })
      const refreshed = await loadActivations(id)
      const next = resolveActivationId(data, refreshed)
      if (next && selected.current === id) { openActivation(next); setTab('activations') }
    } catch (cause) {
      setInvokeOp({ ...idleOp<InvocationAccepted>(), failure: failureOf(cause), validation: null })
    }
  }

  const submitDeploy = async () => {
    if (deployOp.busy || writeBlocked) return
    setSubmitCount((count) => count + 1)
    const found = validateDraft(draft)
    setIssues(found)
    if (found.length) return
    setDeployOp({ ...idleOp<MutationAccepted>(), busy: true })
    const creating = mode === 'create'
    try {
      const data = await deployFunction(mode, { tenantId, workspaceId, resourceId: selectedId, activationPolicy: detail.data?.activationPolicy }, draft, keyOf(deployKey))
      deployKey.current = ''
      setDeployOp({ ...idleOp<MutationAccepted>(), data })
      notify({ kind: creating ? 'created' : 'deployed', name: draft.actionName.trim() })
      await loadInventoryNow()
      const resourceId = data.resourceId ?? selected.current
      if (resourceId) {
        if (creating) { setMode('edit'); setSelectedId(resourceId); resetSelection(); setNotice({ kind: 'created', name: draft.actionName.trim() }); void loadVersions(resourceId) }
        await loadDetail(resourceId)
        if (!creating) void loadVersions(resourceId)
      }
    } catch (cause) {
      setDeployOp({ ...idleOp<MutationAccepted>(), failure: failureOf(cause) })
    }
  }
  const discardDraft = () => { setDraft(baseline); setIssues([]) }

  const rollback = async () => {
    const id = selectedId
    if (!id || !rollbackTarget || rollbackOp.busy || writeBlocked) return
    setRollbackOp({ ...idleOp<RollbackAccepted>(), busy: true })
    try {
      const data = await rollbackFunction(id, rollbackTarget, ROLLBACK_REASON, keyOf(rollbackKey))
      rollbackKey.current = ''
      setRollbackOp({ ...idleOp<RollbackAccepted>(), data })
      notify({ kind: 'rolledBack' })
      await Promise.all([loadDetail(id), loadVersions(id)])
    } catch (cause) {
      setRollbackOp({ ...idleOp<RollbackAccepted>(), failure: failureOf(cause) })
    }
  }

  const openDelete = () => { if (effective && selectedId && !writeBlocked) setDeleteOp({ open: true, ...idleOp<MutationAccepted>() }) }
  const closeDelete = () => { if (!deleteOp.busy) setDeleteOp({ open: false, ...idleOp<MutationAccepted>() }) }
  const confirmDelete = async () => {
    const action = effective
    if (!action || !selectedId || deleteOp.busy || writeBlocked) return
    if (deleteKey.current?.resourceId !== action.resourceId) deleteKey.current = { resourceId: action.resourceId, key: buildIdempotencyKey() }
    setDeleteOp({ open: true, ...idleOp<MutationAccepted>(), busy: true })
    try {
      await deleteFunction(action.resourceId, deleteKey.current.key)
      deleteKey.current = null
      setDeleteOp({ open: false, ...idleOp<MutationAccepted>() })
      setSelectedId(null); resetSelection(); setMode('edit')
      setNotice({ kind: 'deleted', name: action.actionName })
      notify({ kind: 'deleted', name: action.actionName })
      void loadInventoryNow()
    } catch (cause) {
      // The key stays: a retry after any failed attempt resends it for this resource.
      setDeleteOp({ open: true, ...idleOp<MutationAccepted>(), failure: failureOf(cause) })
    }
  }

  return {
    inventory, detail, versions, activations, activation, logs, result,
    selectedId, selectedRow, effective, mode, tab, activationId, rollbackTarget, parametersJson, responseMode,
    invokeOp, deployOp, rollbackOp, deleteOp, draft, issues, submitCount, notice, writeReason, writeBlocked, dirty,
    activationIdFor: (invocation: InvocationAccepted) => resolveActivationId(invocation, activations.data),
    setDraft, setParametersJson, setResponseMode, setRollbackTarget, setNotice,
    select, openCreate, changeTab, openActivation, retryPart, invoke, submitDeploy, discardDraft, rollback, openDelete, closeDelete, confirmDelete,
    retryInventory: () => loadInventoryNow(true),
    retryDetail: () => { if (selectedId) void loadDetail(selectedId, true) },
    retryVersions: () => { if (selectedId) void loadVersions(selectedId, true) },
    retryActivations: () => { if (selectedId) void loadActivations(selectedId, true) },
  }
}

export type Fn = ReturnType<typeof useFunctions>
