// Retryable / non-retryable error helpers for the activity catalog (change:
// add-flows-activity-catalog / #360).
//
// Activities classify every failure as retryable or non-retryable and propagate the
// classification via Temporal `ApplicationFailure.nonRetryable`. The Temporal retry policy
// (DSL retryPolicy semantics) then skips retries on deterministic failures that cannot
// self-heal (auth/schema/SSRF/PAYLOAD_TOO_LARGE) and retries transient ones
// (network/timeout/503/429/broker-unavailable).
//
// `@temporalio/activity` is a CommonJS package; the named import works from this ESM
// module via Node's CJS interop.
import { ApplicationFailure } from '@temporalio/activity';

/**
 * Build a NON-retryable Temporal failure. `code` becomes `ApplicationFailure.type`
 * (the stable error code the workflow/interpreter and retry policy match on).
 */
export function toNonRetryable(code, message) {
  return ApplicationFailure.nonRetryable(message ?? code, code);
}

/**
 * Build a RETRYABLE Temporal failure (the Temporal retry policy will re-attempt it
 * according to the workflow's configured backoff).
 */
export function toRetryable(code, message) {
  return ApplicationFailure.retryable(message ?? code, code);
}

/**
 * True when an error is a Node/undici/network transport failure (connection refused,
 * reset, DNS, timeout at the socket layer) — i.e. transient and worth retrying.
 */
export function isTransientNetworkError(err) {
  const code = err?.code ?? err?.cause?.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    code === 'EPIPE' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET'
  );
}

/**
 * Map a platform-executor error (carries `.statusCode` + `.code` via control-plane
 * `clientError`) to a Temporal ApplicationFailure using the D6 classification table.
 *
 * Retryable: network/transport errors, HTTP 429, HTTP 503, 5xx with no client code.
 * Non-retryable: every other 4xx, schema errors, auth errors, and explicit codes.
 *
 * @param {Error & { statusCode?: number, code?: string }} err
 * @param {Record<string,string>} [codeOverrides] map executor `.code` → activity error code
 */
export function classifyExecutorError(err, codeOverrides = {}) {
  if (isTransientNetworkError(err)) {
    return toRetryable('UPSTREAM_UNAVAILABLE', err?.message ?? 'upstream unavailable');
  }
  const status = err?.statusCode;
  const code = err?.code;
  const mapped = code && codeOverrides[code] ? codeOverrides[code] : code;

  // Transient HTTP statuses are retryable regardless of the executor code.
  if (status === 429 || status === 503 || status === 502 || status === 504) {
    return toRetryable(mapped ?? 'UPSTREAM_UNAVAILABLE', err?.message ?? 'upstream temporarily unavailable');
  }
  // Any other 4xx (auth, schema, not-found, validation) is deterministic → non-retryable.
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return toNonRetryable(mapped ?? 'CLIENT_ERROR', err?.message ?? 'client error');
  }
  // 5xx (other than the transient set above) without a network signal: treat as
  // non-retryable by default — a deterministic server bug should not loop forever.
  // Callers that know better pass an explicit classification before reaching here.
  return toNonRetryable(mapped ?? 'UPSTREAM_ERROR', err?.message ?? 'upstream error');
}
