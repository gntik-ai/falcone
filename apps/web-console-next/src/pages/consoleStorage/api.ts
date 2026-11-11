// Requests mirror ConsoleStoragePage and dataExportImportApi through the shared session layer.
// Session refresh and its single authenticated replay remain entirely in console-api.
import { requestConsoleSessionJson as request, readConsoleShellSession } from '@in-falcone/console-api/session'
import type { ApiError } from '@in-falcone/console-api/http'

export type PageInfo = {
  after?: string
  nextCursor?: string
  size?: number
}

export type StorageBucket = {
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

export type StorageBucketCollection = {
  items: StorageBucket[]
  page?: PageInfo
}

export type StorageObjectMetadata = {
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

export type StorageObjectCollection = {
  items: StorageObjectMetadata[]
  page?: PageInfo
}

export type StorageUsageDimensionStatus = {
  dimension?: string
  used?: number
  limit?: number | null
  remaining?: number | null
  utilizationPercent?: number | null
}

export type StorageBucketUsageEntry = {
  bucketId: string
  totalBytes?: number
  objectCount?: number
  largestObjectSizeBytes?: number
}

export type StorageUsageSnapshot = {
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


export interface Presigned { url: string; operation: string; bucketName: string; objectKey: string; expiresAt: string; ttlSeconds: number; ttlClamped?: boolean }
export interface Manifest { manifestId: string; totalObjects: number; [key: string]: unknown }
export interface Failure { status?: number; requestId?: string }
export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined, requestId: error.requestId ?? error.correlationId }
}
export const listBuckets = (signal: AbortSignal) => request<StorageBucketCollection>('/v1/storage/buckets?page[size]=100', { signal })
export const getUsage = (workspace: string, signal: AbortSignal) => request<StorageUsageSnapshot>(`/v1/storage/workspaces/${workspace}/usage`, { signal })
export function listObjects(bucket: string, after: string | null, signal: AbortSignal) {
  const query = new URLSearchParams({ 'page[size]': '50' })
  if (after) query.set('page[after]', after)
  return request<StorageObjectCollection>(`/v1/storage/buckets/${bucket}/objects?${query}`, { signal })
}
export const getMetadata = (bucket: string, key: string, signal: AbortSignal) => request<StorageObjectMetadata>(`/v1/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}/metadata`, { signal })
export const presign = (bucket: string, key: string, signal: AbortSignal) => request<Presigned>(`/v1/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}/presign`, { method: 'POST', body: { operation: 'download', ttlSeconds: 300 }, signal })
export const createBucket = (workspace: string, name: string, signal: AbortSignal) => request<{ bucket: StorageBucket }>(`/v1/storage/workspaces/${encodeURIComponent(workspace)}/buckets`, { method: 'POST', body: name ? { name } : {}, signal })
export const uploadObject = (bucket: string, key: string, content: string, contentType: string, signal: AbortSignal) => request<{ objectKey: string; sizeBytes: number }>(`/v1/storage/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}`, { method: 'PUT', body: { content, contentType, encoding: 'base64' }, signal })
export const exportBucket = (workspace: string, bucket: string, signal: AbortSignal) => request<Manifest>(`/v1/storage/workspaces/${encodeURIComponent(workspace)}/buckets/${encodeURIComponent(bucket)}/exports`, { method: 'POST', body: {}, signal })
export async function deleteBucket(bucket: string, signal: AbortSignal) {
  // A session-layer replay may encounter a deletion already applied by the first attempt.
  // Compare in memory only; no authentication material becomes page state or output.
  const originalToken = readConsoleShellSession()?.tokenSet?.accessToken
  try { return await request<unknown>(`/v1/storage/buckets/${bucket}`, { method: 'DELETE', signal }) }
  catch (cause) {
    const currentToken = readConsoleShellSession()?.tokenSet?.accessToken
    if (failureOf(cause).status === 404 && originalToken && currentToken && originalToken !== currentToken) return undefined
    throw cause
  }
}
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new TypeError('FileReader'))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// A first tenant cursor page cannot prove absence. The name must be exact and the id new.
export function reconcileCreate(collection: StorageBucketCollection, workspace: string, name: string, before: readonly string[]) {
  const matches = collection.items.filter((bucket) => bucket.workspaceId === workspace && bucket.bucketName === name)
  return name && !collection.page?.after && !collection.page?.nextCursor && matches.length === 1 && !before.includes(matches[0].resourceId) ? matches[0] : null
}
