import { useCallback, useEffect, useRef, useState } from 'react'
import { createSecret, deleteSecret, failureOf, listSecrets, readSecretName, updateSecret, validateName, validateValue, type Failure, type WorkspaceSecret } from './api'
import { classify } from './copy'
import type { Intent } from './focus'

export interface Draft { name: string; value: string; description: string }
export const emptyDraft: Draft = { name: '', value: '', description: '' }
export interface Validation { name: 'required' | 'pattern' | null; value: 'required' | 'max' | null }
const noValidation: Validation = { name: null, value: null }

export interface ListState {
  rows: WorkspaceSecret[]
  nextCursor: string | null
  // loading: no usable rows yet; ready: rows (possibly none); failed: first page or a next-page 403/404.
  status: 'loading' | 'ready' | 'failed'
  refreshing: boolean
  failure: Failure | null
  // True when the last read was started by the user, so its failure state may take focus.
  userStarted: boolean
  next: { loading: boolean; failure: Failure | null }
}
const initialList: ListState = { rows: [], nextCursor: null, status: 'loading', refreshing: false, failure: null, userStarted: false, next: { loading: false, failure: null } }

export interface Terminal { kind: 'no-access' | 'not-found'; failure: Failure }
export interface ReplaceState { returned: boolean; name: string; value: string; description: string; stage: 'edit' | 'confirm'; validation: Validation['value']; pending: boolean; failure: Failure | null }
export interface DeleteState { name: string; refCount: number; pending: boolean; failure: Failure | null }
export type Outcome = 'created' | 'replaced' | 'deleted'
export interface Feedback { outcome: Outcome; name: string; placement: 'create' | 'table' }

export interface Hooks {
  notify: (outcome: Outcome, name: string) => void
  focus: (intent: Intent) => void
}

// Owns every request of the page. Secret values live only in this state while a form, dialog or
// confirmation is open, and are cleared as soon as the write settles for good.
export function useWorkspaceSecrets(workspaceId: string, { notify, focus }: Hooks) {
  const [list, setList] = useState<ListState>(initialList)
  const listRef = useRef(list)
  listRef.current = list
  // Ownership token for list reads: every first-page load takes a new epoch before it starts and again once
  // it settles, so a next page that began earlier or during the reload is discarded in either order.
  const epoch = useRef(0)
  const alive = useRef(true)
  const started = useRef<string | null>(null)

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [validation, setValidation] = useState<Validation>(noValidation)
  const [create, setCreate] = useState<{ pending: boolean; failure: Failure | null; terminal: Terminal | null }>({ pending: false, failure: null, terminal: null })
  const [replace, setReplace] = useState<ReplaceState | null>(null)
  const [del, setDel] = useState<DeleteState | null>(null)
  const [table, setTable] = useState<(Terminal & { op: 'replace' | 'delete' }) | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // Writes are single flight: a second click while one is pending cannot send a second request.
  const writing = useRef(false)

  const loadFirst = useCallback((options: { quiet?: boolean; user?: boolean } = {}) => {
    const mine = ++epoch.current
    setList((current) => {
      const quiet = options.quiet && current.status === 'ready'
      return { ...current, rows: quiet ? current.rows : [], nextCursor: quiet ? current.nextCursor : null, status: quiet ? 'ready' : 'loading', refreshing: Boolean(quiet), failure: null, userStarted: Boolean(options.user), next: { loading: false, failure: null } }
    })
    return listSecrets(workspaceId).then((collection) => {
      if (!alive.current || epoch.current !== mine) return
      epoch.current += 1
      // Non-array items render as an empty list (legacy ConsoleWorkspaceSecretsPage.tsx:220).
      setList((current) => ({ ...current, rows: Array.isArray(collection?.items) ? collection.items : [], nextCursor: collection?.page?.nextCursor || null, status: 'ready', refreshing: false, failure: null, next: { loading: false, failure: null } }))
    }, (cause: unknown) => {
      if (!alive.current || epoch.current !== mine) return
      epoch.current += 1
      // A failed refresh never falls back to the previous rows.
      setList((current) => ({ ...current, rows: [], nextCursor: null, status: 'failed', refreshing: false, failure: failureOf(cause), next: { loading: false, failure: null } }))
    })
  }, [workspaceId])

  const loadMore = useCallback(() => {
    const current = listRef.current
    if (current.status !== 'ready' || current.refreshing || current.next.loading || !current.nextCursor) return
    const mine = epoch.current
    const cursor = current.nextCursor
    setList((state) => ({ ...state, userStarted: true, next: { loading: true, failure: null } }))
    return listSecrets(workspaceId, cursor).then((collection) => {
      if (!alive.current || epoch.current !== mine) return
      const items = Array.isArray(collection?.items) ? collection.items : []
      setList((state) => ({ ...state, rows: [...state.rows, ...items], nextCursor: collection?.page?.nextCursor || null, next: { loading: false, failure: null } }))
      if (items.length) focus({ kind: 'first-new-row', name: readSecretName(items[0]) })
    }, (cause: unknown) => {
      if (!alive.current || epoch.current !== mine) return
      const failure = failureOf(cause)
      const kind = classify(failure)
      // A next page answers 403 and 404 exactly like the first page; everything else keeps the loaded rows.
      if (kind === 'no-access' || kind === 'not-found') setList((state) => ({ ...state, rows: [], nextCursor: null, status: 'failed', failure, next: { loading: false, failure: null } }))
      else setList((state) => ({ ...state, next: { loading: false, failure } }))
    })
  }, [workspaceId, focus])

  useEffect(() => {
    alive.current = true
    // StrictMode replays effects in development; keep one first-page request per workspace.
    if (started.current !== workspaceId) { started.current = workspaceId; void loadFirst() }
    return () => { alive.current = false }
  }, [workspaceId, loadFirst])

  const afterWrite = useCallback((outcome: Outcome, name: string) => {
    setFeedback({ outcome, name, placement: outcome === 'created' ? 'create' : 'table' })
    notify(outcome, name)
    void loadFirst({ quiet: true })
  }, [loadFirst, notify])

  // ---- create ----
  const setField = useCallback((field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    if (field !== 'description') setValidation((current) => current[field] ? { ...current, [field]: null } : current)
  }, [])

  const submitCreate = useCallback(async () => {
    if (writing.current) return
    setFeedback(null)
    const next: Validation = { name: validateName(draft.name), value: validateValue(draft.value) }
    setValidation(next)
    setCreate((current) => ({ ...current, failure: null }))
    if (next.name || next.value) return
    writing.current = true
    const name = draft.name
    setCreate({ pending: true, failure: null, terminal: null })
    try {
      await createSecret(workspaceId, { secretName: name, secretValue: draft.value, ...(draft.description.trim() ? { description: draft.description.trim() } : {}) })
      if (!alive.current) return
      setDraft(emptyDraft)
      setCreate({ pending: false, failure: null, terminal: null })
      afterWrite('created', name)
      focus({ kind: 'name' })
    } catch (cause) {
      if (!alive.current) return
      const failure = failureOf(cause)
      const kind = classify(failure)
      if (kind === 'no-access') { setDraft(emptyDraft); setCreate({ pending: false, failure: null, terminal: { kind, failure } }); focus({ kind: 'state', target: 'create' }) }
      else if (kind === 'not-found') { setDraft((current) => ({ ...current, value: '' })); setCreate({ pending: false, failure: null, terminal: { kind, failure } }); focus({ kind: 'state', target: 'create' }) }
      else { setCreate({ pending: false, failure, terminal: null }); if (kind === 'retry') focus({ kind: 'retry', target: 'create' }) }
    } finally { writing.current = false }
  }, [draft, workspaceId, afterWrite, focus])

  // Volver al formulario and Nuevo secreto: a create 403 restores an empty form, a 404 keeps name and description.
  const restoreForm = useCallback(() => {
    setCreate((current) => ({ ...current, terminal: null }))
    focus({ kind: 'name' })
  }, [focus])

  // ---- replace ----
  const openReplace = useCallback((secret: WorkspaceSecret) => {
    setFeedback(null)
    setReplace({ returned: false, name: readSecretName(secret), value: '', description: secret.description ?? '', stage: 'edit', validation: null, pending: false, failure: null })
  }, [])
  const setReplaceField = useCallback((field: 'value' | 'description', value: string) => {
    setReplace((current) => current && { ...current, [field]: value, validation: field === 'value' ? null : current.validation })
  }, [])
  const closeReplace = useCallback(() => {
    const name = replace?.name
    if (replace?.pending) return
    setReplace(null)
    if (name) focus({ kind: 'row', action: 'replace', name })
  }, [replace, focus])
  const submitReplaceForm = useCallback(() => {
    if (!replace || replace.pending) return
    const invalid = validateValue(replace.value)
    setReplace({ ...replace, validation: invalid, stage: invalid ? 'edit' : 'confirm', returned: false, failure: null })
  }, [replace])
  const cancelReplaceConfirm = useCallback(() => {
    if (!replace || replace.pending) return
    setReplace({ ...replace, stage: 'edit', returned: true, failure: null })
    focus({ kind: 'replace-submit' })
  }, [replace, focus])
  const confirmReplace = useCallback(async () => {
    if (!replace || writing.current) return
    writing.current = true
    const { name } = replace
    setReplace((current) => current && { ...current, pending: true, failure: null })
    try {
      await updateSecret(workspaceId, name, { secretValue: replace.value, ...(replace.description.trim() ? { description: replace.description.trim() } : {}) })
      if (!alive.current) return
      setReplace(null)
      afterWrite('replaced', name)
      focus({ kind: 'replace-success', name })
    } catch (cause) {
      if (!alive.current) return
      const failure = failureOf(cause)
      const kind = classify(failure)
      if (kind === 'no-access' || kind === 'not-found') { setReplace(null); setTable({ kind, failure, op: 'replace' }); focus({ kind: 'state', target: 'table' }) }
      else { setReplace((current) => current && { ...current, pending: false, failure }); if (kind === 'retry') focus({ kind: 'retry', target: 'confirm' }) }
    } finally { writing.current = false }
  }, [replace, workspaceId, afterWrite, focus])

  // ---- delete ----
  const openDelete = useCallback((secret: WorkspaceSecret) => {
    setFeedback(null)
    const count = secret.resolvedRefCount
    setDel({ name: readSecretName(secret), refCount: Math.max(0, Number.isFinite(count) ? Number(count) : 0), pending: false, failure: null })
  }, [])
  const cancelDelete = useCallback(() => {
    if (!del || del.pending) return
    setDel(null)
    focus({ kind: 'row', action: 'delete', name: del.name })
  }, [del, focus])
  const confirmDelete = useCallback(async () => {
    if (!del || writing.current) return
    writing.current = true
    const { name } = del
    setDel((current) => current && { ...current, pending: true, failure: null })
    try {
      await deleteSecret(workspaceId, name)
      if (!alive.current) return
      setDel(null)
      afterWrite('deleted', name)
      focus({ kind: 'section' })
    } catch (cause) {
      if (!alive.current) return
      const failure = failureOf(cause)
      const kind = classify(failure)
      if (kind === 'no-access' || kind === 'not-found') { setDel(null); setTable({ kind, failure, op: 'delete' }); focus({ kind: 'state', target: 'table' }) }
      else { setDel((current) => current && { ...current, pending: false, failure }); if (kind === 'retry') focus({ kind: 'retry', target: 'confirm' }) }
    } finally { writing.current = false }
  }, [del, workspaceId, afterWrite, focus])

  // Volver a la lista reloads the first page.
  const dismissTable = useCallback(() => {
    setTable(null)
    setFeedback(null)
    void loadFirst({ user: true })
    focus({ kind: 'section' })
  }, [loadFirst, focus])
  const retryList = useCallback(() => { void loadFirst({ user: true }) }, [loadFirst])
  const retryNext = useCallback(() => { void loadMore() }, [loadMore])

  return {
    list, draft, validation, create, replace, del, table, feedback,
    setField, submitCreate, restoreForm,
    openReplace, setReplaceField, closeReplace, submitReplaceForm, cancelReplaceConfirm, confirmReplace,
    openDelete, cancelDelete, confirmDelete,
    dismissTable, retryList, retryNext, loadMore: () => { void loadMore() },
  }
}
