/**
 * Storage E2E — Scenario STO-E2E-005: Object metadata (change: add-seaweedfs-storage-e2e).
 *
 * User story: us-storage-05 — As a developer I want to fetch metadata for a specific object
 * in my bucket so that I can inspect its content-type, ETag, and size.
 *
 * Acceptance criteria exercised:
 *   - A bucket is provisioned and a minimal object is uploaded (SigV4 PUT) to SeaweedFS in beforeAll.
 *   - GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata returns 200.
 *   - The response body includes `objectKey`, `contentType`, and `etag`.
 *
 * Upload strategy: the objectKey is placed directly via a SigV4-signed PUT to the SeaweedFS S3
 * gateway. The gateway address is read from E2E_S3_ENDPOINT (default http://localhost:8333), which
 * callers set when port-forwarding the SeaweedFS S3 service. If the direct endpoint is unreachable,
 * the object-upload step is skipped with a clear reason rather than failing the suite.
 *
 * fn coverage: fn-storage-object-metadata, fn-storage-provision-bucket
 * Linked: STO-E2E-005, add-seaweedfs-storage-e2e
 *
 * LIVE GATE: skips when storage API or SeaweedFS backend is not running.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import * as crypto from 'crypto'
import { TENANT_A, controlPlaneBaseUrl, bucketName } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient, StorageApiClient } from '../../helpers/storage/storage-api-client'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'
import { mintTenantToken } from '../../helpers/storage/storage-auth'

// SeaweedFS S3 gateway — reachable from the test host only when port-forwarded.
// Set E2E_S3_ENDPOINT + E2E_S3_ACCESS_KEY + E2E_S3_SECRET_KEY when running on kind.
const S3_ENDPOINT = (process.env.E2E_S3_ENDPOINT ?? 'http://localhost:8333').replace(/\/+$/, '')
const S3_ACCESS = process.env.E2E_S3_ACCESS_KEY ?? ''
const S3_SECRET = process.env.E2E_S3_SECRET_KEY ?? ''
const S3_REGION = process.env.E2E_S3_REGION ?? 'us-east-1'

const EMPTY_SHA = crypto.createHash('sha256').update('').digest('hex')

function sha256hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmacBuf(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function awsEnc(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/**
 * Minimal SigV4-signed PUT to the SeaweedFS S3 gateway.
 * Mirrors the s3() signer in deploy/kind/control-plane/storage-handlers.mjs.
 */
async function s3Put(bucket: string, key: string, body: string, contentType = 'text/plain'): Promise<number> {
  const url = new URL(S3_ENDPOINT)
  const host = url.host
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256hex(body)
  const path = `/${bucket}/${key}`
  const canonicalUri = path.split('/').map((seg, i) => (i === 0 ? seg : awsEnc(seg))).join('/')

  const hdrs: Record<string, string> = {
    host,
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const signedHeaders = Object.keys(hdrs).sort().join(';')
  const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join('')
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')

  const scope = `${dateStamp}/${S3_REGION}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n')
  const kDate = hmacBuf('AWS4' + S3_SECRET, dateStamp)
  const kRegion = hmacBuf(kDate, S3_REGION)
  const kService = hmacBuf(kRegion, 's3')
  const signingKey = hmacBuf(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`${S3_ENDPOINT}${canonicalUri}`, {
    method: 'PUT',
    headers: { ...hdrs, authorization },
    body,
  })
  return res.status
}

/** Check whether the S3 endpoint is reachable from the test host. */
async function probeS3Direct(): Promise<boolean> {
  if (!S3_ACCESS || !S3_SECRET) return false
  try {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const host = new URL(S3_ENDPOINT).host
    const hdrs: Record<string, string> = {
      host,
      'x-amz-content-sha256': EMPTY_SHA,
      'x-amz-date': amzDate,
    }
    const signedHeaders = Object.keys(hdrs).sort().join(';')
    const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join('')
    const canonicalRequest = ['GET', '/', '', canonicalHeaders, signedHeaders, EMPTY_SHA].join('\n')
    const scope = `${dateStamp}/${S3_REGION}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n')
    const kDate = hmacBuf('AWS4' + S3_SECRET, dateStamp)
    const kRegion = hmacBuf(kDate, S3_REGION)
    const kService = hmacBuf(kRegion, 's3')
    const signingKey = hmacBuf(kService, 'aws4_request')
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const authorization = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    const res = await fetch(`${S3_ENDPOINT}/`, {
      signal: AbortSignal.timeout(4000),
      headers: { ...hdrs, authorization },
    })
    return res.status < 500
  } catch {
    return false
  }
}

test.describe('storage: object metadata', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: StorageApiClient
  let bucketId: string | undefined
  let objectUploaded = false
  const cpBase = controlPlaneBaseUrl()
  const BUCKET = bucketName('obj-meta-005')
  const OBJECT_KEY = 'e2e-test-object.txt'
  const OBJECT_BODY = 'hello from falcone e2e storage test'
  const OBJECT_CONTENT_TYPE = 'text/plain'

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const token = await mintTenantToken(ctx, TENANT_A)
    const gate = await probeStorageApi(ctx, cpBase, TENANT_A, token)
    test.skip(!gate.available, gate.reason || STORAGE_GATE_REASON)
    client = createStorageApiClient(ctx, cpBase, TENANT_A, token)

    // Provision bucket.
    const provision = await client.provisionBucket(TENANT_A.workspaceId, BUCKET)
    if (provision.status === 201 || provision.status === 200) {
      bucketId = provision.body.bucket?.resourceId ?? provision.body.bucket?.bucketName
    }
    if (!bucketId) bucketId = BUCKET

    // Upload object via direct SigV4 PUT to the SeaweedFS S3 gateway.
    // This is only possible when the S3 endpoint is port-forwarded to the test host
    // (E2E_S3_ENDPOINT + credentials set). If unreachable, the metadata test skips.
    const s3Reachable = await probeS3Direct()
    if (s3Reachable && bucketId) {
      try {
        const putStatus = await s3Put(bucketId, OBJECT_KEY, OBJECT_BODY, OBJECT_CONTENT_TYPE)
        objectUploaded = putStatus >= 200 && putStatus < 300
      } catch {
        objectUploaded = false
      }
    }
  })

  test.afterAll(async () => {
    // No object/bucket delete route wired — namespace teardown handles cleanup.
    await ctx?.dispose()
  })

  test('sto-e2e-005: GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata returns 200', async () => {
    test.skip(!bucketId, 'bucket provisioning failed in beforeAll')
    test.skip(
      !objectUploaded,
      'Object upload via direct SigV4 PUT to SeaweedFS S3 gateway was skipped — ' +
        'set E2E_S3_ENDPOINT, E2E_S3_ACCESS_KEY, and E2E_S3_SECRET_KEY and port-forward ' +
        'svc/<release>-seaweedfs-s3:8333:8333 to enable the direct-upload path.',
    )

    const res = await client.getObjectMetadata(bucketId!, OBJECT_KEY)
    expect(res.status).toBe(200)
    // Verified against storage-handlers.mjs storageObjectMetadata ok(...) shape.
    expect(res.body.objectKey).toBe(OBJECT_KEY)
    expect(typeof res.body.contentType).toBe('string')
    expect(typeof res.body.etag).toBe('string')
    expect(typeof res.body.sizeBytes).toBe('number')
  })
})
