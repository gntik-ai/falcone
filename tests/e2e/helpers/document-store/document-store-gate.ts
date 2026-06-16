// Live-gate for the document-store E2E suite (change add-ferretdb-document-store-e2e, #464,
// task 1.3). Mirrors tests/e2e/helpers/storage/storage-gate.ts and the live-gate pattern in
// tests/e2e/specs/mcp/mcp-cross-tenant.spec.ts. Probes GET /v1/collections/{collection}/documents
// and returns { available, reason } so a `test.beforeAll` can `test.skip(!available, reason)`
// when the stack is not running, the routes are not wired, or the build is not e2e-profile.
import type { APIRequestContext } from '@playwright/test'

import { createDocumentApiClient, TenantIdentity } from './document-store-api-client'

export interface DocumentGateResult {
  available: boolean
  reason: string
}

export const DOCUMENT_GATE_REASON =
  'document-store API is not available (start `bash tests/e2e/stack.sh up` with E2E_FERRETDB=true and an e2e-profile control-plane)'

export async function probeDocumentApi(
  request: APIRequestContext,
  baseUrl: string,
  identity: TenantIdentity,
  collection = 'e2e-probe',
): Promise<DocumentGateResult> {
  try {
    const client = createDocumentApiClient(request, baseUrl, identity)
    const res = await client.listDocuments(collection)
    if (res.status === 200) {
      return { available: true, reason: '' }
    }
    let why: string
    if (res.status === 404 || res.status === 501) {
      why = 'the document-store routes are not wired in the live control-plane (or the FerretDB backend is not deployed)'
    } else if (res.status === 401 || res.status === 403) {
      why =
        'the target control-plane enforces a Bearer JWT and does not trust the gateway-bypass identity headers these specs use (not an e2e-profile control-plane)'
    } else {
      why = 'the document-store API returned an unexpected status'
    }
    return {
      available: false,
      reason:
        `Document-store API GET /v1/collections/${collection}/documents returned HTTP ${res.status} — ${why}. ` +
        'Run against an e2e-profile control-plane with E2E_FERRETDB=true to exercise the full suite.',
    }
  } catch {
    return {
      available: false,
      reason:
        `Document-store API is unreachable (connection refused or no live stack at ${baseUrl}). ` +
        'Start the stack with `bash tests/e2e/stack.sh up` before running the document-store E2E suite.',
    }
  }
}
