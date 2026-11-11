import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as api from './api'
import { bytes } from './copy'

export type Section<T> = { data: T | null; busy: boolean; failure: api.Failure | null }
const initial = <T,>(): Section<T> => ({ data: null, busy: false, failure: null })
export type Operation = 'create' | 'upload' | 'export' | 'delete'
export interface Mutation { busy: boolean; failure: api.Failure | null }
const idle: Mutation = { busy: false, failure: null }
export interface Notice { key: string; values?: Record<string, string | number> }

export function useStorage(workspace: string) {
  const [buckets, setBuckets] = useState(initial<api.StorageBucketCollection>)
  const [usage, setUsage] = useState(initial<api.StorageUsageSnapshot>)
  const [objects, setObjects] = useState(initial<api.StorageObjectCollection>)
  const [metadata, setMetadata] = useState(initial<api.StorageObjectMetadata>)
  const [presigned, setPresigned] = useState(initial<api.Presigned>)
  const [bucket, setBucket] = useState<api.StorageBucket | null>(null)
  const [objectKey, setObjectKey] = useState<string | null>(null)
  const [tab, setTab] = useState('objects')
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [key, setKey] = useState('')
  const [deleting, setDeleting] = useState<api.StorageBucket | null>(null)
  const [exporting, setExporting] = useState<api.StorageBucket | null>(null)
  const [mutations, setMutations] = useState<Record<Operation, Mutation>>({ create: idle, upload: idle, export: idle, delete: idle })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [appended, setAppended] = useState(0)
  const [appendCursor, setAppendCursor] = useState<string | null>(null)
  const mounted = useRef(false)
  const generation = useRef(0)
  const tasks = useRef(new Map<string, AbortController>())
  const inventory = useRef<{ ids: string[]; loaded: boolean }>({ ids: [], loaded: false })
  const beforeCreate = useRef<{ name: string; ids: string[]; loaded: boolean } | null>(null)
  const uploadAttempt = useRef<{ bucket: string; key: string; content: string; type: string } | null>(null)
  const busy = useRef(new Set<string>())

  // The keyed surface owns a context generation. No completion may outlive that surface.
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++; tasks.current.forEach((task) => task.abort()); tasks.current.clear(); busy.current.clear() }
  }, [])
  const begin = useCallback((scope: string) => {
    tasks.current.get(scope)?.abort()
    const controller = new AbortController()
    tasks.current.set(scope, controller)
    const epoch = generation.current
    return { signal: controller.signal, valid: () => mounted.current && epoch === generation.current && !controller.signal.aborted && tasks.current.get(scope) === controller }
  }, [])
  const loadBuckets = useCallback(async () => {
    if (busy.current.has('buckets')) return null
    busy.current.add('buckets')
    const task = begin('buckets')
    setBuckets((old) => ({ ...old, busy: true }))
    try {
      const collection = await api.listBuckets(task.signal)
      if (!task.valid()) return null
      inventory.current = { ids: collection.items.map((item) => item.resourceId), loaded: true }
      const data = { ...collection, items: collection.items.filter((item) => item.workspaceId === workspace) }
      setBuckets({ data, busy: false, failure: null })
      setBucket((current) => current ? data.items.find((item) => item.resourceId === current.resourceId) ?? null : null)
      return collection
    } catch (cause) { if (task.valid()) { inventory.current.loaded = false; setBucket(null); setBuckets({ data: null, busy: false, failure: api.failureOf(cause) }) }; return null }
    finally { if (task.valid()) busy.current.delete('buckets') }
  }, [begin, workspace])
  const loadUsage = useCallback(async () => {
    if (busy.current.has('usage')) return
    busy.current.add('usage')
    const task = begin('usage')
    setUsage((old) => ({ ...old, busy: true }))
    try { const data = await api.getUsage(workspace, task.signal); if (task.valid()) setUsage({ data, busy: false, failure: null }) }
    catch (cause) { if (task.valid()) setUsage({ data: null, busy: false, failure: api.failureOf(cause) }) }
    finally { if (task.valid()) busy.current.delete('usage') }
  }, [begin, workspace])
  const loadObjects = useCallback(async (selected: api.StorageBucket, after: string | null = null) => {
    if (busy.current.has('objects')) return
    busy.current.add('objects')
    const task = begin('objects')
    setAppendCursor(after)
    setObjects((old) => ({ data: after ? old.data : null, busy: true, failure: old.failure }))
    try {
      const data = await api.listObjects(selected.resourceId, after, task.signal)
      if (task.valid()) {
        setObjects((old) => ({ data: after ? { ...data, items: [...(old.data?.items ?? []), ...data.items] } : data, busy: false, failure: null }))
        setAppended(after ? data.items.length : 0)
      }
    } catch (cause) { if (task.valid()) setObjects((old) => ({ data: after ? old.data : null, busy: false, failure: api.failureOf(cause) })) }
    finally { if (task.valid()) busy.current.delete('objects') }
  }, [begin])
  const loadMetadata = useCallback(async (selected: api.StorageBucket, selectedKey: string) => {
    if (busy.current.has('metadata')) return
    busy.current.add('metadata')
    const task = begin('metadata')
    setMetadata((old) => ({ ...old, data: null, busy: true }))
    try { const data = await api.getMetadata(selected.resourceId, selectedKey, task.signal); if (task.valid()) setMetadata({ data, busy: false, failure: null }) }
    catch (cause) { if (task.valid()) setMetadata({ data: null, busy: false, failure: api.failureOf(cause) }) }
    finally { if (task.valid()) busy.current.delete('metadata') }
  }, [begin])
  const generate = async () => {
    if (!bucket || !objectKey || busy.current.has('presign')) return
    busy.current.add('presign')
    const task = begin('presign')
    setPresigned((old) => ({ ...old, data: null, busy: true }))
    try { const data = await api.presign(bucket.resourceId, objectKey, task.signal); if (task.valid()) { setPresigned({ data, busy: false, failure: null }); setNotice({ key: 'presignSuccess' }) } }
    catch (cause) { if (task.valid()) setPresigned({ data: null, busy: false, failure: api.failureOf(cause) }) }
    finally { if (task.valid()) busy.current.delete('presign') }
  }
  useEffect(() => { void loadBuckets(); void loadUsage() }, [loadBuckets, loadUsage])

  const dismiss = (operation: Operation) => setMutations((old) => ({ ...old, [operation]: idle }))
  function cancelDetails() {
    for (const scope of ['objects', 'metadata', 'presign', 'upload']) { tasks.current.get(scope)?.abort(); busy.current.delete(scope) }
    setObjects(initial()); setMetadata(initial()); setPresigned(initial()); setObjectKey(null); setTab('objects'); setShowUpload(false); setFile(null); setKey(''); dismiss('upload'); uploadAttempt.current = null; setAppended(0); setAppendCursor(null)
  }
  const selectBucket = (selected: api.StorageBucket | null) => { cancelDetails(); setBucket(selected); if (selected) void loadObjects(selected) }
  const selectObject = (selected: string | null) => {
    tasks.current.get('metadata')?.abort(); busy.current.delete('metadata')
    tasks.current.get('presign')?.abort(); busy.current.delete('presign')
    setMetadata(initial()); setPresigned(initial()); setObjectKey(selected)
    if (bucket && selected) void loadMetadata(bucket, selected)
  }
  async function perform(operation: Operation, retry = false, target?: api.StorageBucket) {
    if (busy.current.has(operation)) return
    const selected = operation === 'delete' ? deleting : operation === 'export' ? target ?? exporting : bucket
    if (operation !== 'create' && !selected) return
    if (operation === 'upload' && !file && !uploadAttempt.current) return
    busy.current.add(operation)
    const task = begin(operation)
    setMutations((old) => ({ ...old, [operation]: { ...old[operation], busy: true } }))
    setNotice(null)
    const success = (message: Notice) => { if (task.valid()) { setNotice(message); dismiss(operation) } }
    const refresh = async () => { if (task.valid()) { await loadBuckets(); if (task.valid()) await loadUsage() } }
    try {
      if (operation === 'create') {
        if (retry && mutations.create.failure?.status === undefined && beforeCreate.current) {
          const attempt = beforeCreate.current
          const collection = await loadBuckets()
          if (!task.valid()) return
          const found = attempt.loaded && collection && api.reconcileCreate(collection, workspace, attempt.name, attempt.ids)
          if (found) { success({ key: 'created', values: { name: found.bucketName } }); setName(''); setShowCreate(false); await loadUsage() }
          else if (collection) { success({ key: 'outcomeUnknown' }) }
          // A failed reconciliation remains an unknown create outcome and can be retried by GET only.
          else setMutations((old) => ({ ...old, create: { busy: false, failure: {} } }))
        } else {
          const trimmed = name.trim()
          beforeCreate.current = { name: trimmed, ids: [...inventory.current.ids], loaded: inventory.current.loaded }
          const result = await api.createBucket(workspace, trimmed, task.signal)
          if (!task.valid()) return
          success({ key: 'created', values: { name: result.bucket.bucketName } }); setName(''); setShowCreate(false); await refresh()
        }
      } else if (operation === 'upload') {
        if (!retry || !uploadAttempt.current) {
          const chosen = file!
          const content = await api.readBase64(chosen)
          if (!task.valid()) return
          uploadAttempt.current = { bucket: selected!.resourceId, key: key.trim() || chosen.name, content, type: chosen.type || 'application/octet-stream' }
        }
        const input = uploadAttempt.current!
        const result = await api.uploadObject(input.bucket, input.key, input.content, input.type, task.signal)
        if (!task.valid()) return
        success({ key: 'uploaded', values: { key: result.objectKey, size: bytes(result.sizeBytes) ?? '' } }); setShowUpload(false); setFile(null); setKey(''); uploadAttempt.current = null; await loadObjects(selected!)
      } else if (operation === 'export') {
        const manifest = await api.exportBucket(workspace, selected!.resourceId, task.signal)
        if (!task.valid()) return
        const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }))
        try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${manifest.manifestId}.json`; anchor.click() } finally { URL.revokeObjectURL(url) }
        success({ key: 'exported', values: { count: manifest.totalObjects, id: manifest.manifestId } })
      } else {
        try { await api.deleteBucket(selected!.resourceId, task.signal) }
        catch (cause) { if (!(api.failureOf(cause).status === 404 && retry)) throw cause }
        if (!task.valid()) return
        success({ key: 'deleted', values: { name: selected!.bucketName } }); setDeleting(null)
        if (bucket?.resourceId === selected!.resourceId) selectBucket(null)
        await refresh()
      }
    } catch (cause) {
      if (task.valid()) {
        const failure = api.failureOf(cause)
        setMutations((old) => ({ ...old, [operation]: { busy: false, failure } }))
        if (failure.status === 404 && (operation === 'export' || operation === 'delete')) await refresh()
      }
    } finally {
      if (task.valid()) { busy.current.delete(operation); setMutations((old) => ({ ...old, [operation]: { ...old[operation], busy: false } })) }
    }
  }
  return { buckets, usage, objects, metadata, presigned, bucket, objectKey, tab, setTab, selectBucket, selectObject,
    showCreate, setShowCreate, name, setName, showUpload, setShowUpload, file, setFile, key, setKey, deleting, setDeleting, exporting, setExporting,
    mutations, notice, appended, appendCursor, dismiss, perform, loadBuckets, loadUsage, loadObjects, loadMetadata, generate }
}
export type StorageState = ReturnType<typeof useStorage>
