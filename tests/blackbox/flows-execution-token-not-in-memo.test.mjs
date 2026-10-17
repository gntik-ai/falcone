// fix-flow-execution-token-at-rest (#633)
//
// The per-execution flow auth token (an HMAC bearer credential) was mirrored into the Temporal
// workflow memo as json/plain — unencrypted — despite a comment claiming it was "encrypted by
// Temporal" (no PayloadCodec is configured). Anyone with Temporal visibility access could read it.
// The memo copy was redundant: the worker reads the token from the workflow ARGS (tenant
// envelope), never the memo. The fix drops the memo. This boots the real control-plane server with
// an injected fake Temporal client that records every workflow.start(), publishes a flow, starts an
// execution, and asserts both args and memo carry no token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

const TEN = 'ten_memo';
const WS = 'ws_memo';
const authHeaders = { 'content-type': 'application/json', 'x-tenant-id': TEN, 'x-workspace-id': WS, 'x-auth-subject': 'admin', 'x-actor-roles': 'tenant_admin' };
const DEF = { apiVersion: 'v1.0', name: 'memo-flow', nodes: [{ id: 's1', type: 'task', taskType: 'fetch-record' }] };

// Minimal @temporalio/client-shaped fake that records every start()'s opts.
function makeFakeTemporal() {
  const started = [];
  const handles = new Map();
  const handle = (workflowId, sa) => ({
    workflowId,
    firstExecutionRunId: `run-${workflowId.slice(-6)}`,
    async describe() { return { status: { name: 'Running' }, searchAttributes: sa ?? { flowVersion: ['1'] } }; },
    async fetchHistory() { return { events: [] }; },
    async cancel() {},
    async signal() {},
  });
  return {
    started,
    workflow: {
      async start(type, opts) {
        if (handles.has(opts.workflowId)) {
          throw Object.assign(new Error('already started'), { name: 'WorkflowExecutionAlreadyStartedError' });
        }
        const h = handle(opts.workflowId, opts.searchAttributes);
        handles.set(opts.workflowId, h);
        started.push({ type, opts });
        return h;
      },
      getHandle(id) { return handles.get(id) ?? handle(id, { flowVersion: ['1'] }); },
      async *list() { /* no running executions */ },
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

async function withServer(fn) {
  const temporal = makeFakeTemporal();
  const registry = makeRegistry();
  const flowExecutor = createFlowExecutor({ temporalClient: temporal, temporalAddress: 'fake:7233' });
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { return await fn({ baseUrl, temporal }); } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor.close().catch(() => {});
  }
}

const flowsBase = `/v1/flows/workspaces/${WS}/flows`;

test('bbx-flow-memo-01: starting an execution does NOT write the execution token into the Temporal memo', async () => {
  await withServer(async ({ baseUrl, temporal }) => {
    const create = await fetch(`${baseUrl}${flowsBase}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'memo-flow', definition: DEF }) });
    const createBody = await create.json();
    assert.equal(create.status, 201, JSON.stringify(createBody));
    const { flowId } = createBody;

    const pub = await fetch(`${baseUrl}${flowsBase}/${flowId}/versions`, { method: 'POST', headers: authHeaders });
    const pubText = await pub.text();
    assert.equal(pub.status, 201, pubText);

    const start = await fetch(`${baseUrl}${flowsBase}/${flowId}/executions`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ input: {} }) });
    const startText = await start.text();
    assert.equal(start.status, 201, startText);

    assert.equal(temporal.started.length, 1, 'exactly one workflow started');
    const opts = temporal.started[0].opts;

    // The memo must carry NO token (a memo is plaintext in Temporal visibility/history).
    const memoStr = JSON.stringify(opts.memo ?? {});
    assert.deepEqual(Object.keys(opts.memo), ['falconeCredentialAttempt']);
    assert.ok(!memoStr.includes('falconeExecutionToken'), 'memo has no execution-token key');
    const tenant = opts.args?.[0]?.tenant;
    assert.equal(Object.hasOwn(tenant, 'executionToken'), false);
    assert.match(tenant.executionTokenRef, /^fxr_[A-Za-z0-9_-]{43}$/);
    assert.ok(!memoStr.includes(tenant.executionTokenRef), 'reference absent from memo');
    assert.ok(!JSON.stringify(opts.searchAttributes).includes(tenant.executionTokenRef), 'reference absent from search attributes');
  });
});

test('production flow-start returns 503 and starts no workflow when the secret is absent or empty', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, FLOW_EXECUTION_TOKEN_SECRET: process.env.FLOW_EXECUTION_TOKEN_SECRET };
  try {
    process.env.NODE_ENV = 'production';
    await withServer(async ({ baseUrl, temporal }) => {
      const create = await fetch(`${baseUrl}${flowsBase}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ name: 'unconfigured', definition: DEF }) });
      assert.equal(create.status, 201);
      const { flowId } = await create.json();
      const pub = await fetch(`${baseUrl}${flowsBase}/${flowId}/versions`, { method: 'POST', headers: authHeaders });
      assert.equal(pub.status, 201);
      for (const secret of [undefined, '']) {
        if (secret === undefined) delete process.env.FLOW_EXECUTION_TOKEN_SECRET;
        else process.env.FLOW_EXECUTION_TOKEN_SECRET = secret;
        const start = await fetch(`${baseUrl}${flowsBase}/${flowId}/executions`, { method: 'POST', headers: authHeaders, body: '{}' });
        assert.equal(start.status, 503);
        const body = await start.json();
        assert.equal(body.code, 'EXECUTION_TOKEN_SECRET_UNCONFIGURED');
        assert.equal(body.message, 'Internal server error');
        assert.equal(temporal.started.length, 0);
      }
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('cron Schedule actions persist no execution token in args, memo, or search attributes', async () => {
  let schedule;
  const registry = createFlowTriggerRegistry({ temporalClient: { schedule: {
    create: async (options) => { schedule = options; },
  } } });
  await registry.registerTriggers('flow_cron', 1, [{ kind: 'cron', schedule: '0 * * * *' }], { tenantId: TEN, workspaceId: WS });
  assert.equal(schedule.action.args[0].tenant.executionToken, undefined);
  assert.equal(schedule.action.memo, undefined);
  assert.equal(JSON.stringify(schedule.action).includes('executionToken'), false);
});
