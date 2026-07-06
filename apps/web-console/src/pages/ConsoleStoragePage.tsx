import { useCallback, useEffect, useMemo, useState } from 'react'

import { ConnectionSnippets } from '@/components/console/ConnectionSnippets'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError } from '@/lib/console-errors'
import { requestConsoleSessionJson } from '@/lib/console-session'
import { exportBucketObjects } from '@/services/dataExportImportApi'
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

type StoragePresignedUrl = {
  url: string
  operation: string
  bucketName: string
  objectKey: string
  expiresAt: string
  ttlSeconds: number
  ttlClamped?: boolean
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

function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
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
  const [deletingBucketId, setDeletingBucketId] = useState<string | null>(null)
  const [bucketActionError, setBucketActionError] = useState<string | null>(null)
  const [exportingBucketId, setExportingBucketId] = useState<string | null>(null)
  const [bucketExportNotice, setBucketExportNotice] = useState<string | null>(null)

  const resetBucketDetailState = useCallback(() => {
    setBucketTab('objects')
    setObjects(EMPTY_OBJECTS_STATE)
    setSelectedObjectKey(null)
    setObjectMeta(EMPTY_OBJECT_META_STATE)
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

  // Delete a SINGLE bucket the caller owns (#676). On success, refresh the bucket list and clear
  // the selection if the deleted bucket was selected.
  const deleteBucketAction = useCallback(async (bucketId: string, workspaceId: string) => {
    setBucketActionError(null)
    setDeletingBucketId(bucketId)
    try {
      await requestConsoleSessionJson<{ bucket: string; deleted: boolean }>(`/v1/storage/buckets/${bucketId}`, { method: 'DELETE' })
      setSelectedBucketId((current) => (current === bucketId ? null : current))
      await loadBuckets(workspaceId)
      await loadUsage(workspaceId)
    } catch (error) {
      if (!isAbortError(error)) setBucketActionError(describeConsoleError(error, 'No se pudo eliminar el bucket.'))
    } finally {
      setDeletingBucketId(null)
    }
  }, [loadBuckets, loadUsage])

  useEffect(() => {
    setBuckets(EMPTY_BUCKETS_STATE)
    setSelectedBucketId(null)
    resetBucketDetailState()
    setUsage(EMPTY_USAGE_STATE)

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
    <main className="space-y-6" data-testid="console-storage-page">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Almacenamiento / objetos</h1>
        <p className="text-sm text-muted-foreground">Buckets, objetos, metadatos y uso del área de trabajo activa usando únicamente rutas públicas de lectura.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-6">
          <Card aria-busy={buckets.loading}>
            <CardHeader>
              <div>
                <CardTitle>Buckets</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Inventario visible para el área de trabajo activa.</p>
              </div>
              <Badge variant="outline">{buckets.data.length} visibles</Badge>
            </CardHeader>
            <CardContent>
              {buckets.loading ? <p>Cargando buckets…</p> : null}
              {!buckets.loading && buckets.error ? (
                <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm text-destructive">{buckets.error}</p>
                  <Button onClick={() => void loadBuckets(activeWorkspaceId)} type="button" variant="outline" size="sm" className="mt-3">Reintentar</Button>
                </div>
              ) : null}
              {!buckets.loading && !buckets.error && buckets.data.length === 0 ? <p>No hay buckets en el área de trabajo seleccionada.</p> : null}
              {bucketActionError ? <p className="mb-3" role="alert">{bucketActionError}</p> : null}
              {bucketExportNotice ? <p className="mb-3" role="status">{bucketExportNotice}</p> : null}
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
                                disabled={deletingBucketId === bucket.resourceId}
                                onClick={() => void deleteBucketAction(bucket.resourceId, bucket.workspaceId)}
                                type="button"
                                variant="destructive"
                                size="sm"
                              >
                                {deletingBucketId === bucket.resourceId ? 'Eliminando…' : 'Eliminar'}
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
                  {objects.loading ? <p>Cargando objetos…</p> : null}
                  {!objects.loading && objects.error ? (
                    <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                      <p className="text-sm text-destructive">{objects.error}</p>
                      <Button onClick={() => void loadObjects(selectedBucket.resourceId, null)} type="button" variant="outline" size="sm" className="mt-3">Reintentar</Button>
                    </div>
                  ) : null}
                  {!objects.loading && !objects.error && objects.data && objects.data.items.length === 0 ? <p>Este bucket está vacío.</p> : null}
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
    </main>
  )
}
