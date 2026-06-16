// Document-store E2E — update (change add-ferretdb-document-store-e2e, #464, task 2.3).
// Scenario DOC-E2E-003: PUT /v1/collections/{name}/documents/{id} returns 200; GET reflects it.
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient, docId, docItems } from '../../helpers/document-store/document-store-api-client'
import { probeDocumentApi, DOCUMENT_GATE_REASON } from '../../helpers/document-store/document-store-gate'

test.describe('document-store: update document', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: DocumentApiClient
  let createdId: string | undefined
  const cpBase = controlPlaneBaseUrl()
  const COLLECTION = collectionName('update')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeDocumentApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || DOCUMENT_GATE_REASON)
    client = createDocumentApiClient(ctx, cpBase, TENANT_A)
    const created = await client.createDocument(COLLECTION, { kind: 'update-probe', status: 'draft' })
    createdId = docId(created.body)
  })

  test.afterAll(async () => {
    if (createdId) await client?.deleteDocument(COLLECTION, createdId).catch(() => {})
    await ctx?.dispose()
  })

  test('DOC-E2E-003: update returns 200 and the new field values are visible on read', async () => {
    test.skip(!createdId, 'document creation failed in beforeAll')
    const res = await client.updateDocument(COLLECTION, createdId!, { kind: 'update-probe', status: 'published' })
    expect(res.status).toBe(200)
    const list = await client.listDocuments(COLLECTION)
    const found = docItems(list.body).find((d) => docId(d) === createdId)
    expect(found?.status).toBe('published')
  })
})
