/**
 * Black-box tests for cross-tenant event publication isolation (bind-event-publish-topic-to-tenant).
 *
 * Tests drive the public exported API of the event-gateway runtime only —
 * no internal knowledge assumed.
 *
 * bbx-events-cross-tenant-publish-01: topic owned by another tenant → 403 EVT_GATEWAY_FORBIDDEN
 * bbx-events-cross-tenant-publish-02: topic in another workspace (same tenant) → 403 EVT_GATEWAY_FORBIDDEN
 * bbx-events-cross-tenant-publish-03: same tenant + same workspace → 202 accepted
 * bbx-events-cross-tenant-publish-04: request body tenantId set to another tenant → 403 EVT_GATEWAY_FORBIDDEN
 * bbx-events-cross-tenant-publish-05: request body workspaceId mismatch → 403 EVT_GATEWAY_FORBIDDEN
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateEventPublicationRequest,
  buildEventGatewayPublishRequest,
  normalizeEventGatewayError
} from '../../packages/event-gateway/src/runtime.mjs';

// ---------------------------------------------------------------------------
// Shared fixtures — only the tenant/workspace alignment changes between cases
// ---------------------------------------------------------------------------

/** A context representing an authenticated caller in tenant-a, workspace ws-1. */
const CALLER_CONTEXT = {
  tenantId: 'tenant-a',
  workspaceId: 'ws-1',
  workspaceEnvironment: 'dev',
  planId: 'pln_01growth'
};

/** A valid topic owned by tenant-a / ws-1 with http_publish allowed. */
const OWN_TOPIC = {
  resourceId: 'res_topic_a_ws1',
  tenantId: 'tenant-a',
  workspaceId: 'ws-1',
  allowedTransports: ['http_publish', 'sse', 'websocket'],
  partitionStrategy: 'producer_key',
  partitionCount: 4,
  replayWindowHours: 24,
  partitionSelectionPolicy: 'caller_hint'
};

/** A topic owned by tenant-b — different tenant. */
const OTHER_TENANT_TOPIC = {
  resourceId: 'res_topic_b_ws2',
  tenantId: 'tenant-b',
  workspaceId: 'ws-2',
  allowedTransports: ['http_publish', 'sse', 'websocket'],
  partitionStrategy: 'producer_key',
  partitionCount: 4,
  replayWindowHours: 24,
  partitionSelectionPolicy: 'caller_hint'
};

/** A topic owned by tenant-a but workspace ws-2 — cross-workspace, same tenant. */
const CROSS_WS_TOPIC = {
  resourceId: 'res_topic_a_ws2',
  tenantId: 'tenant-a',
  workspaceId: 'ws-2',
  allowedTransports: ['http_publish', 'sse', 'websocket'],
  partitionStrategy: 'producer_key',
  partitionCount: 4,
  replayWindowHours: 24,
  partitionSelectionPolicy: 'caller_hint'
};

/** A valid publication request body aligned to tenant-a / ws-1. */
function validRequest(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'ws-1',
    channel: 'orders.placed',
    eventType: 'orders.placed',
    contentType: 'application/json',
    payloadEncoding: 'json',
    payload: { orderId: 'ord-001' },
    key: 'ord-001',
    ...overrides
  };
}

/** Assert the full public chain returns 403 EVT_GATEWAY_FORBIDDEN. */
function assertForbidden(result, label) {
  assert.equal(result.ok, false, `${label}: expected ok=false`);
  assert.ok(result.errorClass === 'authorization_error', `${label}: expected errorClass=authorization_error, got ${result.errorClass}`);
  const mapped = normalizeEventGatewayError({ errorClass: result.errorClass });
  assert.equal(mapped.status, 403, `${label}: expected HTTP 403`);
  assert.equal(mapped.code, 'EVT_GATEWAY_FORBIDDEN', `${label}: expected EVT_GATEWAY_FORBIDDEN`);
}

// ===========================================================================
// bbx-events-cross-tenant-publish-01: topic owned by another tenant → 403
// ===========================================================================
test('bbx-events-cross-tenant-publish-01: validateEventPublicationRequest rejects cross-tenant topic with authorization_error', () => {
  const result = validateEventPublicationRequest({
    context: CALLER_CONTEXT,
    topic: OTHER_TENANT_TOPIC,
    request: validRequest()
  });
  assert.equal(result.ok, false, 'expected ok=false for cross-tenant topic');
  assert.equal(result.errorClass, 'authorization_error', 'expected authorization_error for cross-tenant topic');
});

test('bbx-events-cross-tenant-publish-01: buildEventGatewayPublishRequest cross-tenant topic → 403 EVT_GATEWAY_FORBIDDEN', () => {
  const result = buildEventGatewayPublishRequest({
    context: CALLER_CONTEXT,
    topic: OTHER_TENANT_TOPIC,
    request: validRequest()
  });
  assertForbidden(result, 'cross-tenant topic');
});

// ===========================================================================
// bbx-events-cross-tenant-publish-02: cross-workspace same tenant → 403
// ===========================================================================
test('bbx-events-cross-tenant-publish-02: validateEventPublicationRequest rejects cross-workspace topic with authorization_error', () => {
  const result = validateEventPublicationRequest({
    context: CALLER_CONTEXT,
    topic: CROSS_WS_TOPIC,
    request: validRequest()
  });
  assert.equal(result.ok, false, 'expected ok=false for cross-workspace topic');
  assert.equal(result.errorClass, 'authorization_error', 'expected authorization_error for cross-workspace topic');
});

test('bbx-events-cross-tenant-publish-02: buildEventGatewayPublishRequest cross-workspace topic → 403 EVT_GATEWAY_FORBIDDEN', () => {
  const result = buildEventGatewayPublishRequest({
    context: CALLER_CONTEXT,
    topic: CROSS_WS_TOPIC,
    request: validRequest()
  });
  assertForbidden(result, 'cross-workspace topic');
});

// ===========================================================================
// bbx-events-cross-tenant-publish-03: same tenant + same workspace → 202
// ===========================================================================
test('bbx-events-cross-tenant-publish-03: validateEventPublicationRequest accepts own-tenant own-workspace topic', () => {
  const result = validateEventPublicationRequest({
    context: CALLER_CONTEXT,
    topic: OWN_TOPIC,
    request: validRequest()
  });
  assert.equal(result.ok, true, 'expected ok=true for own-tenant topic');
  assert.equal(result.violations.length, 0, 'expected no violations for own-tenant topic');
});

test('bbx-events-cross-tenant-publish-03: buildEventGatewayPublishRequest same-tenant same-workspace → ok=true (202 accepted)', () => {
  const result = buildEventGatewayPublishRequest({
    context: CALLER_CONTEXT,
    topic: OWN_TOPIC,
    request: validRequest()
  });
  assert.equal(result.ok, true, 'expected ok=true for own-tenant topic');
  // The built request must carry the caller tenant/workspace, not a spoofed one
  assert.equal(result.request.tenant_id, 'tenant-a', 'built request must carry caller tenant_id');
  assert.equal(result.request.workspace_id, 'ws-1', 'built request must carry caller workspace_id');
});

// ===========================================================================
// bbx-events-cross-tenant-publish-04: request body tenantId set to another tenant → 403
// ===========================================================================
test('bbx-events-cross-tenant-publish-04: validateEventPublicationRequest rejects request body with mismatched tenantId', () => {
  const result = validateEventPublicationRequest({
    context: CALLER_CONTEXT,
    topic: OWN_TOPIC,
    request: validRequest({ tenantId: 'tenant-b' })
  });
  assert.equal(result.ok, false, 'expected ok=false when request body tenantId mismatches context');
  assert.equal(result.errorClass, 'authorization_error', 'expected authorization_error for spoofed tenantId');
});

test('bbx-events-cross-tenant-publish-04: buildEventGatewayPublishRequest mismatched request body tenantId → 403 EVT_GATEWAY_FORBIDDEN', () => {
  const result = buildEventGatewayPublishRequest({
    context: CALLER_CONTEXT,
    topic: OWN_TOPIC,
    request: validRequest({ tenantId: 'tenant-b' })
  });
  assertForbidden(result, 'request body tenantId mismatch');
});

// ===========================================================================
// bbx-events-cross-tenant-publish-05: request body workspaceId mismatch → 403
// ===========================================================================
test('bbx-events-cross-tenant-publish-05: validateEventPublicationRequest rejects request body with mismatched workspaceId', () => {
  const result = validateEventPublicationRequest({
    context: CALLER_CONTEXT,
    topic: OWN_TOPIC,
    request: validRequest({ workspaceId: 'ws-99' })
  });
  assert.equal(result.ok, false, 'expected ok=false when request body workspaceId mismatches context');
  assert.equal(result.errorClass, 'authorization_error', 'expected authorization_error for spoofed workspaceId');
});

test('bbx-events-cross-tenant-publish-05: buildEventGatewayPublishRequest mismatched request body workspaceId → 403 EVT_GATEWAY_FORBIDDEN', () => {
  const result = buildEventGatewayPublishRequest({
    context: CALLER_CONTEXT,
    topic: OWN_TOPIC,
    request: validRequest({ workspaceId: 'ws-99' })
  });
  assertForbidden(result, 'request body workspaceId mismatch');
});
