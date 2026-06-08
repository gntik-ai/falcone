import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const docPath = 'docs/reference/architecture/gateway-realtime-and-event-gateway.md';

// Documentation is intentionally absent in the code-only audit baseline; this
// doc-content check only runs when the architecture doc is present.
test('gateway realtime architecture doc preserves runtime contracts, metrics, and operator guidance', { skip: !existsSync(docPath) }, () => {
  const markdown = readFileSync(docPath, 'utf8');

  assert.ok(markdown.includes('/apisix/prometheus/metrics'));
  assert.ok(markdown.includes('/v1/events/topics'));
  assert.ok(markdown.includes('/v1/events/topics/{resourceId}/access'));
  assert.ok(markdown.includes('/v1/events/topics/{resourceId}/metadata'));
  assert.ok(markdown.includes('/v1/events/workspaces/{workspaceId}/inventory'));
  assert.ok(markdown.includes('/v1/events/workspaces/{workspaceId}/bridges'));
  assert.ok(markdown.includes('/v1/events/topics/{resourceId}/publish'));
  assert.ok(markdown.includes('/v1/events/topics/{resourceId}/stream'));
  assert.ok(markdown.includes('/v1/functions/actions/{resourceId}/kafka-triggers'));
  assert.ok(markdown.includes('/v1/metrics/workspaces/{workspaceId}/event-dashboards'));
  assert.ok(markdown.includes('/v1/websockets/sessions'));
  assert.ok(markdown.includes('notification queues'));
  assert.ok(markdown.includes('base64'));
  assert.ok(markdown.includes('controlled replay'));
  assert.ok(markdown.includes('relative order'));
  assert.ok(markdown.includes('KRaft-only guidance'));
  assert.ok(markdown.includes('Kafka-triggered OpenWhisk execution'));
  assert.ok(markdown.includes('US-EVT-03'));
  assert.ok(markdown.includes('Do not connect directly to Kafka'));
});
