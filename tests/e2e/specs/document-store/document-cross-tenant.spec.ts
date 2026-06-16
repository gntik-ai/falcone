// Document-store E2E — cross-tenant isolation (change add-ferretdb-document-store-e2e, #464,
// tasks 6.1-6.4). Isolation is enforced by APP-LAYER tenantId scoping in
// services/adapters/src/mongodb-data-api.mjs — per-database role scoping is NOT enforced at the
// FerretDB/DocumentDB layer (ADR-14). ALL probes go through the HTTP data API; direct-to-engine
// reads are not isolated and are not a valid test surface. Falcone uses a SHARED-collection model
// (collections are not tenant-owned; the tenantId field is the boundary), so a Tenant-B write to
// the same collection name succeeds scoped to B — it must simply never appear in Tenant A's view.
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, TENANT_B, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient, docId, docItems } from '../../helpers/document-store/document-store-api-client'
import { probeDocumentApi, DOCUMENT_GATE_REASON } from '../../helpers/document-store/document-store-gate'

test.describe('document-store: cross-tenant isolation', () => {
  test.describe.configure({ mode: 'serial' })

  let ctxA: APIRequestContext
  let ctxB: APIRequestContext
  let clientA: DocumentApiClient
  let clientB: DocumentApiClient
  let docIdA: string | undefined
  const cpBase = controlPlaneBaseUrl()
  // Same collection name for both tenants (run-scoped) — the isolation boundary is tenantId.
  const COLLECTION = collectionName('xt')

  test.beforeAll(async ({ playwright }) => {
    ctxA = await playwright.request.newContext({ baseURL: cpBase })
    ctxB = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeDocumentApi(ctxA, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || DOCUMENT_GATE_REASON)
    clientA = createDocumentApiClient(ctxA, cpBase, TENANT_A)
    clientB = createDocumentApiClient(ctxB, cpBase, TENANT_B)
    const created = await clientA.createDocument(COLLECTION, { kind: 'xt', secret: 'tenant-a-only', marker: 'A' })
    docIdA = docId(created.body)
  })

  test.afterAll(async () => {
    if (docIdA) await clientA?.deleteDocument(COLLECTION, docIdA).catch(() => {})
    await ctxA?.dispose()
    await ctxB?.dispose()
  })

  test('DOC-E2E-XT-01: Tenant B does not see Tenant A\'s document in a listing', async () => {
    test.skip(!docIdA, 'Tenant A document creation failed in beforeAll')
    const res = await clientB.listDocuments(COLLECTION)
    // Either denied, or 200 with A's document absent (app-layer tenantId scoping).
    if (res.status === 403 || res.status === 404) return
    expect(res.status).toBe(200)
    expect(docItems(res.body).some((d) => docId(d) === docIdA || d.marker === 'A')).toBe(false)
  })

  test('DOC-E2E-XT-02: Tenant B query returns no results for Tenant A\'s document', async () => {
    test.skip(!docIdA, 'Tenant A document creation failed in beforeAll')
    const res = await clientB.queryDocuments(COLLECTION, { filter: { marker: { $eq: 'A' } } })
    if (res.status === 403 || res.status === 404) return
    expect(res.status).toBe(200)
    expect(docItems(res.body).length).toBe(0)
  })

  test('DOC-E2E-XT-03: Tenant B cannot leak into Tenant A\'s documents via create', async () => {
    test.skip(!docIdA, 'Tenant A document creation failed in beforeAll')
    // Shared-collection model: B's create is denied (403/404) OR succeeds scoped to B — in which
    // case it MUST NOT be visible in Tenant A's view of the collection.
    const res = await clientB.createDocument(COLLECTION, { kind: 'xt', marker: 'B-injected' })
    if (res.status === 403 || res.status === 404) return
    expect([200, 201]).toContain(res.status)
    const aView = await clientA.listDocuments(COLLECTION)
    expect(docItems(aView.body).some((d) => d.marker === 'B-injected')).toBe(false)
  })
})
