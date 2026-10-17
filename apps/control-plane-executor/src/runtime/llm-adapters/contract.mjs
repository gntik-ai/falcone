// Shared pure provider adapter contract (add-compatible-provider-adapter-contract / #940).
export const ERROR_CODES = Object.freeze({
  LLM_PROVIDER_AUTH_FAILED: 424,
  LLM_PROVIDER_REQUEST_REJECTED: 424,
  LLM_PROVIDER_RATE_LIMITED: 429,
  LLM_PROVIDER_UNAVAILABLE: 503,
  LLM_PROVIDER_RESPONSE_INVALID: 502,
  LLM_PROVIDER_ERROR: 502,
});

export class AdapterError extends Error {
  constructor(code, retryAfterMs) {
    super(`LLM provider request failed (${code})`);
    Object.assign(this, { statusCode: ERROR_CODES[code], code, name: 'AdapterError', retryable: ERROR_CODES[code] !== 424,
      ...(retryAfterMs != null ? { retryAfterMs } : {}),
    });
  }
}

export function adapterError(code, retryAfterMs) {
  return new AdapterError(code, retryAfterMs);
}

export const REQUEST_FIELDS = Object.freeze(['model', 'messages', 'prompt', 'system', 'maxTokens', 'temperature', 'stream', 'responseFormat']);
export const COMPLETION_FIELDS = Object.freeze(['content', 'model', 'usage', 'finishReason']);
export const USAGE_FIELDS = Object.freeze(['promptTokens', 'completionTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']);
export const FINISH_REASONS = Object.freeze(['stop', 'length', 'content_filter', 'tool_calls', 'other']);
export const FRAME_FIELDS = Object.freeze({ delta: ['type', 'content'], usage: ['type', 'usage', 'model', 'finishReason'], error: ['type', 'code'] });

const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.trunc(Number(value)) : 0;
const nullableCount = value => value == null ? null : count(value);

// Also accepts camelCase from the existing backendFactory/local mock seam.
export function normalizeUsage(usage) {
  const promptTokens = count(usage?.promptTokens ?? usage?.prompt_tokens);
  const completionTokens = count(usage?.completionTokens ?? usage?.completion_tokens);
  return {
    promptTokens, completionTokens,
    totalTokens: count(usage?.totalTokens ?? usage?.total_tokens ?? promptTokens + completionTokens),
    cacheReadTokens: nullableCount(usage?.cacheReadTokens ?? usage?.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: nullableCount(usage?.cacheWriteTokens),
    reasoningTokens: nullableCount(usage?.reasoningTokens ?? usage?.completion_tokens_details?.reasoning_tokens),
  };
}

export function normalizeFinishReason(reason) {
  return reason == null ? null : FINISH_REASONS.includes(reason) ? reason : 'other';
}

function requireShape(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  }
}

function assertUsage(usage) {
  requireShape(usage, USAGE_FIELDS);
  for (const field of USAGE_FIELDS) {
    if (usage[field] === null && USAGE_FIELDS.indexOf(field) >= 3) continue;
    if (!Number.isInteger(usage[field]) || usage[field] < 0) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  }
}

function assertMetadata(value) {
  assertUsage(value.usage);
  if (typeof value.model !== 'string' || !(value.finishReason === null || FINISH_REASONS.includes(value.finishReason))) {
    throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  }
}

export function assertNormalizedCompletion(value) {
  requireShape(value, COMPLETION_FIELDS);
  assertMetadata(value);
  if (typeof value.content !== 'string') throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  return value;
}

export function assertNormalizedFrame(value) {
  requireShape(value, FRAME_FIELDS[value?.type] ?? []);
  if (value.type === 'usage') assertMetadata(value);
  else if (value.type === 'delta' && typeof value.content === 'string') return value;
  else if (value.type !== 'error' || !Object.hasOwn(ERROR_CODES, value.code)) throw adapterError('LLM_PROVIDER_RESPONSE_INVALID');
  return value;
}
