// storage.get activity (change: add-flows-activity-catalog / #360).
//
// Downloads an object from a workspace-scoped bucket via the `downloadStorageObject` route
//   GET /v1/storage/buckets/{resourceId}/objects/{objectKey}/download
// carrying the tenant-scoped credential. The body is returned base64-encoded in the output
// envelope. A missing object → 404 → non-retryable OBJECT_NOT_FOUND.
import { assertPayloadSize, MAX_OUTPUT_BYTES } from './limits.mjs';
import { toNonRetryable, toRetryable, isTransientNetworkError } from './errors.mjs';

const STORAGE_BASE = '/v1/storage/buckets';

/**
 * @param {{ params: object, tenant: object, credential?: object }} input
 *   params: { bucketId, objectKey }
 * @param {{ http?: Function, baseUrl?: string }} deps
 */
export async function storageGet(input, deps = {}) {
  assertPayloadSize(input, 'input');

  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  const credential = input.credential ?? {};
  if (!tenant.tenantId) throw toNonRetryable('UNAUTHENTICATED', 'storage.get requires a tenant context');
  if (!params.bucketId) throw toNonRetryable('VALIDATION_ERROR', 'storage.get requires bucketId');
  if (!params.objectKey) throw toNonRetryable('VALIDATION_ERROR', 'storage.get requires objectKey');

  const http = deps.http;
  if (typeof http !== 'function') throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'storage http client not wired');
  const base = (deps.baseUrl ?? credential.baseUrl ?? '').replace(/\/$/, '');
  const url = `${base}${STORAGE_BASE}/${encodeURIComponent(params.bucketId)}/objects/${encodeURIComponent(params.objectKey)}/download`;

  const headers = { ...(credential.apiKey ? { authorization: `Bearer ${credential.apiKey}` } : {}) };

  let res;
  try {
    res = await http(url, { method: 'GET', headers });
  } catch (err) {
    if (isTransientNetworkError(err)) throw toRetryable('UPSTREAM_UNAVAILABLE', err?.message ?? 'storage upstream unavailable');
    throw toNonRetryable('UPSTREAM_ERROR', err?.message ?? 'storage download failed');
  }

  const status = res.status ?? res.statusCode;
  if (status === 404) throw toNonRetryable('OBJECT_NOT_FOUND', 'storage.get object key does not exist');
  if (status === 403) throw toNonRetryable('FORBIDDEN', 'storage.get bucket does not belong to the executing workspace');
  if (status === 429 || status === 503) throw toRetryable('UPSTREAM_UNAVAILABLE', 'storage temporarily unavailable');
  if (typeof status === 'number' && status >= 400) throw toNonRetryable('UPSTREAM_ERROR', `storage.get failed with status ${status}`);

  const contentType = res.headers?.get?.('content-type') ?? res.headers?.['content-type'] ?? 'application/octet-stream';
  const arrayBuf = typeof res.arrayBuffer === 'function' ? await res.arrayBuffer() : res.body;
  const buf = Buffer.isBuffer(arrayBuf) ? arrayBuf : Buffer.from(arrayBuf ?? '');
  const bodyB64 = buf.toString('base64');

  const output = { status: 'success', objectKey: params.objectKey, body: bodyB64, contentType };
  assertPayloadSize(output, 'output', MAX_OUTPUT_BYTES);
  return output;
}

export const storageGetInputSchema = Object.freeze({
  $id: 'flows/activity/storage.get/input',
  type: 'object',
  required: ['bucketId', 'objectKey'],
  properties: {
    bucketId: { type: 'string' },
    objectKey: { type: 'string' },
  },
  additionalProperties: false,
});

export const storageGetOutputSchema = Object.freeze({
  $id: 'flows/activity/storage.get/output',
  type: 'object',
  required: ['status', 'objectKey', 'body'],
  properties: {
    status: { type: 'string', const: 'success' },
    objectKey: { type: 'string' },
    body: { type: 'string', description: 'base64-encoded object bytes' },
    contentType: { type: 'string' },
  },
  additionalProperties: false,
});
