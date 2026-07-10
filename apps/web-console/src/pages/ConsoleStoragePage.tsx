import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { ConnectionSnippets } from '@/components/console/ConnectionSnippets'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError } from '@/lib/console-errors'
import { formatBytes } from '@/lib/format'
import { requestConsoleSessionJson } from '@/lib/console-session'
import { DESTRUCTIVE_OP_LEVELS } from '@/lib/destructive-ops'
import { cn } from '@/lib/utils'
import { createBucket, exportBucketObjects, uploadObject } from '@/services/dataExportImportApi'
import type { SnippetContext } from '@/lib/snippets/snippet-types'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'
type SectionState<T> = { data: T; loading: boolean; error: string | null }
type BucketTab = 'objects' | 'presigned' | 'multipart'

type PageInfo = {
  after?: string
  nextCursor?: string
  size?: number
}

type StorageBucket = {
  resourceId: string
  tenantId: string
  workspaceId: string
  bucketName: string
  region?: string
  status?: string
  timestamps?: {
    createdAt?: string
    updatedAt?: string
    lastModifiedAt?: string
  }
  provisioning?: {
    state?: string
    failureClass?: string
    gatingMode?: string
  }
}

type StorageBucketCollection = {
  items: StorageBucket[]
  page?: PageInfo
}

type StorageObjectMetadata = {
  resourceId?: string
  bucketResourceId?: string
  bucketName?: string
  objectKey: string
  contentType?: string
  sizeBytes?: number
  etag?: string
  metadata?: Record<string, string>
  storageClass?: string
  checksumSha256?: string
  versionId?: string
  providerType?: string
  applicationId?: string
  namespace?: string
  organization?: Record<string, unknown>
  timestamps?: {
    createdAt?: string
    updatedAt?: string
    lastModifiedAt?: string
  }
}

type StorageObjectCollection = {
  items: StorageObjectMetadata[]
  page?: PageInfo
}

type StorageUsageDimensionStatus = {
  dimension?: string
  used?: number
  limit?: number | null
  remaining?: number | null
  utilizationPercent?: number | null
}

type StorageBucketUsageEntry = {
  bucketId: string
  totalBytes?: number
  objectCount?: number
  largestObjectSizeBytes?: number
}

type StorageUsageSnapshot = {
  collectionMethod?: string
  collectionStatus?: string
  snapshotAt?: string
  cacheSnapshotAt?: string | null
  dimensions?: {
    totalBytes?: StorageUsageDimensionStatus
    bucketCount?: StorageUsageDimensionStatus
    objectCount?: StorageUsageDimensionStatus
    objectSizeBytes?: StorageUsageDimensionStatus
  }
  buckets?: StorageBucketUsageEntry[]
}

const EMPTY_BUCKETS_STATE: SectionState<StorageBucket[]> = { data: [], loading: false, error: null }
const EMPTY_OBJECTS_STATE: SectionState<StorageObjectCollection | null> = { data: null, loading: false, error: null }
const EMPTY_OBJECT_META_STATE: SectionState<StorageObjectMetadata | null> = { data: null, loading: false, error: null }
const EMPTY_USAGE_STATE: SectionState<StorageUsageSnapshot | null> = { data: null, loading: false, error: null }

const STORAGE_BUCKETS_PAGE_SIZE = 100
const STORAGE_OBJECTS_PAGE_SIZE = 50
// Presigned URL ISSUANCE is wired (#676: POST .../objects/{key}/presign). There is still no
// public GET inventory of previously-issued presigned URLs (they are stateless SigV4 URLs), so
// the "inventory" flag stays false; the console offers a generate-on-demand action instead.
const STORAGE_PRESIGNED_READ_API_AVAILABLE = false
// Multipart upload is wired (#676), but a full chunked-upload UI is out of scope here; the public
// surface has no multipart-session inventory endpoint, so this read flag stays false.
const STORAGE_MULTIPART_READ_API_AVAILABLE = false
// Default lifetime (seconds) requested for a console-generated presigned download URL. The backend
// clamps this to the platform maximum (STORAGE_PRESIGN_MAX_TTL_SECONDS, default 3600).
const PRESIGNED_DOWNLOAD_TTL_SECONDS = 300

// #758 visual polish — centralized class treatments (mirroring the module-level `emptyStateClassName`
// idiom in EventsConsole/ConsoleFunctionsPage) so the create/upload disclosure forms, the actionable
// empty states and the success notice stay consistent instead of carrying one-off inline strings.
//
// Active disclosure form: a solid, subtly-lit "well" that reads as an input surface — deliberately
// distinct from the dashed, recessed empty-state placeholders below (solid border + muted fill).
const DISCLOSURE_FORM_CLASS = 'space-y-4 rounded-2xl border border-border bg-muted/30 p-4 sm:p-5'
// Actionable empty state inside an already-populated card: centered, dashed and muted with room for a
// primary CTA — the console's empty-state convention (ConsoleMembersPage/ConsolePostgresPage), sized
// as an in-card inset (bg-background/40) rather than a full-section panel.
const CARD_EMPTY_STATE_CLASS =
  'flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-background/40 px-6 py-10 text-center'
// Polite success notice: identical tokens to the design system's Alert `success` variant (emerald
// tone + rounded-2xl/px-4/py-3 geometry) but rendered as a roleless element, so it can live inside the
// persistent aria-live="polite" region without the assertive role Alert hardcodes.
const SUCCESS_NOTICE_CLASS =
  'rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-100'

type StoragePresignedUrl = {
  url: string
  operation: string
  bucketName: string
  objectKey: string
  expiresAt: string
  ttlSeconds: number
  ttlClamped?: boolean
}

// Reads a File in-browser and resolves its exact bytes as a base64 string (#758), via the
// FileReader data-URL path (`data:<mime>;base64,<data>`), stripping the "data:...;base64," prefix.
// The result is sent to `uploadObject`'s JSON envelope so binary content round-trips byte-faithfully
// (see `resolveObjectBody`'s `encoding: 'base64'` branch on the control-plane side).
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('unexpected FileReader result type'))
        return
      }
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

function isAbortError(rawError: unknown): boolean {
  return rawError instanceof DOMException
    ? rawError.name === 'AbortError'
    : Boolean(rawError && typeof rawError === 'object' && 'name' in rawError && rawError.name === 'AbortError')
}

function formatEnumLabel(value?: string): string {
  if (!value) return '—'
  const labels: Record<string, string> = {
    active: 'Activo',
    cached_snapshot: 'Instantánea en caché',
    complete: 'Completo',
    failed: 'Fallido',
    multipart: 'Multiparte',
    provider_unavailable: 'Proveedor no disponible',
    provisioned: 'Aprovisionado',
    provisioning: 'Aprovisionamiento'
  }
  const normalized = value.toLowerCase()
  if (labels[normalized]) return labels[normalized]
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}

function formatRelativeDate(value?: string | null): string {
  if (!value) return '—'
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return value
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (diffMinutes < 1) return 'hace menos de 1 minuto'
  if (diffMinutes === 1) return 'hace 1 minuto'
  if (diffMinutes < 60) return `hace ${diffMinutes} minutos`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours === 1) return 'hace 1 hora'
  if (diffHours < 24) return `hace ${diffHours} horas`
  const diffDays = Math.round(diffHours / 24)
  return diffDays === 1 ? 'hace 1 día' : `hace ${diffDays} días`
}

function getSnapshotAgeMinutes(snapshot?: StorageUsageSnapshot | null): number | null {
  const source = snapshot?.cacheSnapshotAt ?? snapshot?.snapshotAt
  if (!source) return null
  const timestamp = new Date(source).getTime()
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
}

function statusTone(value?: string): BadgeVariant {
  const normalized = value?.toLowerCase()
  if (normalized === 'active' || normalized === 'ok') return 'default'
  if (normalized === 'provisioning' || normalized === 'partial') return 'secondary'
  if (normalized === 'provider_unavailable' || normalized === 'suspended' || normalized === 'error' || normalized === 'failed') return 'destructive'
  return 'outline'
}

function KeyValueGrid({ items }: { items: Array<{ label: string; value: unknown }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div className="rounded-lg border border-border p-3" key={item.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-sm break-words">{formatValue(item.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function UnsupportedApiState({ surface }: { surface: 'presigned' | 'multipart' }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" role="status">
      <p className="font-medium text-foreground">
        {surface === 'presigned' ? 'URLs prefirmadas' : 'Cargas multiparte'} no disponible en la API pública actual.
      </p>
      <p className="mt-2">
        La familia pública de almacenamiento no expone una ruta GET de inventario para esta superficie. La consola permanece en modo solo lectura y no usa rutas no documentadas.
      </p>
    </div>
  )
}

export function ConsoleStoragePage() {
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()
  const [buckets, setBuckets] = useState<SectionState<StorageBucket[]>>(EMPTY_BUCKETS_STATE)
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null)
  const [bucketTab, setBucketTab] = useState<BucketTab>('objects')
  const [objects, setObjects] = useState<SectionState<StorageObjectCollection | null>>(EMPTY_OBJECTS_STATE)
  const [selectedObjectKey, setSelectedObjectKey] = useState<string | null>(null)
  const [objectMeta, setObjectMeta] = useState<SectionState<StorageObjectMetadata | null>>(EMPTY_OBJECT_META_STATE)
  const [usage, setUsage] = useState<SectionState<StorageUsageSnapshot | null>>(EMPTY_USAGE_STATE)
  // #676 object-I/O completeness affordances (write actions; not part of the read snapshots).
  const [presigned, setPresigned] = useState<SectionState<StoragePresignedUrl | null>>({ data: null, loading: false, error: null })
  const [bucketActionError, setBucketActionError] = useState<string | null>(null)
  const [exportingBucketId, setExportingBucketId] = useState<string | null>(null)
  const [bucketExportNotice, setBucketExportNotice] = useState<string | null>(null)
  // #758: bucket delete now routes through the shared destructive-confirmation dialog instead of
  // firing the DELETE immediately.
  const destructiveOp = useDestructiveOp()
  // #758: create-bucket affordance + form state.
  const [showCreateBucketForm, setShowCreateBucketForm] = useState(false)
  const [newBucketName, setNewBucketName] = useState('')
  const [creatingBucket, setCreatingBucket] = useState(false)
  const [createBucketError, setCreateBucketError] = useState<string | null>(null)
  const newBucketNameId = useId()
  const createBucketFormId = useId()
  const createBucketHelpId = useId()
  const newBucketNameRef = useRef<HTMLInputElement>(null)
  // #758: upload-object affordance + form state (per selected bucket; reset alongside the rest of
  // the bucket-detail state below).
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [uploadKey, setUploadKey] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadingObject, setUploadingObject] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadKeyId = useId()
  const uploadFileId = useId()
  const uploadKeyHelpId = useId()
  const uploadFileHelpId = useId()
  const uploadFormId = useId()
  const uploadKeyRef = useRef<HTMLInputElement>(null)
  const uploadFileInputRef = useRef<HTMLInputElement>(null)

  const resetBucketDetailState = useCallback(() => {
    setBucketTab('objects')
    setObjects(EMPTY_OBJECTS_STATE)
    setSelectedObjectKey(null)
    setObjectMeta(EMPTY_OBJECT_META_STATE)
    setShowUploadForm(false)
    setUploadKey('')
    setUploadFile(null)
    setUploadError(null)
  }, [])

  const loadBuckets = useCallback(async (workspaceId: string, signal?: AbortSignal) => {
    setBuckets((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await requestConsoleSessionJson<StorageBucketCollection>(`/v1/storage/buckets?page[size]=${STORAGE_BUCKETS_PAGE_SIZE}`, { signal })
      const filtered = data.items.filter((bucket) => bucket.workspaceId === workspaceId)
      setBuckets({ data: filtered, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setBuckets({ data: [], loading: false, error: describeConsoleError(error, 'No se pudo cargar el inventario de buckets.') })
    }
  }, [])

  const loadUsage = useCallback(async (workspaceId: string, signal?: AbortSignal) => {
    setUsage((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await requestConsoleSessionJson<StorageUsageSnapshot>(`/v1/storage/workspaces/${workspaceId}/usage`, { signal })
      setUsage({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setUsage({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo cargar el uso del área de trabajo.') })
    }
  }, [])

  const loadObjects = useCallback(async (bucketId: string, after: string | null, signal?: AbortSignal) => {
    setObjects((current) => ({ data: after ? current.data : null, loading: true, error: null }))

    const query = new URLSearchParams({ 'page[size]': String(STORAGE_OBJECTS_PAGE_SIZE) })
    if (after) query.set('page[after]', after)

    try {
      const data = await requestConsoleSessionJson<StorageObjectCollection>(`/v1/storage/buckets/${bucketId}/objects?${query.toString()}`, { signal })
      setObjects((current) => ({
        data: after && current.data
          ? {
              items: [...current.data.items, ...data.items],
              page: data.page
            }
          : data,
        loading: false,
        error: null
      }))
    } catch (error) {
      if (isAbortError(error)) return
      setObjects((current) => ({
        data: after ? current.data : null,
        loading: false,
        error: describeConsoleError(error, 'No se pudo cargar el inventario de objetos.')
      }))
    }
  }, [])

  const loadObjectMeta = useCallback(async (bucketId: string, objectKey: string, signal?: AbortSignal) => {
    setObjectMeta((current) => ({ ...current, loading: true, error: null }))

    try {
      const data = await requestConsoleSessionJson<StorageObjectMetadata>(`/v1/storage/buckets/${bucketId}/objects/${encodeURIComponent(objectKey)}/metadata`, { signal })
      setObjectMeta({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setObjectMeta({ data: null, loading: false, error: describeConsoleError(error, 'No se pudieron cargar los metadatos del objeto.') })
    }
  }, [])

  // Generate a presigned DOWNLOAD URL for the selected object (#676). The backend returns a
  // time-limited SigV4 URL scoped to exactly this bucket+object+operation; the TTL is clamped to
  // the platform maximum server-side.
  const generatePresignedDownloadUrl = useCallback(async (bucketId: string, objectKey: string) => {
    setPresigned({ data: null, loading: true, error: null })
    try {
      const data = await requestConsoleSessionJson<StoragePresignedUrl>(
        `/v1/storage/buckets/${bucketId}/objects/${encodeURIComponent(objectKey)}/presign`,
        { method: 'POST', body: { operation: 'download', ttlSeconds: PRESIGNED_DOWNLOAD_TTL_SECONDS } }
      )
      setPresigned({ data, loading: false, error: null })
    } catch (error) {
      if (isAbortError(error)) return
      setPresigned({ data: null, loading: false, error: describeConsoleError(error, 'No se pudo generar la URL prefirmada.') })
    }
  }, [])

  // Export a bucket's objects into an inline manifest (#683). The manifest is also persisted in the
  // bucket; here we surface the object count + a download of the manifest JSON for the operator.
  const exportBucketAction = useCallback(async (bucketId: string, workspaceId: string) => {
    setBucketExportNotice(null)
    setBucketActionError(null)
    setExportingBucketId(bucketId)
    try {
      const manifest = await exportBucketObjects(workspaceId, bucketId)
      // Offer the manifest as a downloadable file so the operator can re-import it elsewhere.
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${manifest.manifestId}.json`
      a.click()
      URL.revokeObjectURL(url)
      setBucketExportNotice(`Exportados ${manifest.totalObjects} objeto(s) (manifiesto ${manifest.manifestId}).`)
    } catch (error) {
      if (!isAbortError(error)) setBucketActionError(describeConsoleError(error, 'No se pudo exportar el bucket.'))
    } finally {
      setExportingBucketId(null)
    }
  }, [])

  // Delete a SINGLE bucket the caller owns (#676), now guarded by the shared destructive-op
  // confirmation dialog (#758 — the safety crux): the DELETE fires only after the operator types
  // the exact bucket name and confirms (CRITICAL level, mirroring ConsoleServiceAccountsPage's
  // delete-service-account flow). `onConfirm` awaits the request and lets a rejection THROW so the
  // dialog surfaces `confirmError`; the list/usage refresh + status notice move to `onSuccess`.
  const deleteBucketRequest = useCallback(async (bucketId: string) => {
    await requestConsoleSessionJson<{ bucket: string; deleted: boolean }>(`/v1/storage/buckets/${bucketId}`, { method: 'DELETE' })
  }, [])

  const openDeleteBucketDialog = useCallback((bucket: StorageBucket) => {
    destructiveOp.openDialog({
      level: DESTRUCTIVE_OP_LEVELS['delete-storage-bucket'],
      operationId: 'delete-storage-bucket',
      resourceName: bucket.bucketName,
      resourceType: 'bucket',
      impactDescription: 'Se eliminarán el bucket y TODOS sus objetos de forma permanente. Esta acción es irreversible.',
      onConfirm: () => deleteBucketRequest(bucket.resourceId),
      onSuccess: () => {
        setSelectedBucketId((current) => (current === bucket.resourceId ? null : current))
        setBucketActionError(null)
        setBucketExportNotice(`Bucket "${bucket.bucketName}" eliminado.`)
        void loadBuckets(bucket.workspaceId)
        void loadUsage(bucket.workspaceId)
      }
    })
  }, [deleteBucketRequest, destructiveOp.openDialog, loadBuckets, loadUsage])

  // Create a bucket for the active workspace (#758). `name` is only a hint — the control plane
  // derives a DNS-safe, workspace-scoped physical name, so the operator is told the effective name
  // may differ and the confirmation notice always echoes back the ACTUAL created name.
  const createBucketAction = useCallback(async (workspaceId: string) => {
    setCreateBucketError(null)
    setCreatingBucket(true)
    try {
      const trimmed = newBucketName.trim()
      const result = await createBucket(workspaceId, trimmed ? { name: trimmed } : {})
      setNewBucketName('')
      setShowCreateBucketForm(false)
      setBucketActionError(null)
      setBucketExportNotice(`Bucket creado: ${result.bucket.bucketName}.`)
      await loadBuckets(workspaceId)
      await loadUsage(workspaceId)
    } catch (error) {
      if (!isAbortError(error)) setCreateBucketError(describeConsoleError(error, 'No se pudo crear el bucket.'))
    } finally {
      setCreatingBucket(false)
    }
  }, [newBucketName, loadBuckets, loadUsage])

  // Upload a single object's exact bytes into the selected bucket (#758). The file is read
  // in-browser and sent as a base64 JSON envelope (see `readFileAsBase64` / `resolveObjectBody`
  // above) so binary content round-trips byte-faithfully.
  const uploadObjectAction = useCallback(async (bucketId: string) => {
    if (!uploadFile) return
    setUploadError(null)
    setUploadingObject(true)
    try {
      const key = uploadKey.trim() || uploadFile.name
      const content = await readFileAsBase64(uploadFile)
      const result = await uploadObject(bucketId, key, { content, contentType: uploadFile.type || 'application/octet-stream' })
      setUploadKey('')
      setUploadFile(null)
      setShowUploadForm(false)
      if (uploadFileInputRef.current) uploadFileInputRef.current.value = ''
      setBucketActionError(null)
      setBucketExportNotice(`Objeto subido: ${result.objectKey} (${formatBytes(result.sizeBytes)}).`)
      await loadObjects(bucketId, null)
    } catch (error) {
      if (!isAbortError(error)) setUploadError(describeConsoleError(error, 'No se pudo subir el objeto.'))
    } finally {
      setUploadingObject(false)
    }
  }, [uploadFile, uploadKey, loadObjects])

  useEffect(() => {
    setBuckets(EMPTY_BUCKETS_STATE)
    setSelectedBucketId(null)
    resetBucketDetailState()
    setUsage(EMPTY_USAGE_STATE)
    setBucketActionError(null)
    setBucketExportNotice(null)
    setShowCreateBucketForm(false)
    setNewBucketName('')
    setCreateBucketError(null)

    if (!activeWorkspaceId) {
      return undefined
    }

    const controller = new AbortController()
    void Promise.allSettled([
      loadBuckets(activeWorkspaceId, controller.signal),
      loadUsage(activeWorkspaceId, controller.signal)
    ])
    return () => controller.abort()
  }, [activeTenantId, activeWorkspaceId, loadBuckets, loadUsage, resetBucketDetailState])

  useEffect(() => {
    if (!selectedBucketId) {
      resetBucketDetailState()
      return undefined
    }

    setSelectedObjectKey(null)
    setObjectMeta(EMPTY_OBJECT_META_STATE)
    setPresigned({ data: null, loading: false, error: null })

    const controller = new AbortController()
    void loadObjects(selectedBucketId, null, controller.signal)
    return () => controller.abort()
  }, [loadObjects, resetBucketDetailState, selectedBucketId])

  useEffect(() => {
    if (!selectedBucketId || !selectedObjectKey) {
      setObjectMeta(EMPTY_OBJECT_META_STATE)
      return undefined
    }

    const controller = new AbortController()
    void loadObjectMeta(selectedBucketId, selectedObjectKey, controller.signal)
    return () => controller.abort()
  }, [loadObjectMeta, selectedBucketId, selectedObjectKey])

  // #758 a11y: when a disclosure form opens, move focus into it so keyboard and screen-reader
  // users land on the first field instead of being stranded on the toggle button. Focus is not
  // forced on close — clicking the toggle keeps focus on it, and a successful create/upload/delete
  // is announced through the polite live region below.
  useEffect(() => {
    if (showCreateBucketForm) newBucketNameRef.current?.focus()
  }, [showCreateBucketForm])

  useEffect(() => {
    if (showUploadForm) uploadKeyRef.current?.focus()
  }, [showUploadForm])

  const selectedBucket = useMemo(
    () => buckets.data.find((bucket) => bucket.resourceId === selectedBucketId) ?? null,
    [buckets.data, selectedBucketId]
  )

  const bucketNameById = useMemo(
    () => new Map(buckets.data.map((bucket) => [bucket.resourceId, bucket.bucketName])),
    [buckets.data]
  )

  const nextObjectCursor = objects.data?.page?.nextCursor ?? objects.data?.page?.after ?? null
  const usageAgeMinutes = getSnapshotAgeMinutes(usage.data)
  const quotaPercent = usage.data?.dimensions?.totalBytes?.utilizationPercent ?? null
  const quotaLimit = usage.data?.dimensions?.totalBytes?.limit ?? null

  const storageSnippetContext = useMemo<SnippetContext | null>(() => {
    if (!selectedBucket) {
      return null
    }

    const resourceState = selectedBucket.provisioning?.state ?? selectedBucket.status ?? null

    return {
      tenantId: selectedBucket.tenantId,
      tenantSlug: null,
      workspaceId: selectedBucket.workspaceId,
      workspaceSlug: null,
      resourceName: selectedBucket.bucketName,
      resourceHost: null,
      resourcePort: null,
      resourceExtraA: selectedBucket.region ?? null,
      resourceExtraB: null,
      resourceState,
      externalAccessEnabled: resourceState === 'active'
    }
  }, [selectedBucket])

  if (!activeTenantId) {
    return <p role="alert">Selecciona una organización para continuar.</p>
  }

  if (!activeWorkspaceId) {
    return <WorkspaceRequiredState description="Selecciona un área de trabajo para ver los recursos de almacenamiento." />
  }

  return (
    <section className="space-y-6" data-testid="console-storage-page">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Almacenamiento / objetos</h1>
        <p className="text-sm text-muted-foreground">Buckets, objetos, metadatos y uso del área de trabajo activa. Crear buckets, subir objetos y eliminar un bucket (con confirmación) están disponibles desde esta página.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-6">
          <Card aria-busy={buckets.loading}>
            <CardHeader>
              <div>
                <CardTitle>Buckets</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Inventario visible para el área de trabajo activa.</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{buckets.data.length} visibles</Badge>
                <Button
                  onClick={() => setShowCreateBucketForm((current) => !current)}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={showCreateBucketForm}
                  aria-controls={createBucketFormId}
                >
                  {showCreateBucketForm ? 'Cerrar' : 'Nuevo bucket'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {showCreateBucketForm ? (
                <form
                  id={createBucketFormId}
                  aria-busy={creatingBucket}
                  className={cn('mb-4', DISCLOSURE_FORM_CLASS)}
                  onSubmit={(event) => {
                    event.preventDefault()
                    void createBucketAction(activeWorkspaceId)
                  }}
                  noValidate
                >
                  <div className="space-y-1.5">
                    <Label htmlFor={newBucketNameId}>Nombre del bucket (opcional)</Label>
                    <Input
                      id={newBucketNameId}
                      ref={newBucketNameRef}
                      value={newBucketName}
                      onChange={(event) => setNewBucketName(event.target.value)}
                      placeholder="p. ej. media-assets"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={creatingBucket}
                      aria-describedby={createBucketHelpId}
                    />
                    <p id={createBucketHelpId} className="text-xs leading-5 text-muted-foreground">
                      El nombre es orientativo: el final puede normalizarse (minúsculas, DNS-seguro) y queda asociado a esta área de trabajo. Al crearlo se confirma el nombre real.
                    </p>
                  </div>
                  {createBucketError ? <Alert variant="destructive">{createBucketError}</Alert> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" size="sm" disabled={creatingBucket} aria-busy={creatingBucket}>
                      {creatingBucket ? 'Creando…' : 'Crear'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={creatingBucket}
                      onClick={() => {
                        setShowCreateBucketForm(false)
                        setNewBucketName('')
                        setCreateBucketError(null)
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              ) : null}
              {buckets.loading ? <p>Cargando buckets…</p> : null}
              {!buckets.loading && buckets.error ? (
                <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm text-destructive">{buckets.error}</p>
                  <Button onClick={() => void loadBuckets(activeWorkspaceId)} type="button" variant="outline" size="sm" className="mt-3">Reintentar</Button>
                </div>
              ) : null}
              {!buckets.loading && !buckets.error && buckets.data.length === 0 ? (
                <div className={CARD_EMPTY_STATE_CLASS} role="status">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">No hay buckets en el área de trabajo seleccionada.</p>
                    <p className="text-sm text-muted-foreground">Crea el primero para empezar a almacenar objetos.</p>
                  </div>
                  {!showCreateBucketForm ? (
                    <Button onClick={() => setShowCreateBucketForm(true)} type="button">
                      Crear bucket
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {bucketActionError ? <Alert variant="destructive" className="mb-3">{bucketActionError}</Alert> : null}
              {/* Persistent polite live region so create/upload/delete/export success is announced
                  reliably even though it renders here (in the buckets column) after an async op. */}
              <div aria-live="polite" className="empty:hidden">
                {bucketExportNotice ? <p className={cn('mb-3', SUCCESS_NOTICE_CLASS)}>{bucketExportNotice}</p> : null}
              </div>
              {!buckets.loading && !buckets.error && buckets.data.length > 0 ? (
                <Table aria-label="Listado de buckets del área de trabajo activa">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Región</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Aprovisionamiento</TableHead>
                      <TableHead>Creado</TableHead>
                      <TableHead>Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buckets.data.map((bucket) => {
                      const selected = bucket.resourceId === selectedBucketId
                      return (
                        <TableRow className={selected ? 'bg-primary/10' : ''} key={bucket.resourceId}>
                          <TableCell className="align-top">
                            <Button
                              variant="link"
                              className="h-auto max-w-full justify-start p-0 text-left font-medium"
                              onClick={() => {
                                setSelectedBucketId(bucket.resourceId)
                                setBucketTab('objects')
                              }}
                              type="button"
                            >
                              {bucket.bucketName}
                            </Button>
                            <div className="text-xs text-muted-foreground">{bucket.resourceId}</div>
                          </TableCell>
                          <TableCell className="align-top">{formatValue(bucket.region)}</TableCell>
                          <TableCell className="align-top"><Badge variant={statusTone(bucket.status)}>{formatEnumLabel(bucket.status)}</Badge></TableCell>
                          <TableCell className="align-top">{bucket.provisioning?.state ? <Badge variant={statusTone(bucket.provisioning.state)}>{formatEnumLabel(bucket.provisioning.state)}</Badge> : '—'}</TableCell>
                          <TableCell className="align-top">{formatRelativeDate(bucket.timestamps?.createdAt)}</TableCell>
                          <TableCell className="align-top">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                disabled={exportingBucketId === bucket.resourceId}
                                onClick={() => void exportBucketAction(bucket.resourceId, bucket.workspaceId)}
                                type="button"
                                variant="outline"
                                size="sm"
                              >
                                {exportingBucketId === bucket.resourceId ? 'Exportando…' : 'Exportar'}
                              </Button>
                              <Button
                                onClick={() => openDeleteBucketDialog(bucket)}
                                type="button"
                                variant="destructive"
                                size="sm"
                              >
                                Eliminar
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>

          <Card aria-busy={usage.loading}>
            <CardHeader>
              <div>
                <CardTitle>Uso del área de trabajo</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Instantánea pública de volumen, recuento y distribución por bucket.</p>
              </div>
            </CardHeader>
            <CardContent>
              {usage.loading ? <p>Cargando uso…</p> : null}
              {!usage.loading && usage.error ? (
                <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm text-destructive">{usage.error}</p>
                  <Button onClick={() => void loadUsage(activeWorkspaceId)} type="button" variant="outline" size="sm" className="mt-3">Reintentar</Button>
                </div>
              ) : null}
              {!usage.loading && !usage.error && usage.data ? (
                <div className="space-y-4">
                  {usage.data.collectionStatus === 'provider_unavailable' ? (
                    <p role="alert">El proveedor no expone una instantánea de uso disponible en este momento. La consola no interpreta este estado como cero.</p>
                  ) : null}

                  {usageAgeMinutes !== null && usageAgeMinutes > 15 ? (
                    <p role="alert">La instantánea de uso tiene {usageAgeMinutes} minutos; los valores pueden estar desactualizados.</p>
                  ) : null}

                  <KeyValueGrid items={[
                    { label: 'Volumen total', value: formatBytes(usage.data.dimensions?.totalBytes?.used) },
                    { label: 'Objetos totales', value: usage.data.dimensions?.objectCount?.used },
                    { label: 'Buckets', value: usage.data.dimensions?.bucketCount?.used },
                    { label: 'Método de colección', value: formatEnumLabel(usage.data.collectionMethod) },
                    { label: 'Estado de colección', value: formatEnumLabel(usage.data.collectionStatus) },
                    { label: 'Instantánea', value: formatRelativeDate(usage.data.cacheSnapshotAt ?? usage.data.snapshotAt) }
                  ]} />

                  {typeof quotaPercent === 'number' && quotaLimit !== null ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span>Cuota usada</span>
                        <span>{Math.round(quotaPercent)}% · {formatBytes(usage.data.dimensions?.totalBytes?.used)} / {formatBytes(quotaLimit)}</span>
                      </div>
                      <div
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={Math.max(0, Math.min(100, Math.round(quotaPercent)))}
                        className="h-3 overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                      >
                        <div className={`h-full ${quotaPercent >= 90 ? 'bg-destructive' : quotaPercent >= 75 ? 'bg-yellow-500' : 'bg-primary'}`} style={{ width: `${Math.max(0, Math.min(100, quotaPercent))}%` }} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">La API pública no expone un límite de cuota para esta instantánea.</p>
                  )}

                  {usage.data.collectionStatus !== 'provider_unavailable' ? (
                    usage.data.buckets?.length ? (
                      <Table aria-label="Desglose de uso por bucket">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Bucket</TableHead>
                            <TableHead>Volumen</TableHead>
                            <TableHead>Objetos</TableHead>
                            <TableHead>Objeto mayor</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {usage.data.buckets.map((bucket) => (
                            <TableRow key={bucket.bucketId}>
                              <TableCell>{bucketNameById.get(bucket.bucketId) ?? bucket.bucketId}</TableCell>
                              <TableCell>{formatBytes(bucket.totalBytes)}</TableCell>
                              <TableCell>{formatValue(bucket.objectCount)}</TableCell>
                              <TableCell>{formatBytes(bucket.largestObjectSizeBytes)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p>No hay desglose por bucket disponible en la instantánea pública.</p>
                    )
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          {!selectedBucket ? (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Detalle del bucket</h2>
              <p className="text-sm text-muted-foreground">Selecciona un bucket para inspeccionar objetos, metadatos y superficies auxiliares disponibles en la API pública.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {storageSnippetContext ? <ConnectionSnippets resourceType="storage-bucket" context={storageSnippetContext} /> : null}
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{selectedBucket.bucketName}</h2>
                <Badge variant={statusTone(selectedBucket.status)}>{formatEnumLabel(selectedBucket.status)}</Badge>
                {selectedBucket.provisioning?.state ? <Badge variant={statusTone(selectedBucket.provisioning.state)}>{formatEnumLabel(selectedBucket.provisioning.state)}</Badge> : null}
              </div>

              <Tabs value={bucketTab} onValueChange={(value) => setBucketTab(value as BucketTab)}>
                <TabsList aria-label={`Secciones del bucket ${selectedBucket.bucketName}`}>
                  {(['objects', 'presigned', 'multipart'] as BucketTab[]).map((tab) => (
                    <TabsTrigger key={tab} value={tab}>
                      {tab === 'objects' ? 'Objetos' : tab === 'presigned' ? 'URLs prefirmadas' : 'Multiparte'}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="objects" className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-muted-foreground">Objetos del bucket seleccionado.</p>
                    <Button
                      onClick={() => setShowUploadForm((current) => !current)}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-expanded={showUploadForm}
                      aria-controls={uploadFormId}
                    >
                      {showUploadForm ? 'Cerrar' : 'Subir objeto'}
                    </Button>
                  </div>

                  {showUploadForm ? (
                    <form
                      id={uploadFormId}
                      aria-busy={uploadingObject}
                      className={DISCLOSURE_FORM_CLASS}
                      onSubmit={(event) => {
                        event.preventDefault()
                        void uploadObjectAction(selectedBucket.resourceId)
                      }}
                      noValidate
                    >
                      <div className="space-y-1.5">
                        <Label htmlFor={uploadKeyId}>Clave del objeto (opcional)</Label>
                        <Input
                          id={uploadKeyId}
                          ref={uploadKeyRef}
                          value={uploadKey}
                          onChange={(event) => setUploadKey(event.target.value)}
                          placeholder={uploadFile?.name ?? 'media/nuevo-objeto.png'}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={uploadingObject}
                          aria-describedby={uploadKeyHelpId}
                        />
                        <p id={uploadKeyHelpId} className="text-xs leading-5 text-muted-foreground">
                          Si se deja vacío, se usa el nombre del archivo seleccionado.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={uploadFileId}>Archivo</Label>
                        <Input
                          id={uploadFileId}
                          ref={uploadFileInputRef}
                          type="file"
                          className="cursor-pointer file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground file:transition-opacity hover:file:opacity-90"
                          onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                          disabled={uploadingObject}
                          aria-describedby={uploadFileHelpId}
                        />
                        <p id={uploadFileHelpId} className="text-xs leading-5 text-muted-foreground">
                          Se sube el contenido exacto del archivo (incluido binario), tal cual, al bucket seleccionado.
                        </p>
                      </div>
                      {uploadError ? <Alert variant="destructive">{uploadError}</Alert> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="submit" size="sm" disabled={!uploadFile || uploadingObject} aria-busy={uploadingObject}>
                          {uploadingObject ? 'Subiendo…' : 'Subir'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={uploadingObject}
                          onClick={() => {
                            setShowUploadForm(false)
                            setUploadKey('')
                            setUploadFile(null)
                            setUploadError(null)
                            if (uploadFileInputRef.current) uploadFileInputRef.current.value = ''
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  ) : null}

                  {objects.loading ? <p>Cargando objetos…</p> : null}
                  {!objects.loading && objects.error ? (
                    <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                      <p className="text-sm text-destructive">{objects.error}</p>
                      <Button onClick={() => void loadObjects(selectedBucket.resourceId, null)} type="button" variant="outline" size="sm" className="mt-3">Reintentar</Button>
                    </div>
                  ) : null}
                  {!objects.loading && !objects.error && objects.data && objects.data.items.length === 0 ? (
                    <div className={CARD_EMPTY_STATE_CLASS} role="status">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Este bucket está vacío.</p>
                        <p className="text-sm text-muted-foreground">Sube el primer objeto para empezar.</p>
                      </div>
                      {!showUploadForm ? (
                        <Button onClick={() => setShowUploadForm(true)} type="button">
                          Subir el primer objeto
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {!objects.error && objects.data && objects.data.items.length > 0 ? (
                    <>
                      <Table aria-label="Listado de objetos del bucket seleccionado">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Clave</TableHead>
                            <TableHead>Tamaño</TableHead>
                            <TableHead>Content-Type</TableHead>
                            <TableHead>Última modificación</TableHead>
                            <TableHead>ETag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {objects.data.items.map((item) => {
                            const selected = item.objectKey === selectedObjectKey
                            return (
                              <TableRow className={selected ? 'bg-primary/10' : ''} key={item.resourceId ?? item.objectKey}>
                                <TableCell className="align-top">
                                  <Button
                                    variant="link"
                                    className="h-auto max-w-[22rem] justify-start truncate p-0 text-left font-medium"
                                    onClick={() => setSelectedObjectKey(item.objectKey)}
                                    title={item.objectKey}
                                    type="button"
                                  >
                                    {item.objectKey}
                                  </Button>
                                </TableCell>
                                <TableCell className="align-top">{formatBytes(item.sizeBytes)}</TableCell>
                                <TableCell className="align-top">{formatValue(item.contentType)}</TableCell>
                                <TableCell className="align-top">{formatRelativeDate(item.timestamps?.lastModifiedAt)}</TableCell>
                                <TableCell className="align-top">{formatValue(item.etag)}</TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>

                      {nextObjectCursor ? (
                        <Button disabled={objects.loading} onClick={() => void loadObjects(selectedBucket.resourceId, nextObjectCursor)} type="button">
                          {objects.loading ? 'Cargando…' : 'Página siguiente'}
                        </Button>
                      ) : null}
                    </>
                  ) : null}

                  {selectedObjectKey ? (
                    <Card className="space-y-3 rounded-2xl bg-background/40 p-4 shadow-none">
                      <div>
                        <h3 className="font-semibold">Metadatos del objeto</h3>
                        <p className="text-sm text-muted-foreground">Detalle de solo lectura obtenido desde el punto de conexión público de metadatos.</p>
                      </div>

                      {objectMeta.loading ? <p>Cargando metadatos…</p> : null}
                      {!objectMeta.loading && objectMeta.error ? <p role="alert">{objectMeta.error}</p> : null}
                      {!objectMeta.loading && !objectMeta.error && objectMeta.data ? (
                        <div className="space-y-4">
                          <KeyValueGrid items={[
                            { label: 'Clave', value: objectMeta.data.objectKey },
                            { label: 'Bucket', value: objectMeta.data.bucketName },
                            { label: 'Tamaño', value: formatBytes(objectMeta.data.sizeBytes) },
                            { label: 'Content-Type', value: objectMeta.data.contentType },
                            { label: 'Clase de almacenamiento', value: objectMeta.data.storageClass },
                            { label: 'ETag', value: objectMeta.data.etag },
                            { label: 'Checksum SHA-256', value: objectMeta.data.checksumSha256 },
                            { label: 'ID de versión', value: objectMeta.data.versionId },
                            { label: 'Proveedor', value: objectMeta.data.providerType },
                            { label: 'Aplicación', value: objectMeta.data.applicationId },
                            { label: 'Namespace', value: objectMeta.data.namespace },
                            { label: 'Creado', value: objectMeta.data.timestamps?.createdAt },
                            { label: 'Actualizado', value: objectMeta.data.timestamps?.updatedAt },
                            { label: 'Última modificación', value: objectMeta.data.timestamps?.lastModifiedAt }
                          ]} />

                          <div className="space-y-3">
                            <h4 className="font-medium">Metadatos personalizados</h4>
                            {objectMeta.data.metadata && Object.keys(objectMeta.data.metadata).length > 0 ? (
                              <Table aria-label="Metadatos personalizados del objeto">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Clave</TableHead>
                                    <TableHead>Valor</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {Object.entries(objectMeta.data.metadata).map(([key, value]) => (
                                    <TableRow key={key}>
                                      <TableCell>{key}</TableCell>
                                      <TableCell>{value}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            ) : (
                              <p>Este objeto no expone metadatos personalizados.</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </Card>
                  ) : null}
                </TabsContent>

                <TabsContent value="presigned" className="space-y-4">
                  <div>
                    <h3 className="font-semibold">URLs prefirmadas</h3>
                    <p className="text-sm text-muted-foreground">
                      Genera una URL temporal y de alcance limitado para descargar un objeto sin credenciales de Falcone. La URL
                      queda acotada a este bucket, esta clave y la operación de descarga; el TTL se recorta al máximo de la plataforma.
                    </p>
                  </div>

                  {!selectedObjectKey ? (
                    <p className="text-sm text-muted-foreground">Selecciona un objeto en la pestaña «Objetos» para generar su URL de descarga.</p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm">Objeto seleccionado: <span className="font-medium">{selectedObjectKey}</span></p>
                      <Button
                        disabled={presigned.loading}
                        onClick={() => void generatePresignedDownloadUrl(selectedBucket.resourceId, selectedObjectKey)}
                        type="button"
                      >
                        {presigned.loading ? 'Generando…' : 'Generar URL de descarga prefirmada'}
                      </Button>

                      {presigned.error ? <p role="alert">{presigned.error}</p> : null}
                      {presigned.data ? (
                        <KeyValueGrid items={[
                          { label: 'Operación', value: presigned.data.operation },
                          { label: 'Bucket', value: presigned.data.bucketName },
                          { label: 'Clave', value: presigned.data.objectKey },
                          { label: 'Expira', value: presigned.data.expiresAt },
                          { label: 'TTL (s)', value: presigned.data.ttlSeconds },
                          { label: 'TTL recortado', value: presigned.data.ttlClamped ? 'sí' : 'no' },
                          { label: 'URL', value: presigned.data.url }
                        ]} />
                      ) : null}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="multipart">
                  {STORAGE_MULTIPART_READ_API_AVAILABLE ? (
                    <p>Inventario público de sesiones multipart pendiente de implementación.</p>
                  ) : (
                    <UnsupportedApiState surface="multipart" />
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </Card>
      </section>

      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </section>
  )
}
