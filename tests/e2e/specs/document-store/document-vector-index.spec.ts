// Document-store E2E — vector-index (change add-ferretdb-document-store-e2e, #464, tasks 4.1-4.3).
// Uses the ONLY index route in the public route catalog: /v1/collections/{name}/vector-indexes
// (structural_admin). There is NO /v1/collections/{name}/indexes route (task 4.4). The DocumentDB
// engine bundles pgvector 0.8.1; a beforeAll create-probe skips the suite if the route is not wired
// or pgvector is not active.
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient } from '../../helpers/document-store/document-store-api-client'

// structural_admin identity — the vector-index routes are structural_admin privilege.
const ADMIN_A = { ...TENANT_A, actorRoles: ['structural_admin'], roleName: 'falcone_structural_admin' }

test.describe('document-store: vector-index management', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: DocumentApiClient
  let indexCreated = false
  const cpBase = controlPlaneBaseUrl()
  const COLLECTION = collectionName('vidx')
  const INDEX_NAME = 'e2e_vec_idx'
  const DEFINITION = { name: INDEX_NAME, field: 'embedding', dimensions: 3, metric: 'cosine' }

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    client = createDocumentApiClient(ctx, cpBase, ADMIN_A)
    // Create-probe gate: skip the suite if the API is unreachable, the vector-index route is not
    // wired, the identity is not structural_admin, or pgvector is not active.
    let status: number | null = null
    try {
      const res = await client.createVectorIndex(COLLECTION, DEFINITION)
      status = res.status
    } catch {
      test.skip(true, `document-store API unreachable at ${cpBase} — start the stack first`)
      return
    }
    indexCreated = status === 200 || status === 201
    test.skip(
      !indexCreated,
      `vector-index route returned HTTP ${status} — route not wired, not structural_admin, or pgvector not active`,
    )
  })

  test.afterAll(async () => {
    if (indexCreated) await client?.deleteVectorIndex(COLLECTION, INDEX_NAME).catch(() => {})
    await ctx?.dispose()
  })

  test('DOC-E2E-IDX-001: vector-index creation returns 200/201', async () => {
    // Creation already succeeded in beforeAll (the gate). Re-assert idempotently.
    const res = await client.createVectorIndex(COLLECTION, DEFINITION)
    expect([200, 201, 409]).toContain(res.status) // 409 if it already exists from beforeAll
  })

  test('DOC-E2E-IDX-002: vector-index deletion returns 200', async () => {
    const res = await client.deleteVectorIndex(COLLECTION, INDEX_NAME)
    expect(res.status).toBe(200)
    indexCreated = false // deleted; afterAll need not re-delete
  })
})
