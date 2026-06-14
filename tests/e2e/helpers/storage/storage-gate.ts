/**
 * Storage API live-gate helper (change: add-seaweedfs-storage-e2e).
 *
 * `probeStorageApi` sends a GET /v1/storage/buckets request and returns
 * { available: boolean, reason: string } so each spec's beforeAll can call
 * `test.skip(!gate.available, gate.reason)` instead of failing.
 *
 * Mirrors the `probeMcpManagement` pattern in tests/e2e/helpers/mcp/mcp-api-client.ts.
 *
 * These specs authenticate ONLY via gateway-bypass identity headers (x-tenant-id, …),
 * which only an e2e-profile control-plane that TRUSTS those headers honours. The
 * standard control-plane build verifies a Bearer JWT and returns 401 for header-only
 * requests, so 200 is the only "available" signal here: a 401/403 means the target is
 * a JWT-enforcing (non-e2e) control-plane these header-only specs cannot exercise, and
 * 404/501 means the routes are unwired — all of these skip gracefully rather than fail.
 * A network error (no stack) skips too.
 */

import type { APIRequestContext } from '@playwright/test'
import type { TenantIdentity } from './storage-api-client'
import { createStorageApiClient } from './storage-api-client'

export interface StorageGateResult {
  available: boolean
  reason: string
}

export async function probeStorageApi(
  request: APIRequestContext,
  baseUrl: string,
  identity: TenantIdentity,
): Promise<StorageGateResult> {
  try {
    const client = createStorageApiClient(request, baseUrl, identity)
    const res = await client.listBuckets()
    if (res.status === 200) {
      return { available: true, reason: '' }
    }
    const why =
      res.status === 401 || res.status === 403
        ? 'the target control-plane enforces a Bearer JWT and does not trust the gateway-bypass identity headers these specs use (not an e2e-profile control-plane)'
        : 'the storage routes are not wired in the live control-plane or the SeaweedFS backend is not reachable'
    return {
      available: false,
      reason:
        `Storage API GET /v1/storage/buckets returned HTTP ${res.status} — ${why}. ` +
        'Run against an e2e-profile control-plane with E2E_STORAGE_BACKEND=seaweedfs to exercise the full suite.',
    }
  } catch {
    return {
      available: false,
      reason:
        'Storage API is unreachable (connection refused or no live stack at ' +
        baseUrl +
        '). Start the stack with `bash tests/e2e/stack.sh up` before running the storage E2E suite.',
    }
  }
}

export const STORAGE_GATE_REASON =
  'Storage API (/v1/storage/buckets) is not served by the live control-plane or the SeaweedFS ' +
  'backend is not running. Specs skip gracefully here and execute the full loop when ' +
  'E2E_STORAGE_BACKEND=seaweedfs is set and the kind cluster has the SeaweedFS stack running.'
