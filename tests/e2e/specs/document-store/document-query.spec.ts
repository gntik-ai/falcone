// Document-store E2E — query (change add-ferretdb-document-store-e2e, #464, task 2.5).
// Scenario DOC-E2E-005: POST /v1/collections/{name}/query with a filter returns only matches.
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient, docItems } from '../../helpers/document-store/document-store-api-client'
import { probeDocumentApi, DOCUMENT_GATE_REASON } from '../../helpers/document-store/document-store-gate'

test.describe('document-store: query documents', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: DocumentApiClient
  let seeded = false
  const cpBase = controlPlaneBaseUrl()
  const COLLECTION = collectionName('query')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeDocumentApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || DOCUMENT_GATE_REASON)
    client = createDocumentApiClient(ctx, cpBase, TENANT_A)
    const a = await client.createDocument(COLLECTION, { kind: 'q', category: 'red', n: 1 })
    const b = await client.createDocument(COLLECTION, { kind: 'q', category: 'blue', n: 2 })
    seeded = a.status === 201 && b.status === 201
  })

  test.afterAll(async () => {
    await ctx?.dispose()
  })

  test('DOC-E2E-005: query with a filter returns only matching documents', async () => {
    test.skip(!seeded, 'seed documents failed in beforeAll')
    const res = await client.queryDocuments(COLLECTION, { filter: { category: { $eq: 'red' } } })
    expect(res.status).toBe(200)
    const items = docItems(res.body)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((d) => d.category === 'red')).toBe(true)
  })
})
