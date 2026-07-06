// Storage bucket export/import, tenant configuration export, and workspace clone client for the
// console (change: add-data-export-import-clone, #683). Calls the control-plane routes exactly; URLs
// match the published catalog. Mongo/Postgres/Functions export-import live in their own family API
// modules (mongoApi / postgresApi / functionsApi).
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

// ---- Storage bucket export / import ----
export interface StorageExportManifestEntry {
  objectKey: string
  sizeBytes: number
  contentType: string
  bodyReference: Record<string, JsonValue>
}

export interface StorageExportManifest {
  entityType: string
  manifestId: string
  formatVersion: number
  sourceBucketId: string
  sourceTenantId: string
  totalObjects: number
  totalBytes: number
  entries: StorageExportManifestEntry[]
}

export interface StorageImportResultSummary {
  entityType: string
  importId: string
  targetBucketId: string
  totalEntries: number
  importedCount: number
  skippedCount: number
  failedCount: number
  outcomes: Array<{ objectKey: string | null; status: string; reason: string | null }>
}

const bucketDataBase = (workspaceId: string, bucketId: string) =>
  `/v1/storage/workspaces/${enc(workspaceId)}/buckets/${enc(bucketId)}`

// ---- Bucket create / object upload (#758: storage console CRUD completeness) ----
export interface StorageCreateBucketResult {
  bucket: {
    resourceId: string
    bucketName: string
    workspaceId: string
    tenantId: string
    region?: string
    status?: string
  }
  record?: Record<string, JsonValue>
  storageCredential?: Record<string, JsonValue> | null
}

// Provision a new bucket for a workspace. `name` is only a HINT: the control plane derives a
// DNS-safe, workspace-id-scoped physical bucket name (`deriveBucketName`), so the returned
// `bucket.bucketName` may differ from the requested name — callers should surface the returned
// name rather than assuming the request echoed back verbatim. A per-workspace bucket-count quota
// (default 8) rejects with 409 `STORAGE_QUOTA_EXCEEDED` once reached.
export function createBucket(
  workspaceId: string,
  options: { name?: string } = {}
): Promise<StorageCreateBucketResult> {
  const body: Record<string, JsonValue> = {}
  if (options.name != null) body.name = options.name
  return requestConsoleSessionJson<StorageCreateBucketResult>(`/v1/storage/workspaces/${enc(workspaceId)}/buckets`, {
    method: 'POST',
    body
  })
}

export interface StorageUploadObjectResult {
  objectKey: string
  bucketName: string
  sizeBytes: number
  contentType: string
}

// Upload a single object's exact bytes via the JSON envelope the control plane's
// `resolveObjectBody` accepts: `encoding: 'base64'` decodes `content` to the exact byte sequence
// (so binary content, e.g. images, round-trips byte-identically), rather than the UTF-8 string
// path used when `encoding` is omitted. A per-workspace total-bytes quota (when configured)
// rejects with 409 `STORAGE_QUOTA_EXCEEDED`.
export function uploadObject(
  bucketId: string,
  objectKey: string,
  options: { content: string; contentType: string }
): Promise<StorageUploadObjectResult> {
  return requestConsoleSessionJson<StorageUploadObjectResult>(
    `/v1/storage/buckets/${enc(bucketId)}/objects/${enc(objectKey)}`,
    {
      method: 'PUT',
      body: { content: options.content, contentType: options.contentType, encoding: 'base64' }
    }
  )
}

// Export a bucket's objects into an inline manifest (bounded; over a size cap -> 413). The manifest
// is also persisted in the bucket and re-readable via getBucketExportManifest.
export function exportBucketObjects(
  workspaceId: string,
  bucketId: string,
  options: { prefix?: string } = {}
): Promise<StorageExportManifest> {
  const body: Record<string, JsonValue> = {}
  if (options.prefix != null) body.prefix = options.prefix
  return requestConsoleSessionJson<StorageExportManifest>(`${bucketDataBase(workspaceId, bucketId)}/exports`, {
    method: 'POST',
    body
  })
}

export function getBucketExportManifest(
  workspaceId: string,
  bucketId: string,
  manifestId: string
): Promise<StorageExportManifest> {
  return requestConsoleSessionJson<StorageExportManifest>(
    `${bucketDataBase(workspaceId, bucketId)}/exports/${enc(manifestId)}`
  )
}

// Import a manifest into a bucket the caller owns. Each entry is re-validated against the target
// tenant server-side (path-traversal / cross-tenant / protected-key entries are skipped).
export function importBucketObjects(
  workspaceId: string,
  bucketId: string,
  manifest: StorageExportManifest,
  options: { conflictPolicy?: 'overwrite' | 'skip' | 'fail' } = {}
): Promise<StorageImportResultSummary> {
  const body: Record<string, JsonValue> = { manifest: manifest as unknown as JsonValue }
  if (options.conflictPolicy != null) body.conflictPolicy = options.conflictPolicy
  return requestConsoleSessionJson<StorageImportResultSummary>(`${bucketDataBase(workspaceId, bucketId)}/imports`, {
    method: 'POST',
    body
  })
}

// ---- Tenant configuration export ----
export interface TenantConfigExport {
  entityType: string
  formatVersion: number
  tenant: { tenantId: string; slug: string | null; displayName: string | null; state: string | null }
  workspaces: Array<{ workspaceId: string; slug: string | null; environment: string | null }>
  quotas: Array<{ dimension: string | null; effectiveValue: number | null }>
  excluded: string[]
}

// Export a READ-ONLY, non-sensitive snapshot of the tenant's configuration (no secrets/credentials).
export function exportTenantConfiguration(tenantId: string): Promise<TenantConfigExport> {
  return requestConsoleSessionJson<TenantConfigExport>(`/v1/tenants/${enc(tenantId)}/exports`, { method: 'POST', body: {} })
}

// ---- Workspace clone ----
export interface WorkspaceCloneResult {
  clone: {
    sourceWorkspaceId: string
    targetWorkspaceId: string
    tenantId: string
    environment: string
    copied: { functions: string[] }
    notCopied: string[]
  }
  workspace: Record<string, JsonValue>
}

// Clone a workspace into a NEW workspace in the SAME tenant (function registry copied; never
// secrets/credentials/service-accounts).
export function cloneWorkspace(
  workspaceId: string,
  spec: { displayName?: string; slug?: string; environment?: string } = {}
): Promise<WorkspaceCloneResult> {
  return requestConsoleSessionJson<WorkspaceCloneResult>(`/v1/workspaces/${enc(workspaceId)}/clone`, {
    method: 'POST',
    body: spec as unknown as JsonValue
  })
}
