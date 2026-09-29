// bbx-flows-ten-audit
//
// Flow lifecycle audit emission for change add-flows-tenancy-isolation-limits. Drives the PUBLIC
// flows HTTP surface with an INJECTED in-memory audit sink and asserts that each of the eight
// lifecycle actions emits a tenant-scoped flow_lifecycle_event carrying tenantId/workspaceId/
// actorId/occurredAt (non-null) and, where applicable, flowId/flowVersion.
//
// Scenarios:
//   bbx-flows-ten-audit-01: create/update/publish/delete emit the four definition events
//   bbx-flows-ten-audit-02: execution start/cancel/retry/signal emit the four execution events
//   bbx-flows-ten-audit-03: every emitted event carries tenantId, workspaceId, actorId, occurredAt
//   bbx-flows-ten-audit-04: publish event carries the correct flowVersion + tenant context
//   bbx-flows-ten-audit-05: a B-emitted event never carries tenant A identifiers (per-tenant scope)
//   bbx-flows-ten-audit-06: the contract entry registers exactly the eight event types
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { FLOW_AUDIT_EVENT_TYPES, buildFlowAuditEvent } from '../../packages/audit/src/flow-lifecycle-events.mjs';
import { flowLifecycleEvent } from '../../packages/audit/src/contract-boundary.mjs';

const DEF = { apiVersion: 'v1.0', name: 'f', nodes: [{ id: 'a', type: 'approval', next: 'b' }, { id: 'b', type: 'task', taskType: 't' }] };
const headersFor = (t, w) => ({ 'content-type': 'application/json', 'x-tenant-id': t, 'x-workspace-id': w, 'x-auth-subject': `admin-${t}`, 'x-actor-roles': 'tenant_admin' });
const A = headersFor('tenant_A', 'ws_A');
const B = headersFor('tenant_B', 'ws_B');

function makeFakeTemporal() {
  const handles = new Map();
  const h = (id, sa) => ({ workflowId: id, firstExecutionRunId: `run-${id.slice(-4)}`, _sa: sa ?? { flowVersion: ['1'] }, _status: 'Running',
    async describe() { return { status: { name: this._status }, searchAttributes: this._sa, startTime: 't', closeTime: null }; },
    async fetchHistory() { return { events: [] }; }, async cancel() {}, async signal() {} });
  return { workflow: {
    async start(type, opts) { const x = h(opts.workflowId, opts.searchAttributes); handles.set(opts.workflowId, x); return x; },
    getHandle(id) { return handles.get(id) ?? h(id); },
    async *list() { for (const x of handles.values()) yield { workflowId: x.workflowId, runId: x.firstExecutionRunId, status: { name: x._status } }; },
  } };
}

async function withServer(fn, { auditSink } = {}) {
  const events = [];
  const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
  const flowExecutor = createFlowExecutor({ temporalClient: makeFakeTemporal(), temporalAddress: 'fake:7233', auditSink: auditSink ?? (async (e) => { events.push(e); }) });
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(baseUrl, events); }
  finally { await new Promise((r) => server.close(r)); await registry.end().catch(() => {}); await flowExecutor.close().catch(() => {}); }
}

const typesOf = (events) => events.map((e) => e.eventType);

test('bbx-flows-ten-audit-01: create/update/publish/delete emit the four definition events', async () => {
  await withServer(async (baseUrl, events) => {
    const flowId = (await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'f', definition: DEF }) })).json()).flowId;
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}`, { method: 'PATCH', headers: { ...A, 'x-correlation-id': 'audit-request-1001' }, body: JSON.stringify({ name: 'f2' }) });
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}`, { method: 'DELETE', headers: A });
    const t = typesOf(events);
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.DEFINITION_CREATED));
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.DEFINITION_UPDATED));
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.VERSION_PUBLISHED));
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.DEFINITION_DELETED));
    assert.equal(events.filter((e) => t.includes(e.eventType)).length, 4);
    assert.equal(events.find((e) => e.eventType === FLOW_AUDIT_EVENT_TYPES.DEFINITION_UPDATED).correlationId, 'audit-request-1001');
    for (const event of events) {
      assert.ok(event.eventId);
      assert.equal(event.outcome, 'succeeded');
      assert.ok(event.correlationId);
    }
  });
});

test('bbx-flows-ten-audit-02: execution start/cancel/retry/signal emit the four execution events', async () => {
  await withServer(async (baseUrl, events) => {
    const flowId = (await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'f', definition: DEF }) })).json()).flowId;
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    const start = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions`, { method: 'POST', headers: A, body: JSON.stringify({ version: 1 }) })).json();
    const eid = encodeURIComponent(start.workflowId);
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions/${eid}/signals/human-approval`, { method: 'POST', headers: A, body: JSON.stringify({ approved: true, nodeId: 'a' }) });
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions/${eid}/cancellations`, { method: 'POST', headers: A });
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions/${eid}/retries`, { method: 'POST', headers: A });
    const t = typesOf(events);
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.EXECUTION_STARTED));
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.SIGNAL_SENT));
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.EXECUTION_CANCELLED));
    assert.ok(t.includes(FLOW_AUDIT_EVENT_TYPES.EXECUTION_RETRY));
  });
});

test('bbx-flows-ten-audit-03: every emitted event carries tenantId, workspaceId, actorId, occurredAt', async () => {
  await withServer(async (baseUrl, events) => {
    const flowId = (await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'f', definition: DEF }) })).json()).flowId;
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/executions`, { method: 'POST', headers: A, body: JSON.stringify({ version: 1 }) });
    assert.ok(events.length > 0);
    for (const e of events) {
      assert.equal(e.tenantId, 'tenant_A');
      assert.equal(e.workspaceId, 'ws_A');
      assert.ok(e.actorId, `actorId present for ${e.eventType}`);
      assert.ok(e.occurredAt, `occurredAt present for ${e.eventType}`);
      assert.ok(e.flowId, `flowId present for ${e.eventType}`);
    }
  });
});

test('bbx-flows-ten-audit-04: publish event carries the correct flowVersion + tenant context', async () => {
  await withServer(async (baseUrl, events) => {
    const flowId = (await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { method: 'POST', headers: A, body: JSON.stringify({ name: 'f', definition: DEF }) })).json()).flowId;
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows/${flowId}/versions`, { method: 'POST', headers: A });
    const pub = events.find((e) => e.eventType === FLOW_AUDIT_EVENT_TYPES.VERSION_PUBLISHED);
    assert.ok(pub);
    assert.equal(pub.flowVersion, '1');
    assert.equal(pub.tenantId, 'tenant_A');
    assert.equal(pub.flowId, flowId);
  });
});

test('bbx-flows-ten-audit-05: a B-emitted event never carries tenant A identifiers', async () => {
  await withServer(async (baseUrl, events) => {
    await fetch(`${baseUrl}/v1/flows/workspaces/ws_B/flows`, { method: 'POST', headers: B, body: JSON.stringify({ name: 'f', definition: DEF }) });
    const bEvents = events.filter((e) => e.tenantId === 'tenant_B');
    assert.ok(bEvents.length > 0);
    for (const e of bEvents) {
      assert.ok(!JSON.stringify(e).includes('tenant_A'));
      assert.ok(!JSON.stringify(e).includes('ws_A'));
    }
  });
});

test('bbx-flows-ten-audit-06: the contract entry registers exactly the eight event types', () => {
  const enumTypes = flowLifecycleEvent.fields.eventType.enum;
  assert.deepEqual([...enumTypes].sort(), Object.values(FLOW_AUDIT_EVENT_TYPES).sort());
  assert.equal(flowLifecycleEvent.fields.eventId.type, 'string');
  assert.equal(flowLifecycleEvent.fields.outcome.type, 'string');
  assert.equal(flowLifecycleEvent.fields.correlationId.nullable, undefined);
  // The builder rejects an unknown event type and a missing required field (fail-closed).
  assert.throws(() => buildFlowAuditEvent({ eventType: 'flow.bogus', tenantId: 't', workspaceId: 'w', actorId: 'u', flowId: 'f' }));
  assert.throws(() => buildFlowAuditEvent({ eventType: FLOW_AUDIT_EVENT_TYPES.DEFINITION_CREATED, tenantId: 't', actorId: 'u', flowId: 'f' }));
});

test('invalid or oversized request correlation IDs are replaced before audit persistence', async () => {
  await withServer(async (baseUrl, events) => {
    const response = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, {
      method: 'POST', headers: { ...A, 'x-correlation-id': 'bad id with spaces' },
      body: JSON.stringify({ name: 'f', definition: DEF }),
    });
    assert.equal(response.status, 201);
    assert.match(events[0].correlationId, /^[0-9a-f-]{36}$/);
    const response2 = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, {
      method: 'POST', headers: { ...A, 'x-correlation-id': 'a'.repeat(129) },
      body: JSON.stringify({ name: 'f2', definition: DEF }),
    });
    assert.equal(response2.status, 201);
    assert.match(events[1].correlationId, /^[0-9a-f-]{36}$/);
  });
});


test('bbx-flows-audit-unavailable: failed outbox write rolls back an authoring mutation', async () => {
  await withServer(async (baseUrl) => {
    const result = await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, {
      method: 'POST', headers: A, body: JSON.stringify({ name: 'f', definition: DEF }),
    });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).code, 'AUDIT_UNAVAILABLE');
    const list = await (await fetch(`${baseUrl}/v1/flows/workspaces/ws_A/flows`, { headers: A })).json();
    assert.deepEqual(list.items, []);
  }, { auditSink: async () => { throw new Error('simulated outbox failure'); } });
});

test('flow audit envelope has stable id and rejects missing correlation id', () => {
  const event = buildFlowAuditEvent({ eventType: FLOW_AUDIT_EVENT_TYPES.DEFINITION_CREATED,
    tenantId: 't', workspaceId: 'w', actorId: 'a', flowId: 'f' });
  assert.ok(event.eventId);
  assert.equal(event.outcome, 'succeeded');
  assert.ok(event.correlationId);
  assert.throws(() => buildFlowAuditEvent({ ...event, correlationId: null }), /correlationId/);
});
