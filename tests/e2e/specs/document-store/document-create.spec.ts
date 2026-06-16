// Document-store E2E — create (change add-ferretdb-document-store-e2e, #464, task 2.1).
// Scenario DOC-E2E-001: POST /v1/collections/{name}/documents returns 201 with a document id.
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient, docId } from '../../helpers/document-store/document-store-api-client'
import { probeDocumentApi, DOCUMENT_GATE_REASON } from '../../helpers/document-store/document-store-gate'

test.describe('document-store: create document', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: DocumentApiClient
  const cpBase = controlPlaneBaseUrl()
  const COLLECTION = collectionName('create')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeDocumentApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || DOCUMENT_GATE_REASON)
    client = createDocumentApiClient(ctx, cpBase, TENANT_A)
  })

  test.afterAll(async () => {
    await ctx?.dispose()
  })

  test('DOC-E2E-001: create document returns 201 with an id', async () => {
    const res = await client.createDocument(COLLECTION, { kind: 'probe', name: 'alpha', value: 1 })
    expect(res.status).toBe(201)
    expect(docId(res.body)).toBeTruthy()
  })
})
