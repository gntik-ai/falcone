import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { ServerResponse } from 'node:http';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowQuotaGate } from '../../apps/control-plane-executor/src/runtime/flow-quota-gate.mjs';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';
import { computeSignature } from '../../packages/webhook-engine/src/webhook-signing.mjs';
import { createFlowQuotaEvaluator } from '../../apps/control-plane-executor/src/runtime/flow-quota-evaluator.mjs';

const TEN = 'quota_tenant';
const WS = 'quota_workspace';
const DEF = { apiVersion: 'v1.0', name: 'quota', nodes: [{ id: 'approve', type: 'approval', next: 'end' }, { id: 'end', type: 'task', taskType: 't' }] };
const headers = (workspace = WS) => ({ 'content-type': 'application/json', 'x-tenant-id': TEN, 'x-workspace-id': workspace, 'x-auth-subject': 'owner', 'x-actor-roles': 'tenant_owner' });
const notFound = () => Object.assign(new Error('missing'), { name: 'WorkflowNotFoundError' });

function fakeTemporal() {
  const handles = new Map();
  const started = [];
  const queries = [];
  const recent = [];
  const running = [];
  let scheduled = 0;
  let signalCount = 0;
  let signalError;
  return {
    handles, started, queries, recent, running,
    get scheduled() { return scheduled; },
    get signalCount() { return signalCount; },
    set signalError(value) { signalError = value; },
    workflow: {
      async start(type, opts) {
        if (handles.has(opts.workflowId)) throw Object.assign(new Error('duplicate'), { name: 'WorkflowExecutionAlreadyStartedError' });
        started.push(opts);
        const handle = {
          firstExecutionRunId: `run-${started.length}`, status: 'Running',
          async describe() { return { status: { name: this.status }, searchAttributes: opts.searchAttributes }; },
          async signal() { if (signalError) throw signalError; signalCount++; },
        };
        handles.set(opts.workflowId, handle);
        return handle;
      },
      getHandle(id) { return handles.get(id) ?? { async describe() { throw notFound(); } }; },
      async *list({ query }) {
        queries.push(query);
        // The external visibility service applies the time/status/workspace clauses. Include a
        // foreign tenant id to verify the executor's additional id ownership check.
        const visible = query.includes('StartTime >') ? recent : query.includes("ExecutionStatus = 'Running'") ? running : [];
        for (const workflowId of visible) yield { workflowId };
      },
    },
    schedule: {
      async create() {},
      getHandle() { return { async trigger() { scheduled++; } }; },
    },
  };
}

async function withServer(fn, { evaluate, now, temporal = fakeTemporal() } = {}) {
  const registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
  const executor = createFlowExecutor({ temporalClient: temporal, temporalAddress: 'fake:7233', quotaGate: createFlowQuotaGate({ evaluate }), now });
  const triggers = createFlowTriggerRegistry({ temporalClient: temporal, startTriggeredExecution: args => executor.startTriggeredExecution(args), logger: { error() {} } });
  executor.setTriggerRegistry(triggers);
  const server = createControlPlaneServer({ registry, flowExecutor: executor, logger: { error() {} } });
  async function request(path = '', { workspace = WS, body, method = 'POST', extraHeaders = {} } = {}) {
    // Drive the real HTTP server's request event with Node HTTP streams. No listening socket is
    // needed, so the same routing/envelope assertions run in network-restricted sandboxes.
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path.startsWith('/v1/') ? path : `/v1/flows/workspaces/${workspace}/flows${path}`, headers: { ...headers(workspace), ...extraHeaders }, httpVersionMajor: 1, httpVersionMinor: 1 });
    const chunks = [];
    const socket = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    const finished = new Promise(resolve => res.on('finish', resolve));
    server.emit('request', req, res);
    await finished;
    const raw = Buffer.concat(chunks).toString();
    return new Response(raw.slice(raw.indexOf('\r\n\r\n') + 4), { status: res.statusCode });
  }
  async function seed(workspace = WS) {
    const created = await request('', { workspace, body: { name: 'quota', definition: DEF } });
    assert.equal(created.status, 201);
    const { flowId } = await created.json();
    assert.equal((await request(`/${flowId}/versions`, { workspace })).status, 201);
    return flowId;
  }
  try { await fn({ request, seed, temporal, executor }); }
  finally { await triggers.close(); await executor.close(); await registry.end(); }
}

test('start, retry and run-now meter recent workspace starts before mutation', async () => {
  let limit = 3;
  const actions = [];
  const evaluate = createFlowQuotaEvaluator({ pool: {}, load: async (_, tenant, dimension) => ({ effectiveLimit: dimension === 'flow_starts_per_minute' ? limit : 100, source: 'plan' }), recordDenial: async (_, row) => actions.push(row.attemptedAction) }).evaluate;
  const temporal = fakeTemporal();
  temporal.recent.push(...[1, 2, 3].map(i => `${TEN}:${WS}:old:run${i}`), `foreign:${WS}:old:run4`);
  await withServer(async ({ request, seed }) => {
    const flowId = await seed();
    const source = `${TEN}:${WS}:${flowId}:original`;
    temporal.handles.set(source, { async describe() { return { searchAttributes: { flowVersion: ['1'] } }; } });
    const paths = [`/${flowId}/executions`, `/${flowId}/executions/${source}/retries`, `/${flowId}/schedule/trigger`];
    for (const path of paths) {
      const res = await request(path);
      assert.equal(res.status, 429, path);
      assert.equal((await res.json()).dimension, 'flow_starts_per_minute');
    }
    assert.equal(temporal.started.length, 0);
    assert.equal(temporal.scheduled, 0);
    assert.deepEqual(actions, ['flow.execution.start', 'flow.execution.retry', 'flow.execution.start']);
    limit = 4;
    for (const [i, path] of paths.entries()) assert.equal((await request(path)).status, i === 2 ? 202 : 201, path);
    assert.equal(temporal.started.length, 2);
    assert.equal(temporal.scheduled, 1);
    const query = temporal.queries.find(q => q.includes('StartTime >'));
    assert.ok(query, 'start rate uses Temporal visibility');
    assert.ok(query.includes(`tenantId = '${TEN}' AND workspaceId = '${WS}'`));
    assert.ok(query.includes("StartTime > '2026-10-18T11:59:00.000Z'"));
  }, { temporal, now: () => Date.parse('2026-10-18T12:00:00Z'), evaluate });
});

test('publishing uses catalog limits and records a best-effort denial with the action', async () => {
  const rows = [];
  let failInsert = false;
  const pool = { async query(sql, params) {
    assert.match(sql, /INSERT INTO quota_enforcement_log/);
    if (failInsert) throw new Error('insert unavailable');
    rows.push(params);
    return { rows: [] };
  } };
  const evaluator = createFlowQuotaEvaluator({ pool, load: async (_, tenant, dimension) => {
    assert.equal(tenant, TEN);
    return { effectiveLimit: dimension === 'max_flow_versions' ? 2 : 100, quotaType: 'hard', source: 'plan' };
  } });
  await withServer(async ({ request, seed }) => {
    const flowId = await seed(); // usage 0 -> first version
    assert.equal((await request(`/${flowId}/versions`)).status, 201); // usage 1
    const denied = await request(`/${flowId}/versions`);
    assert.equal(denied.status, 429);
    const body = await denied.json();
    assert.equal(body.code, 'QUOTA_EXCEEDED');
    assert.equal(body.dimension, 'max_flow_versions');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].slice(1, 8), [TEN, WS, 'max_flow_versions', 'flow.publish', 2, 2, 'hard']);
    failInsert = true;
    assert.equal((await request(`/${flowId}/versions`)).status, 429, 'log failure cannot admit a denied publish');
  }, { evaluate: evaluator.evaluate });
});

test('soft grace admits below the ceiling; resolver/evaluator faults and missing usage fail closed', async () => {
  let broken = false;
  const records = [];
  const evaluate = createFlowQuotaEvaluator({ pool: {},
    load: async () => { if (broken) throw new Error('resolver unavailable'); return { effectiveLimit: 1, quotaType: 'soft', graceMargin: 1, source: 'override' }; },
    recordDenial: async (_, row) => { records.push(row); throw new Error('insert failed'); },
  }).evaluate;
  await withServer(async ({ seed, request }) => {
    const flowId = await seed();
    assert.equal((await request(`/${flowId}/versions`)).status, 201, 'usage 1 is within grace');
    assert.equal((await request(`/${flowId}/versions`)).status, 429, 'usage 2 exhausts grace');
    assert.equal(records.length, 1);
    assert.equal(records[0].decision, 'soft_grace_exhausted');
    broken = true;
    const denied = await request(`/${flowId}/versions`);
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).dimension, 'max_flow_versions');
  }, { evaluate });
  const gate = createFlowQuotaGate({ evaluate });
  await assert.rejects(gate.enforce('max_flows', { tenantId: TEN, workspaceId: WS, currentUsage: 0 }), err => err.statusCode === 429 && err.quota.reason === 'metering_unavailable');
  broken = false;
  await assert.rejects(gate.enforce('max_flows', { tenantId: TEN, workspaceId: WS }), err => err.statusCode === 429 && err.quota.decision === 'metering_unavailable');
  for (const evaluate of [() => { throw new Error('evaluator failed'); }, () => ({ decision: 'metering_unavailable' })]) {
    await withServer(async ({ request }) => {
      const denied = await request('', { body: { name: 'q', definition: DEF } });
      assert.equal(denied.status, 429);
      assert.equal((await denied.json()).dimension, 'max_flows');
    }, { evaluate });
  }
});

test('production always wires the in-process evaluator without an HTTP quota URL', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../../apps/control-plane-executor/src/runtime/main.mjs', import.meta.url), 'utf8');
  assert.ok(!main.includes('FLOW_QUOTA_ENFORCE_URL'));
  assert.match(main, /quotaGate:\s*createFlowQuotaGate\(\{\s*evaluate:\s*createFlowQuotaEvaluator\(\{\s*pool:\s*keyPool\s*\}\)\.evaluate/);
});

test('deterministic webhook replays bypass exhausted quotas in running and closed states', async () => {
  let limit = 10;
  const evaluate = createFlowQuotaEvaluator({ pool: {}, load: async () => ({ effectiveLimit: limit, source: 'plan' }), recordDenial: async () => {} }).evaluate;
  await withServer(async ({ request, temporal }) => {
    const created = await request('', { body: { name: 'hook', definition: { ...DEF, triggers: [{ kind: 'webhook', path: 'orders' }] } } });
    assert.equal(created.status, 201);
    const { flowId } = await created.json();
    const published = await request(`/${flowId}/versions`);
    assert.equal(published.status, 201);
    const { triggers: { webhooks: [{ triggerId, secret }] } } = await published.json();
    const body = { order: 7 };
    const extraHeaders = { 'x-platform-webhook-signature': computeSignature(JSON.stringify(body), secret), 'x-platform-webhook-id': 'delivery-1' };
    const url = `/v1/flows/workspaces/${WS}/triggers/webhooks/${encodeURIComponent(triggerId)}`;
    const first = await request(url, { body, extraHeaders });
    assert.equal(first.status, 202);
    assert.equal((await first.json()).deduplicated, false);
    assert.equal(temporal.started.length, 1);
    limit = 0;
    for (const state of ['Running', 'Completed']) {
      temporal.handles.get(temporal.started[0].workflowId).status = state;
      const replay = await request(url, { body, extraHeaders });
      assert.equal(replay.status, 202);
      assert.equal((await replay.json()).deduplicated, true);
    }
    assert.equal(temporal.started.length, 1);
    assert.equal(temporal.started[0].workflowIdReusePolicy, 'REJECT_DUPLICATE');
  }, { evaluate });
});

test('signal reservations admit exactly two concurrent deliveries and expire per workspace', async () => {
  let clock = Date.parse('2026-10-18T12:00:00Z');
  const evaluate = createFlowQuotaEvaluator({ pool: {}, load: async (_, tenant, dimension) => ({ effectiveLimit: dimension === 'flow_signal_rate_per_minute' ? 2 : 100, source: 'plan' }), recordDenial: async () => {} }).evaluate;
  await withServer(async ({ request, seed, temporal }) => {
    const flowId = await seed();
    const started = await request(`/${flowId}/executions`);
    assert.equal(started.status, 201);
    const { executionId } = await started.json();
    const signal = (name = 'human-approval', id = executionId) => request(`/${flowId}/executions/${encodeURIComponent(id)}/signals/${name}`);
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => signal()));
    assert.deepEqual(concurrent.map(r => r.status).sort(), [202, 202, 429, 429, 429]);
    assert.equal(temporal.signalCount, 2);
    const otherWorkspace = 'other_workspace';
    const otherFlow = await seed(otherWorkspace);
    const other = await request(`/${otherFlow}/executions`, { workspace: otherWorkspace });
    assert.equal(other.status, 201);
    const otherId = (await other.json()).executionId;
    assert.equal((await request(`/${otherFlow}/executions/${encodeURIComponent(otherId)}/signals/human-approval`, { workspace: otherWorkspace })).status, 202);
    clock += 60_000;
    assert.equal((await signal()).status, 202);
    assert.equal((await signal()).status, 202);
  }, { evaluate, now: () => clock });
});

test('failed signal admission, lookup, allowlist and Temporal delivery release reservations', async () => {
  let limit = 2;
  const evaluate = createFlowQuotaEvaluator({ pool: {}, load: async (_, tenant, dimension) => ({ effectiveLimit: dimension === 'flow_signal_rate_per_minute' ? limit : 100, source: 'plan' }), recordDenial: async () => {} }).evaluate;
  await withServer(async ({ request, seed, temporal }) => {
    const flowId = await seed();
    const { executionId } = await (await request(`/${flowId}/executions`)).json();
    const signal = (name = 'human-approval', id = executionId) => request(`/${flowId}/executions/${encodeURIComponent(id)}/signals/${name}`);
    limit = 0;
    assert.equal((await signal()).status, 429);
    limit = 2;
    assert.equal((await signal('human-approval', `${TEN}:${WS}:${flowId}:missing`)).status, 404);
    assert.equal((await signal('unknown')).status, 422);
    const badPinned = `${TEN}:${WS}:${flowId}:bad-version`;
    temporal.handles.set(badPinned, { async describe() { return { searchAttributes: { flowVersion: ['999'] } }; } });
    assert.equal((await signal('human-approval', badPinned)).status, 422);
    temporal.signalError = new Error('Temporal delivery failed');
    assert.equal((await signal()).status, 500);
    temporal.signalError = undefined;
    assert.equal((await signal()).status, 202);
    assert.equal((await signal()).status, 202);
    assert.equal((await signal()).status, 429);
    assert.equal(temporal.signalCount, 2);
  }, { evaluate });
});

test('concurrency admission also covers starts, retries and schedule run-now', async () => {
  let limit = 3;
  const temporal = fakeTemporal();
  temporal.running.push(...[1, 2, 3].map(i => `${TEN}:${WS}:old:run${i}`), `foreign:${WS}:old:run4`);
  const evaluate = createFlowQuotaEvaluator({ pool: {}, load: async (_, tenant, dimension) => ({ effectiveLimit: dimension === 'max_concurrent_executions' ? limit : 100, source: 'plan' }), recordDenial: async () => {} }).evaluate;
  await withServer(async ({ seed, request }) => {
    const flowId = await seed();
    const source = `${TEN}:${WS}:${flowId}:original`;
    temporal.handles.set(source, { async describe() { return { searchAttributes: { flowVersion: ['1'] } }; } });
    const paths = [`/${flowId}/executions`, `/${flowId}/executions/${source}/retries`, `/${flowId}/schedule/trigger`];
    for (const path of paths) {
      const denied = await request(path);
      assert.equal(denied.status, 429);
      assert.equal((await denied.json()).dimension, 'max_concurrent_executions');
    }
    assert.equal(temporal.started.length, 0);
    assert.equal(temporal.scheduled, 0);
    limit = 4;
    for (const [i, path] of paths.entries()) assert.equal((await request(path)).status, i === 2 ? 202 : 201);
  }, { temporal, evaluate });
});
