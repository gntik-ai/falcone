// Typed HTTP client for the wired document-store routes (change add-ferretdb-document-store-e2e,
// #464, task 1.2). Mirrors tests/e2e/helpers/storage/storage-api-client.ts: a Playwright
// APIRequestContext, gateway-bypass identity headers (honoured by an e2e-profile control-plane),
// and a { status, body } response shape. Routes confirmed in
// services/gateway-config/public-route-catalog.json:
//   POST   /v1/collections/{name}/documents
//   GET    /v1/collections/{name}/documents
//   PUT    /v1/collections/{name}/documents/{id}
//   DELETE /v1/collections/{name}/documents/{id}
//   POST   /v1/collections/{name}/query
//   POST   /v1/collections/{name}/search          (aggregation pipeline)
//   POST   /v1/collections/{name}/vector-indexes               (structural_admin)
//   DELETE /v1/collections/{name}/vector-indexes/{indexName}   (structural_admin)
import type { APIRequestContext } from '@playwright/test'

export interface TenantIdentity {
  tenantId: string
  workspaceId: string
  actorId?: string
  roleName?: string
  /** e.g. ['structural_admin'] for vector-index management routes. */
  actorRoles?: string[]
}

type JsonBody = unknown
export interface DocApiResponse<T = JsonBody> {
  status: number
  body: T
}

function identityHeaders(identity: TenantIdentity): Record<string, string> {
  const headers: Record<string, string> = {
    // Gateway-bypass identity headers — an e2e-profile control-plane (DEPLOYMENT_PROFILE=e2e)
    // trusts these; a standard build derives identity from a Bearer JWT instead and the
    // live-gate skips the suite.
    'x-tenant-id': identity.tenantId,
    'x-workspace-id': identity.workspaceId,
    'x-auth-subject': identity.actorId ?? 'e2e-docstore-actor',
    'x-pg-role': identity.roleName ?? 'falcone_app',
    'content-type': 'application/json',
    accept: 'application/json',
  }
  if (identity.actorRoles && identity.actorRoles.length > 0) {
    headers['x-actor-roles'] = identity.actorRoles.join(',')
  }
  return headers
}

async function callApi<T = JsonBody>(
  request: APIRequestContext,
  method: 'get' | 'post' | 'put' | 'delete',
  url: string,
  identity: TenantIdentity,
  data?: JsonBody,
): Promise<DocApiResponse<T>> {
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

export function createDocumentApiClient(
  request: APIRequestContext,
  baseUrl: string,
  identity: TenantIdentity,
) {
  const enc = encodeURIComponent
  const col = (name: string) => `${baseUrl}/v1/collections/${enc(name)}`

  return {
    /** POST /v1/collections/{name}/documents */
    createDocument: (collection: string, document: JsonBody) =>
      callApi(request, 'post', `${col(collection)}/documents`, identity, document),

    /** GET /v1/collections/{name}/documents */
    listDocuments: (collection: string) =>
      callApi(request, 'get', `${col(collection)}/documents`, identity),

    /** PUT /v1/collections/{name}/documents/{id} */
    updateDocument: (collection: string, id: string, document: JsonBody) =>
      callApi(request, 'put', `${col(collection)}/documents/${enc(id)}`, identity, document),

    /** DELETE /v1/collections/{name}/documents/{id} */
    deleteDocument: (collection: string, id: string) =>
      callApi(request, 'delete', `${col(collection)}/documents/${enc(id)}`, identity),

    /** POST /v1/collections/{name}/query — filter-based query */
    queryDocuments: (collection: string, body: JsonBody) =>
      callApi(request, 'post', `${col(collection)}/query`, identity, body),

    /** POST /v1/collections/{name}/search — aggregation pipeline */
    aggregateDocuments: (collection: string, pipeline: JsonBody) =>
      callApi(request, 'post', `${col(collection)}/search`, identity, { pipeline }),

    /** POST /v1/collections/{name}/vector-indexes (structural_admin) */
    createVectorIndex: (collection: string, definition: JsonBody) =>
      callApi(request, 'post', `${col(collection)}/vector-indexes`, identity, definition),

    /** DELETE /v1/collections/{name}/vector-indexes/{indexName} (structural_admin) */
    deleteVectorIndex: (collection: string, indexName: string) =>
      callApi(request, 'delete', `${col(collection)}/vector-indexes/${enc(indexName)}`, identity),
  }
}

export type DocumentApiClient = ReturnType<typeof createDocumentApiClient>

// Response-shape helpers — tolerant of the control-plane returning the document/list under
// a few common envelope keys (the executor returns { item } / { items, page }; HTTP handlers
// may wrap as { document } / { documents } / { data }).
export function docId(body: unknown): string | undefined {
  const b = body as Record<string, any> | undefined
  return b?.id ?? b?._id ?? b?.item?._id ?? b?.item?.id ?? b?.document?._id ?? b?.document?.id
}

export function docItems(body: unknown): any[] {
  const b = body as Record<string, any> | undefined
  if (Array.isArray(b)) return b
  return (b?.items ?? b?.documents ?? b?.data ?? b?.results ?? []) as any[]
}

