// Public error classification for fix-1013: raw driver codes stay server-side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientError, mapPgError, publicErrorCode } from '../../apps/control-plane-executor/src/runtime/errors.mjs';

const FALLBACK = 'CONTROL_PLANE_ERROR';

test('publicErrorCode falls back unless both status and code classify the error', () => {
  for (const error of [
    undefined, null, {},
    { code: '22023' }, { code: 'ECONNREFUSED' }, { code: 'ETIMEDOUT' },
    { statusCode: 500, code: '57P01' },
    { statusCode: 500, code: 'internal_error' },
    { statusCode: 500, code: 'DB-UNAVAILABLE' },
    { statusCode: 500, code: 22023 },
    { statusCode: 503 },
    { statusCode: '503', code: 'DB_UNAVAILABLE' },
    { statusCode: 503.5, code: 'DB_UNAVAILABLE' },
    { statusCode: NaN, code: 'DB_UNAVAILABLE' },
  ]) {
    assert.equal(publicErrorCode(error, FALLBACK), FALLBACK, JSON.stringify(error));
  }
});

test('publicErrorCode preserves classified platform codes and uses the supplied fallback', () => {
  for (const error of [
    clientError('Database unavailable', 503, 'DB_UNAVAILABLE'),
    mapPgError({ code: 'XX000' }),
    mapPgError({ code: '23505' }),
    clientError('Quota exceeded', 429, 'QUOTA_EXCEEDED'),
    clientError('Provider failed', 502, 'LLM_PROVIDER_ERROR'),
  ]) {
    assert.equal(publicErrorCode(error, FALLBACK), error.code);
  }
  assert.equal(publicErrorCode({ code: 'ECONNREFUSED' }, 'FLOW_MONITORING_ERROR'), 'FLOW_MONITORING_ERROR');
});

// The rule is structural, not a vocabulary or errno denylist. A library that supplies
// BOTH an integer status and an upper-snake code meets the same classification rule.
test('publicErrorCode applies the classification rule even to a library-shaped code', () => {
  assert.equal(publicErrorCode({ statusCode: 500, code: 'ECONNRESET' }, FALLBACK), 'ECONNRESET');
});
