// Document-store E2E — aggregation (change add-ferretdb-document-store-e2e, #464, tasks 3.1-3.6).
// Affirmative assertions (no defensive skip-on-operator): the ADR-14 spike confirmed all 15
// adapter-allowed stages are exact on FerretDB 2.7.0. Only $out/$merge are adapter-blocked, and
// cross-DB $lookup is engine-rejected (Location40321).
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

import { TENANT_A, controlPlaneBaseUrl, collectionName } from '../../helpers/document-store/tenant-fixtures'
import { createDocumentApiClient, DocumentApiClient, docItems } from '../../helpers/document-store/document-store-api-client'
import { probeDocumentApi, DOCUMENT_GATE_REASON } from '../../helpers/document-store/document-store-gate'

test.describe('document-store: aggregation', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: DocumentApiClient
  let aggReady = false
  const cpBase = controlPlaneBaseUrl()
  const COLLECTION = collectionName('agg')
  // Seed n = 1..5 (kind 'agg'): sum=15, avg=3, top-3 desc = 5,4,3.
  const SEED = [1, 2, 3, 4, 5]

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeDocumentApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || DOCUMENT_GATE_REASON)
    client = createDocumentApiClient(ctx, cpBase, TENANT_A)
    for (const n of SEED) await client.createDocument(COLLECTION, { kind: 'agg', n })
    // Aggregation sub-gate: skip the suite if POST /search is not wired (404/501) on this build.
    const probe = await client.aggregateDocuments(COLLECTION, [{ $match: { kind: 'agg' } }, { $count: 'c' }])
    aggReady = probe.status !== 404 && probe.status !== 501
  })

  test.afterAll(async () => {
    await ctx?.dispose()
  })

  test('DOC-E2E-AGG-001: $match + $group/$sum returns the exact total', async () => {
    test.skip(!aggReady, 'aggregation route (POST /search) is not wired on this control-plane')
    const res = await client.aggregateDocuments(COLLECTION, [
      { $match: { kind: 'agg' } },
      { $group: { _id: null, total: { $sum: '$n' } } },
    ])
    expect(res.status).toBe(200)
    const items = docItems(res.body)
    expect(items[0]?.total).toBe(15)
  })

  test('DOC-E2E-AGG-002: $group/$avg returns the exact average', async () => {
    test.skip(!aggReady, 'aggregation route (POST /search) is not wired on this control-plane')
    const res = await client.aggregateDocuments(COLLECTION, [
      { $match: { kind: 'agg' } },
      { $group: { _id: null, avg: { $avg: '$n' } } },
    ])
    expect(res.status).toBe(200)
    expect(docItems(res.body)[0]?.avg).toBe(3)
  })

  test('DOC-E2E-AGG-003: $sort + $limit returns a correctly ordered subset', async () => {
    test.skip(!aggReady, 'aggregation route (POST /search) is not wired on this control-plane')
    const res = await client.aggregateDocuments(COLLECTION, [
      { $match: { kind: 'agg' } },
      { $sort: { n: -1 } },
      { $limit: 3 },
    ])
    expect(res.status).toBe(200)
    const ns = docItems(res.body).map((d) => d.n)
    expect(ns.length).toBeLessThanOrEqual(3)
    expect(ns).toEqual([5, 4, 3])
  })

  test('DOC-E2E-AGG-004: $out stage is rejected by the adapter allowlist (400/403)', async () => {
    test.skip(!aggReady, 'aggregation route (POST /search) is not wired on this control-plane')
    const res = await client.aggregateDocuments(COLLECTION, [{ $match: { kind: 'agg' } }, { $out: 'agg_out_target' }])
    expect([400, 403]).toContain(res.status)
  })

  test('DOC-E2E-AGG-005: cross-DB $lookup is rejected (400, Location40321)', async () => {
    test.skip(!aggReady, 'aggregation route (POST /search) is not wired on this control-plane')
    const res = await client.aggregateDocuments(COLLECTION, [
      { $lookup: { from: { db: 'e2e_other_db', coll: 'other' }, localField: 'n', foreignField: 'n', as: 'joined' } },
    ])
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toMatch(/Location40321|cross-?database|different database/i)
  })
})
