// Document-store E2E — list (change add-ferretdb-document-store-e2e, #464, task 2.2).
// Scenario DOC-E2E-002: GET /v1/collections/{name}/documents returns 200 incl. the created doc.
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient, docId, docItems } from '../../helpers/document-store/document-store-api-client'
import { probeDocumentApi, DOCUMENT_GATE_REASON } from '../../helpers/document-store/document-store-gate'

test.describe('document-store: list documents', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: DocumentApiClient
  let createdId: string | undefined
  const cpBase = controlPlaneBaseUrl()
  const COLLECTION = collectionName('list')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeDocumentApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || DOCUMENT_GATE_REASON)
    client = createDocumentApiClient(ctx, cpBase, TENANT_A)
    const created = await client.createDocument(COLLECTION, { kind: 'list-probe', name: 'beta' })
    createdId = docId(created.body)
  })

  test.afterAll(async () => {
    if (createdId) await client?.deleteDocument(COLLECTION, createdId).catch(() => {})
    await ctx?.dispose()
  })

  test('DOC-E2E-002: list returns 200 and includes the created document', async () => {
    test.skip(!createdId, 'document creation failed in beforeAll')
    const res = await client.listDocuments(COLLECTION)
    expect(res.status).toBe(200)
    const items = docItems(res.body)
    expect(Array.isArray(items)).toBe(true)
    expect(items.some((d) => docId(d) === createdId)).toBe(true)
  })
})
