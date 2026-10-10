// storage.get activity (change: add-flows-activity-catalog / #360).
//
// Reads an object from a workspace-scoped bucket via the `storageGetObject` route
//   GET /v1/storage/buckets/{bucketId}/objects/{objectKey}
// carrying the tenant-scoped credential. The JSON envelope contains base64 object bytes.
// A missing object → 404 → non-retryable OBJECT_NOT_FOUND.
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
  const url = `${base}${STORAGE_BASE}/${encodeURIComponent(params.bucketId)}/objects/${encodeURIComponent(params.objectKey)}`;

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

  let envelope;
  try {
    envelope = await res.json();
  } catch {
    throw toNonRetryable('UPSTREAM_ERROR', 'storage.get received an invalid object response');
  }
  if (typeof envelope?.contentBase64 !== 'string') {
    throw toNonRetryable('UPSTREAM_ERROR', 'storage.get received an invalid object response');
  }
  const contentType = typeof envelope.contentType === 'string' ? envelope.contentType : 'application/octet-stream';

  const output = { status: 'success', objectKey: params.objectKey, body: envelope.contentBase64, contentType };
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
