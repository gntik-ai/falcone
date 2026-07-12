// http.request activity (change: add-flows-activity-catalog / #360).
//
// Outbound HTTP/HTTPS to caller-supplied URLs with an SSRF guard at PARITY with the webhook
// engine (resolveSsrfSafe → isBlockedIp + DNS-rebinding re-check + IP pinning). Enforces a
// timeout (default 10s, max 30s) and a response-body size cap (default 1 MiB, max 10 MiB).
// NEVER forwards a tenant credential or internal header to the external target.
//
// Classification (D6):
//   SSRF blocked           → non-retryable SSRF_BLOCKED   (no socket opened)
//   timeout                → retryable     REQUEST_TIMEOUT
//   body over cap          → non-retryable RESPONSE_TOO_LARGE (download aborted)
//   network/transport      → retryable     UPSTREAM_UNAVAILABLE
import { assertPayloadSize, MAX_OUTPUT_BYTES } from './limits.mjs';
import { toNonRetryable, toRetryable, isTransientNetworkError } from './errors.mjs';
import { resolveSsrfSafe } from './ssrf.mjs';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_BODY_CAP = 1 * 1024 * 1024;
const MAX_BODY_CAP = 10 * 1024 * 1024;

// Headers an activity must never forward outward (defense-in-depth; activities do not set
// these by default but a hostile DSL must not be able to leak them either).
const FORBIDDEN_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'x-falcone-internal']);

function clampTimeout(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(ms, MAX_TIMEOUT_MS);
}
function clampBodyCap(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return DEFAULT_BODY_CAP;
  return Math.min(bytes, MAX_BODY_CAP);
}

function sanitizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/**
 * @param {{ params: object, tenant?: object }} input
 *   params: { url, method?, headers?, body?, timeoutMs?, maxResponseBytes? }
 * @param {{ http?: Function, resolver?: Function, dispatcherFactory?: Function }} deps
 */
export async function httpRequest(input, deps = {}) {
  assertPayloadSize(input, 'input');

  const params = input.params ?? {};
  if (!params.url) throw toNonRetryable('VALIDATION_ERROR', 'http.request requires a url');
  const method = (params.method ?? 'GET').toUpperCase();
  const timeoutMs = clampTimeout(params.timeoutMs);
  const bodyCap = clampBodyCap(params.maxResponseBytes);

  // SSRF guard FIRST — throws non-retryable SSRF_BLOCKED before any socket activity.
  const pin = await resolveSsrfSafe(params.url, { resolver: deps.resolver });

  const http = deps.http ?? fetch;
  // Pin the connection to the validated IP (TOCTOU defense); the default factory builds a
  // pinned undici dispatcher (mirrors webhook-delivery-worker). Tests inject a fake factory.
  let dispatcher;
  if (typeof deps.dispatcherFactory === 'function') {
    dispatcher = await deps.dispatcherFactory({ address: pin.pinnedAddress, family: pin.family });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await http(params.url, {
      method,
      headers: sanitizeHeaders(params.headers),
      body: params.body !== undefined && method !== 'GET' && method !== 'HEAD' ? params.body : undefined,
      redirect: 'manual', // do not auto-follow → a redirect can't bypass the guard
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
      throw toRetryable('REQUEST_TIMEOUT', `http.request to ${pin.hostname} timed out after ${timeoutMs}ms`);
    }
    if (isTransientNetworkError(err)) throw toRetryable('UPSTREAM_UNAVAILABLE', err?.message ?? 'http.request transport error');
    throw toNonRetryable('UPSTREAM_ERROR', err?.message ?? 'http.request failed');
  }
  clearTimeout(timer);

  const httpStatus = res.status ?? res.statusCode;

  // Stream-read with a hard byte cap; abort the moment the cap is exceeded.
  let body = '';
  try {
    body = await readCappedBody(res, bodyCap);
  } catch (err) {
    if (err?.code === 'RESPONSE_TOO_LARGE') {
      throw toNonRetryable('RESPONSE_TOO_LARGE', `http.request response exceeded the ${bodyCap}-byte cap`);
    }
    throw toRetryable('UPSTREAM_UNAVAILABLE', err?.message ?? 'http.request body read failed');
  }

  const headers = {};
  if (typeof res.headers?.forEach === 'function') {
    res.headers.forEach((v, k) => { headers[k] = v; });
  } else if (res.headers && typeof res.headers === 'object') {
    Object.assign(headers, res.headers);
  }

  const output = { status: 'success', httpStatus, body, headers };
  assertPayloadSize(output, 'output', MAX_OUTPUT_BYTES);
  return output;
}

/**
 * Read a fetch-style response body, enforcing a hard byte cap mid-stream. When the cap is
 * exceeded the read is aborted (the underlying stream is cancelled) and a tagged error is
 * thrown so the caller can map it to RESPONSE_TOO_LARGE.
 */
async function readCappedBody(res, cap) {
  // Prefer a content-length short-circuit when present and oversized.
  const len = Number(res.headers?.get?.('content-length') ?? res.headers?.['content-length']);
  if (Number.isFinite(len) && len > cap) {
    if (typeof res.body?.cancel === 'function') await res.body.cancel().catch(() => {});
    throw Object.assign(new Error('response too large'), { code: 'RESPONSE_TOO_LARGE' });
  }

  const reader = res.body?.getReader?.();
  if (reader) {
    const chunks = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error('response too large'), { code: 'RESPONSE_TOO_LARGE' });
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  // Fallback: no streaming reader (test doubles). Buffer the text and cap after the fact.
  const text = typeof res.text === 'function' ? await res.text() : String(res.body ?? '');
  if (Buffer.byteLength(text, 'utf8') > cap) {
    throw Object.assign(new Error('response too large'), { code: 'RESPONSE_TOO_LARGE' });
  }
  return text;
}

export const httpRequestInputSchema = Object.freeze({
  $id: 'flows/activity/http.request/input',
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri' },
    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] },
    headers: { type: 'object' },
    body: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1, maximum: MAX_TIMEOUT_MS },
    maxResponseBytes: { type: 'integer', minimum: 1, maximum: MAX_BODY_CAP },
  },
  additionalProperties: false,
});

export const httpRequestOutputSchema = Object.freeze({
  $id: 'flows/activity/http.request/output',
  type: 'object',
  required: ['status', 'httpStatus'],
  properties: {
    status: { type: 'string', const: 'success' },
    httpStatus: { type: 'integer' },
    body: { type: 'string' },
    headers: { type: 'object' },
  },
  additionalProperties: false,
});
