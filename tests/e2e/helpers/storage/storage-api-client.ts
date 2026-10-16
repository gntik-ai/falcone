/**
 * Storage API client for E2E specs (change: add-seaweedfs-storage-e2e).
 *
 * Wraps Playwright's `APIRequestContext` for bucket lifecycle and object routes. A Bearer JWT
 * is authoritative on the standard build. Identity headers also support the gateway-bypass
 * E2E profile; they do not replace authentication in the disposable fixture smoke.
 *
 * Public storage routes used by the specs:
 *   GET  /v1/storage/buckets
 *   POST /v1/storage/workspaces/{workspaceId}/buckets
 *   DELETE /v1/storage/buckets/{bucketId}
 *   GET  /v1/storage/workspaces/{workspaceId}/usage
 *   GET  /v1/storage/buckets/{bucketId}/objects
 *   GET  /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata
 *   PUT/GET/DELETE /v1/storage/buckets/{bucketId}/objects/{objectKey}
 *
 * Response shapes verified against apps/control-plane/storage-handlers.mjs:
 *   listBuckets       -> { items: BucketDescriptor[], page: { size: number } }
 *   provisionBucket   -> 201, { bucket: { resourceId, bucketName, workspaceId, tenantId, region, status }, record }
 *   workspaceUsage    -> 200, { dimensions: { totalBytes, bucketCount, objectCount, objectSizeBytes }, buckets }
 *   listObjects       -> 200, { items: ObjectDescriptor[], page: { size, nextCursor? } }
 *   objectMetadata    -> 200, { objectKey, bucketName, contentType, sizeBytes, etag, timestamps }
 */

import type { APIRequestContext, APIResponse } from '@playwright/test'

export interface TenantIdentity {
  tenantId: string
  workspaceId: string
  actorId?: string
  roleName?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = Record<string, any>

export interface StorageApiResponse<T = JsonBody> {
  status: number
  body: T
}

function identityHeaders(identity: TenantIdentity, bearerToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    // Identity headers (honoured by a gateway-bypass / e2e-profile control-plane).
    'x-tenant-id': identity.tenantId,
    'x-workspace-id': identity.workspaceId,
    'x-auth-subject': identity.actorId ?? 'e2e-storage-actor',
    'x-pg-role': identity.roleName ?? 'falcone_app',
    'content-type': 'application/json',
    accept: 'application/json',
  }
  // Bearer JWT is authoritative on the standard control-plane build: it derives the
  // tenant/workspace identity from the token's claims and ignores the x-* headers.
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`
  return headers
}

async function callApi<T = JsonBody>(
  request: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'delete',
  url: string,
  identity: TenantIdentity,
  bearerToken: string | null | undefined,
  data?: JsonBody,
): Promise<StorageApiResponse<T>> {
  let res: APIResponse
  try {
    res = await request[method](url, {
      headers: identityHeaders(identity, bearerToken),
      ...(data !== undefined ? { data } : {}),
    })
  } catch {
    // Playwright request errors can carry the URL and auth headers in their call log.
    throw new Error(`Storage API ${method.toUpperCase()} request failed`)
  }
  let body: T
  try {
    body = (await res.json()) as T
  } catch {
    body = {} as T
  }
  const status = res.status()
  // APIRequestContext otherwise retains response bodies (including one-time credentials).
  await res.dispose()
  return { status, body }
}

export function createStorageApiClient(
  request: APIRequestContext,
  baseUrl: string,
  identity: TenantIdentity,
  bearerToken?: string | null,
) {
  const enc = encodeURIComponent
  const t = bearerToken

  return {
    /** GET /v1/storage/buckets — list all buckets for the authenticated tenant */
    listBuckets: () =>
      callApi(request, 'get', `${baseUrl}/v1/storage/buckets`, identity, t),

    /** POST /v1/storage/workspaces/{workspaceId}/buckets — provision a new bucket */
    provisionBucket: (workspaceId: string, name: string) =>
      callApi(request, 'post', `${baseUrl}/v1/storage/workspaces/${enc(workspaceId)}/buckets`, identity, t, { name }),

    deleteBucket: (bucketId: string) =>
      callApi(request, 'delete', `${baseUrl}/v1/storage/buckets/${enc(bucketId)}`, identity, t),

    /** GET /v1/storage/workspaces/{workspaceId}/usage — per-workspace usage metrics */
    getWorkspaceUsage: (workspaceId: string) =>
      callApi(request, 'get', `${baseUrl}/v1/storage/workspaces/${enc(workspaceId)}/usage`, identity, t),

    /** GET /v1/storage/buckets/{bucketId}/objects — list objects in a bucket */
    listObjects: (bucketId: string, after?: string) =>
      callApi(request, 'get', `${baseUrl}/v1/storage/buckets/${enc(bucketId)}/objects${after ? `?page[after]=${enc(after)}` : ''}`, identity, t),

    putObject: (bucketId: string, objectKey: string, bytes: Buffer) =>
      callApi(request, 'put', `${baseUrl}/v1/storage/buckets/${enc(bucketId)}/objects/${enc(objectKey)}`, identity, t,
        { contentBase64: bytes.toString('base64'), contentType: 'application/octet-stream' }),

    getObject: (bucketId: string, objectKey: string) =>
      callApi(request, 'get', `${baseUrl}/v1/storage/buckets/${enc(bucketId)}/objects/${enc(objectKey)}`, identity, t),

    deleteObject: (bucketId: string, objectKey: string) =>
      callApi(request, 'delete', `${baseUrl}/v1/storage/buckets/${enc(bucketId)}/objects/${enc(objectKey)}`, identity, t),

    /** GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata — object HEAD metadata */
    getObjectMetadata: (bucketId: string, objectKey: string) =>
      callApi(
        request,
        'get',
        `${baseUrl}/v1/storage/buckets/${enc(bucketId)}/objects/${enc(objectKey)}/metadata`,
        identity,
        t,
      ),
  }
}

export type StorageApiClient = ReturnType<typeof createStorageApiClient>
