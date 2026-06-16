// Document-store E2E — delete (change add-ferretdb-document-store-e2e, #464, task 2.4).
// Scenario DOC-E2E-004: DELETE /v1/collections/{name}/documents/{id} returns 200; doc is gone.
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient, docId, docItems } from '../../helpers/document-store/document-store-api-client'
import { probeDocumentApi, DOCUMENT_GATE_REASON } from '../../helpers/document-store/document-store-gate'

test.describe('document-store: delete document', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: DocumentApiClient
  let createdId: string | undefined
  const cpBase = controlPlaneBaseUrl()
  const COLLECTION = collectionName('delete')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeDocumentApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || DOCUMENT_GATE_REASON)
    client = createDocumentApiClient(ctx, cpBase, TENANT_A)
    const created = await client.createDocument(COLLECTION, { kind: 'delete-probe' })
    createdId = docId(created.body)
  })

  test.afterAll(async () => {
    await ctx?.dispose()
  })

  test('DOC-E2E-004: delete returns 200 and the document is absent on a subsequent list', async () => {
    test.skip(!createdId, 'document creation failed in beforeAll')
    const res = await client.deleteDocument(COLLECTION, createdId!)
    expect(res.status).toBe(200)
    const list = await client.listDocuments(COLLECTION)
    expect(docItems(list.body).some((d) => docId(d) === createdId)).toBe(false)
  })
})
