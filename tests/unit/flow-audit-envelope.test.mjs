import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowAuditEvent, FLOW_AUDIT_EVENT_TYPES } from '../../packages/audit/src/flow-lifecycle-events.mjs';

test('Flow audit envelope has durable delivery and request correlation fields', () => {
  const event = buildFlowAuditEvent({ eventType: FLOW_AUDIT_EVENT_TYPES.VERSION_PUBLISHED,
    tenantId: 'tenant', workspaceId: 'workspace', actorId: 'actor', flowId: 'flow', flowVersion: 2,
    correlationId: 'request-123' });
  assert.match(event.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(event.outcome, 'succeeded');
  assert.equal(event.correlationId, 'request-123');
  assert.equal(event.flowVersion, '2');
  for (const required of ['tenantId', 'workspaceId', 'actorId', 'flowId', 'eventId', 'outcome', 'correlationId']) {
    assert.throws(() => buildFlowAuditEvent({ ...event, [required]: null }), new RegExp(required));
  }
});
