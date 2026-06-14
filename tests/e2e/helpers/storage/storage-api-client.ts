/**
 * Storage API client for E2E specs (change: add-seaweedfs-storage-e2e).
 *
 * Wraps Playwright's `APIRequestContext` to call the five wired control-plane storage routes
 * directly, carrying the gateway-injected identity headers the control-plane reads (same pattern
 * as mcp-api-client / flows-api-client). No real JWT/Keycloak is needed: the control-plane
 * reads `x-tenant-id`, `x-workspace-id`, `x-auth-subject`, `x-pg-role` as trust headers.
 *
 * Wired routes asserted (deploy/kind/control-plane/routes.mjs:118-123):
 *   GET  /v1/storage/buckets
 *   POST /v1/storage/workspaces/{workspaceId}/buckets
 *   GET  /v1/storage/workspaces/{workspaceId}/usage
 *   GET  /v1/storage/buckets/{bucketId}/objects
 *   GET  /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata
 *
 * Response shapes verified against deploy/kind/control-plane/storage-handlers.mjs:
 *   listBuckets       -> { items: BucketDescriptor[], page: { size: number } }
 *   provisionBucket   -> 201, { bucket: { resourceId, bucketName, workspaceId, tenantId, region, status }, record }
 *   workspaceUsage    -> 200, { dimensions: { totalBytes, bucketCount, objectCount, objectSizeBytes }, buckets }
 *   listObjects       -> 200, { items: ObjectDescriptor[], page: { size, nextCursor? } }
 *   objectMetadata    -> 200, { objectKey, bucketName, contentType, sizeBytes, etag, timestamps }
 */

import type { APIRequestContext } from '@playwright/test'

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

function identityHeaders(identity: TenantIdentity): Record<string, string> {
  return {
    'x-tenant-id': identity.tenantId,
    'x-workspace-id': identity.workspaceId,
    'x-auth-subject': identity.actorId ?? 'e2e-storage-actor',
    'x-pg-role': identity.roleName ?? 'falcone_app',
    'content-type': 'application/json',
    accept: 'application/json',
  }
}

async function callApi<T = JsonBody>(
  request: APIRequestContext,
  method: 'get' | 'post' | 'delete',
  url: string,
  identity: TenantIdentity,
  data?: JsonBody,
): Promise<StorageApiResponse<T>> {
  const res = await request[method](url, {
    headers: identityHeaders(identity),
    ...(data !== undefined ? { data } : {}),
  })
  let body: T
  try {
    body = (await res.json()) as T
  } catch {
    body = {} as T
  }
  return { status: res.status(), body }
}

export function createStorageApiClient(
  request: APIRequestContext,
  baseUrl: string,
  identity: TenantIdentity,
) {
  const enc = encodeURIComponent

  return {
    /** GET /v1/storage/buckets — list all buckets for the authenticated tenant */
    listBuckets: () =>
      callApi(request, 'get', `${baseUrl}/v1/storage/buckets`, identity),

    /** POST /v1/storage/workspaces/{workspaceId}/buckets — provision a new bucket */
    provisionBucket: (workspaceId: string, name: string) =>
      callApi(request, 'post', `${baseUrl}/v1/storage/workspaces/${enc(workspaceId)}/buckets`, identity, { name }),

    /** GET /v1/storage/workspaces/{workspaceId}/usage — per-workspace usage metrics */
    getWorkspaceUsage: (workspaceId: string) =>
      callApi(request, 'get', `${baseUrl}/v1/storage/workspaces/${enc(workspaceId)}/usage`, identity),

    /** GET /v1/storage/buckets/{bucketId}/objects — list objects in a bucket */
    listObjects: (bucketId: string) =>
      callApi(request, 'get', `${baseUrl}/v1/storage/buckets/${enc(bucketId)}/objects`, identity),

    /** GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata — object HEAD metadata */
    getObjectMetadata: (bucketId: string, objectKey: string) =>
      callApi(
        request,
        'get',
        `${baseUrl}/v1/storage/buckets/${enc(bucketId)}/objects/${enc(objectKey)}/metadata`,
        identity,
      ),
  }
}

export type StorageApiClient = ReturnType<typeof createStorageApiClient>
