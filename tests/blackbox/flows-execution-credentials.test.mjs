// bbx-flows-ten-cred
//
// Per-execution short-lived credential + workflow-ID helpers for change
// add-flows-tenancy-isolation-limits. Drives the PUBLIC exported helpers only (no infra):
//   - apps/control-plane-executor/src/runtime/execution-token.mjs  (mint / validate)
//   - apps/control-plane-executor/src/runtime/flow-executor.mjs     (buildWorkflowId / parseWorkflowId / sanitizeClientQuery)
//   - apps/workflow-worker/src/activities/execution-token.mjs (assertExecutionToken → non-retryable)
//
// Scenarios:
//   bbx-flows-ten-cred-01: workflow id is {tenantId}:{workspaceId}:{flowId}:{uuid}, server-generated
//   bbx-flows-ten-cred-02: parseWorkflowId round-trips and rejects malformed ids
//   bbx-flows-ten-cred-03: minted token carries exactly the execution tenant + workspace
//   bbx-flows-ten-cred-04: valid token validates against the matching tenant/workspace
//   bbx-flows-ten-cred-05: expired token → EXECUTION_TOKEN_EXPIRED
//   bbx-flows-ten-cred-06: cross-tenant token → EXECUTION_TOKEN_TENANT_MISMATCH
//   bbx-flows-ten-cred-07: forged/tampered token → EXECUTION_TOKEN_INVALID (signature fails)
//   bbx-flows-ten-cred-08: token expiry never outlasts the max run duration
//   bbx-flows-ten-cred-09: activity-side assertExecutionToken throws a NON-RETRYABLE failure
//   bbx-flows-ten-cred-10: sanitizeClientQuery strips tenantId/workspaceId clauses (fail-closed)
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkflowId, parseWorkflowId, sanitizeClientQuery } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import {
  mintExecutionToken,
  validateExecutionToken,
  DEFAULT_MAX_RUN_DURATION_MS,
  EXECUTION_TOKEN_EXPIRED,
  EXECUTION_TOKEN_TENANT_MISMATCH,
  EXECUTION_TOKEN_INVALID,
  EXECUTION_TOKEN_KEY_DERIVATION,
} from '../../apps/control-plane-executor/src/runtime/execution-token.mjs';
import { assertExecutionToken } from '../../apps/workflow-worker/src/activities/execution-token.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test('bbx-flows-ten-cred-01: workflow id is {tenant}:{workspace}:{flow}:{uuid}', () => {
  const id = buildWorkflowId('tenant_A', 'ws_A', 'flow_1');
  const parts = id.split(':');
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.slice(0, 3), ['tenant_A', 'ws_A', 'flow_1']);
  assert.match(parts[3], UUID_RE);
  // Two calls produce distinct run UUIDs.
  assert.notEqual(buildWorkflowId('tenant_A', 'ws_A', 'flow_1'), buildWorkflowId('tenant_A', 'ws_A', 'flow_1'));
});

test('bbx-flows-ten-cred-02: parseWorkflowId round-trips and rejects malformed ids', () => {
  const parsed = parseWorkflowId('tenant_A:ws_A:flow_1:abc-uuid');
  assert.deepEqual(parsed, { tenantId: 'tenant_A', workspaceId: 'ws_A', flowId: 'flow_1', runUuid: 'abc-uuid' });
  assert.equal(parseWorkflowId('garbage'), null);
  assert.equal(parseWorkflowId('a:b:c'), null);
  assert.equal(parseWorkflowId(42), null);
});

test('bbx-flows-ten-cred-03: minted token carries exactly the execution tenant + workspace', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A');
  const payload = await validateExecutionToken(token, 'tenant_A', 'ws_A');
  assert.equal(payload.tenantId, 'tenant_A');
  assert.equal(payload.workspaceId, 'ws_A');
  assert.equal(payload.keyDerivation, EXECUTION_TOKEN_KEY_DERIVATION);
  assert.ok(!JSON.stringify(payload).includes('tenant_B'));
});

test('bbx-flows-ten-cred-04: valid token validates against the matching identity', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A', 60_000, { now: 1000 });
  const payload = await validateExecutionToken(token, 'tenant_A', 'ws_A', { now: 2000 });
  assert.equal(payload.tenantId, 'tenant_A');
});

test('bbx-flows-ten-cred-05: expired token → EXECUTION_TOKEN_EXPIRED', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A', 1000, { now: 0 });
  await assert.rejects(
    () => validateExecutionToken(token, 'tenant_A', 'ws_A', { now: 5000 }),
    (err) => err.code === EXECUTION_TOKEN_EXPIRED,
  );
});

test('bbx-flows-ten-cred-06: cross-tenant token → EXECUTION_TOKEN_TENANT_MISMATCH', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A');
  await assert.rejects(
    () => validateExecutionToken(token, 'tenant_B', 'ws_A'),
    (err) => err.code === EXECUTION_TOKEN_TENANT_MISMATCH,
  );
  await assert.rejects(
    () => validateExecutionToken(token, 'tenant_A', 'ws_B'),
    (err) => err.code === EXECUTION_TOKEN_TENANT_MISMATCH,
  );
});

test('bbx-flows-ten-cred-07: tampered token → EXECUTION_TOKEN_INVALID (signature fails)', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A');
  // Tamper with the payload portion (claim tenant_B) but keep the original signature.
  const [, sig] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ tenantId: 'tenant_B', workspaceId: 'ws_A', expiresAt: Date.now() + 99999, jti: 'x' })).toString('base64url');
  const forged = `${forgedPayload}.${sig}`;
  await assert.rejects(
    () => validateExecutionToken(forged, 'tenant_B', 'ws_A'),
    (err) => err.code === EXECUTION_TOKEN_INVALID,
  );
  // A garbage token is also invalid (fail-closed, missing token).
  await assert.rejects(() => validateExecutionToken(undefined, 'tenant_A', 'ws_A'), (err) => err.code === EXECUTION_TOKEN_INVALID);
});

test('bbx-flows-ten-cred-08: token expiry never outlasts the max run duration', async () => {
  // Request a TTL far larger than the cap; the minted expiry is clamped to DEFAULT_MAX_RUN_DURATION_MS.
  const now = 1_000_000;
  const token = await mintExecutionToken('tenant_A', 'ws_A', DEFAULT_MAX_RUN_DURATION_MS * 10, { now });
  const payload = await validateExecutionToken(token, 'tenant_A', 'ws_A', { now });
  assert.ok(payload.expiresAt <= now + DEFAULT_MAX_RUN_DURATION_MS);
});

test('bbx-flows-ten-cred-08b: prior key-derivation tokens fail closed after the coordinated upgrade', async () => {
  const token = await mintExecutionToken('tenant_A', 'ws_A', 60_000, { now: 1000 });
  const [payload, signature] = token.split('.');
  const legacyPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  delete legacyPayload.keyDerivation;
  const legacyToken = `${Buffer.from(JSON.stringify(legacyPayload)).toString('base64url')}.${signature}`;

  await assert.rejects(
    () => validateExecutionToken(legacyToken, 'tenant_A', 'ws_A', { now: 2000 }),
    (err) => err.code === EXECUTION_TOKEN_INVALID && err.message.includes('key derivation')
  );
  assert.throws(
    () => assertExecutionToken(legacyToken, 'tenant_A', 'ws_A', { now: 2000 }),
    (err) => err.type === EXECUTION_TOKEN_INVALID && err.nonRetryable === true
  );
});

test('bbx-flows-ten-cred-09: activity-side assertExecutionToken throws a NON-RETRYABLE failure', async () => {
  const expired = await mintExecutionToken('tenant_A', 'ws_A', 1, { now: 0 });
  try {
    assertExecutionToken(expired, 'tenant_A', 'ws_A', { now: 10_000 });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, EXECUTION_TOKEN_EXPIRED);
    assert.equal(err.nonRetryable, true);
  }
  // Cross-tenant token also non-retryable.
  const good = await mintExecutionToken('tenant_A', 'ws_A');
  try {
    assertExecutionToken(good, 'tenant_B', 'ws_A');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.type, EXECUTION_TOKEN_TENANT_MISMATCH);
    assert.equal(err.nonRetryable, true);
  }
  // Valid token returns the payload (no throw).
  const payload = assertExecutionToken(good, 'tenant_A', 'ws_A');
  assert.equal(payload.tenantId, 'tenant_A');
});

test('bbx-flows-ten-cred-10: sanitizeClientQuery strips tenant/workspace clauses (fail-closed)', () => {
  assert.equal(sanitizeClientQuery("tenantId = 'tenant_B'"), '');
  assert.equal(sanitizeClientQuery("tenantId = 'tenant_B' OR workspaceId = 'ws_B'"), '');
  // A benign predicate survives; the tenant clause is dropped.
  const residue = sanitizeClientQuery("ExecutionStatus = 'Running' AND tenantId = 'tenant_B'");
  assert.match(residue, /ExecutionStatus = 'Running'/);
  assert.ok(!/tenantId/i.test(residue));
  // Empty / non-string → empty.
  assert.equal(sanitizeClientQuery(''), '');
  assert.equal(sanitizeClientQuery(undefined), '');
});
