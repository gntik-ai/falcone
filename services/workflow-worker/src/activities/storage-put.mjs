// storage.put activity (change: add-flows-activity-catalog / #360).
//
// Uploads an object to a workspace-scoped bucket via the `uploadStorageObject` route
//   PUT /v1/storage/buckets/{resourceId}/objects/{objectKey}
// carrying the tenant-scoped credential. Storage has no importable executor module (it is
// served via the HTTP API / proxied), so this activity calls the platform over HTTP using
// an injected client. Workspace ownership is enforced by the platform against the
// credential's workspace: a cross-workspace bucket → 403 → non-retryable FORBIDDEN.
import { assertPayloadSize } from './limits.mjs';
import { toNonRetryable, toRetryable, isTransientNetworkError } from './errors.mjs';

const STORAGE_BASE = '/v1/storage/buckets';

/**
 * @param {{ params: object, tenant: object, credential?: object }} input
 *   params: { bucketId, objectKey, body (base64), contentType? }
 * @param {{ http?: Function, baseUrl?: string }} deps
 *   http(url, opts) — fetch-shaped; baseUrl — platform origin (default tenant credential's)
 */
export async function storagePut(input, deps = {}) {
  assertPayloadSize(input, 'input');

  const params = input.params ?? {};
  const tenant = input.tenant ?? {};
  const credential = input.credential ?? {};
  if (!tenant.tenantId) throw toNonRetryable('UNAUTHENTICATED', 'storage.put requires a tenant context');
  if (!params.bucketId) throw toNonRetryable('VALIDATION_ERROR', 'storage.put requires bucketId');
  if (!params.objectKey) throw toNonRetryable('VALIDATION_ERROR', 'storage.put requires objectKey');
  if (typeof params.body !== 'string') throw toNonRetryable('VALIDATION_ERROR', 'storage.put requires base64 body');

  const http = deps.http;
  if (typeof http !== 'function') throw toNonRetryable('CAPABILITY_UNAVAILABLE', 'storage http client not wired');
  const base = (deps.baseUrl ?? credential.baseUrl ?? '').replace(/\/$/, '');
  const url = `${base}${STORAGE_BASE}/${encodeURIComponent(params.bucketId)}/objects/${encodeURIComponent(params.objectKey)}`;

  // NEVER forward the credential to a third party — but here the target IS the platform,
  // so the tenant-scoped flc_service_ key authenticates the upload.
  const headers = {
    'content-type': params.contentType ?? 'application/octet-stream',
    ...(credential.apiKey ? { authorization: `Bearer ${credential.apiKey}` } : {}),
  };

  let res;
  try {
    res = await http(url, { method: 'PUT', headers, body: Buffer.from(params.body, 'base64') });
  } catch (err) {
    if (isTransientNetworkError(err)) throw toRetryable('UPSTREAM_UNAVAILABLE', err?.message ?? 'storage upstream unavailable');
    throw toNonRetryable('UPSTREAM_ERROR', err?.message ?? 'storage upload failed');
  }

  const status = res.status ?? res.statusCode;
  if (status === 403) throw toNonRetryable('FORBIDDEN', 'storage.put bucket does not belong to the executing workspace');
  if (status === 404) throw toNonRetryable('OBJECT_NOT_FOUND', 'storage.put bucket not found');
  if (status === 429 || status === 503) throw toRetryable('UPSTREAM_UNAVAILABLE', 'storage temporarily unavailable');
  if (typeof status === 'number' && status >= 400) throw toNonRetryable('UPSTREAM_ERROR', `storage.put failed with status ${status}`);

  let etag = res.headers?.get?.('etag') ?? res.headers?.etag;
  let bodyJson;
  if (typeof res.json === 'function') {
    try { bodyJson = await res.json(); } catch { /* empty body ok */ }
  }
  if (!etag && bodyJson?.etag) etag = bodyJson.etag;

  const output = { status: 'success', objectKey: params.objectKey, etag: etag ?? null };
  assertPayloadSize(output, 'output');
  return output;
}

export const storagePutInputSchema = Object.freeze({
  $id: 'flows/activity/storage.put/input',
  type: 'object',
  required: ['bucketId', 'objectKey', 'body'],
  properties: {
    bucketId: { type: 'string' },
    objectKey: { type: 'string' },
    body: { type: 'string', description: 'base64-encoded object bytes' },
    contentType: { type: 'string' },
  },
  additionalProperties: false,
});

export const storagePutOutputSchema = Object.freeze({
  $id: 'flows/activity/storage.put/output',
  type: 'object',
  required: ['status', 'objectKey'],
  properties: {
    status: { type: 'string', const: 'success' },
    objectKey: { type: 'string' },
    etag: { type: ['string', 'null'] },
  },
  additionalProperties: false,
});
