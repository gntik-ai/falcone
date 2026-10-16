import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';
import { createFlowMonitoringExecutor } from '../../apps/control-plane-executor/src/runtime/flow-monitoring-executor.mjs';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { openapiRoutes, routeKey } from './helpers/console-publication.mjs';
import { request } from './helpers/gateway-only-http.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');
const rows = read('tests/contracts/fixtures/gateway-only-reconciled.json').rows.filter(r => r.disposition === 'TO_PUBLISH');
const ajv = new Ajv({ strict: false, validateFormats: false });
const validators = new Map();
function validator(schema) {
  if (!validators.has(schema)) validators.set(schema, ajv.compile({ ...schema, components: document.components }));
  return validators.get(schema);
}
function validate(schema, value) {
  const check = validator(schema);
  assert.ok(check(value), JSON.stringify(check.errors));
}
const TEN = 'ten_contract';
const WS = 'ws_contract';
const F = `/v1/flows/workspaces/${WS}/flows`;
const K = `/v1/workspaces/${WS}/api-keys`;
const R = `/v1/postgres/workspaces/${WS}/data/appdb/schemas/public/tables/docs/rows`;
const adminHeaders = { authorization: 'Bearer admin' };
const definition = { apiVersion: 'v1.0', name: 'contract-flow',
  triggers: [{ kind: 'cron', schedule: '*/5 * * * *' }],
  nodes: [ { id: 'step-1', type: 'task', taskType: 'db.query', input: { engine: 'postgres', operation: 'list' }, next: 'review' },
    { id: 'review', type: 'approval', approvers: ['role:workspace_admin'], timeout: 'P2D' } ] };

// Only external I/O is replaced. Definitions, versions, trigger registration, history mapping,
// key hashing/scope checks, SQL planning and HTTP dispatch all use the production implementations.
function externalIo(calls) {
  const runs = new Map();
  const schedules = new Map();
  const keys = new Map();
  const data = new Map();
  const record = name => calls.push(name);
  const description = id => {
    const s = schedules.get(id);
    assert.ok(s, 'schedule must have been seeded');
    return { scheduleId: id, spec: { calendars: [{ minute: [{ step: 5 }] }] },
      state: { paused: s.paused, note: s.note },
      info: { nextActionTimes: s.paused ? [] : [new Date('2026-10-15T12:00:00Z')], recentActions: [] } };
  };
  const scheduleHandle = id => ({
    async describe() { record('schedule.describe'); return description(id); },
    async pause(note) { record('schedule.pause'); Object.assign(schedules.get(id), { paused: true, note }); },
    async unpause(note) { record('schedule.unpause'); Object.assign(schedules.get(id), { paused: false, note }); },
    async trigger() { record('schedule.trigger'); schedules.get(id).triggered = true; },
    async update(fn) { record('schedule.update'); Object.assign(schedules.get(id), fn(schedules.get(id))); },
  });
  const handle = id => {
    const run = runs.get(id);
    assert.ok(run, 'execution must have been seeded');
    return {
      workflowId: id, firstExecutionRunId: run.runId,
      async describe() { record('workflow.describe'); return { status: { name: run.status }, searchAttributes: run.options.searchAttributes,
        startTime: '2026-10-15T00:00:00Z', closeTime: null }; },
      async fetchHistory() { record('workflow.history'); return { events: run.events }; },
      async cancel() { record('workflow.cancel'); run.status = 'Canceled'; },
      async signal(name, payload) { record('workflow.signal'); run.signals.push({ name, payload }); },
    };
  };
  const temporal = {
    workflow: {
      async start(_type, options) {
        record('workflow.start');
        runs.set(options.workflowId, { options, status: 'Running', runId: `run-${runs.size + 1}`, signals: [], events: [
          { eventId: 1, eventTime: '2026-10-15T00:00:00Z', activityTaskScheduledEventAttributes: { activityId: options.args[0].definition.nodes[0].id } },
        ] });
        return handle(options.workflowId);
      },
      getHandle(id) { record('workflow.getHandle'); return handle(id); },
      async *list({ query }) {
        record('workflow.list');
        for (const [id, run] of runs) {
          if (/ExecutionStatus = 'Running'/.test(query) && run.status !== 'Running') continue;
          yield { workflowId: id, runId: run.runId, status: { name: run.status }, startTime: '2026-10-15T00:00:00Z', closeTime: null };
        }
      },
    },
    schedule: {
      async create(options) {
        record('schedule.create');
        if (schedules.has(options.scheduleId)) throw new Error('Schedule already exists');
        schedules.set(options.scheduleId, { ...options, paused: false, note: null });
      },
      getHandle(id) { record('schedule.getHandle'); return scheduleHandle(id); },
      async *list() { record('schedule.list'); for (const id of schedules.keys()) yield description(id); },
    },
  };
  const history = {
    async describe(id) { record('history.describe'); assert.ok(runs.has(id)); return { status: { name: 'Completed' } }; },
    async fetchHistory(id) { record('history.fetch'); return { events: runs.get(id).events }; },
    isTerminal(status) { return status === 'Completed'; },
  };
  const result = rows => ({ rows, rowCount: rows.length });
  const pool = { async query(sql, params) {
    record('keys.query');
    if (sql.startsWith('INSERT')) {
      const [tenant_id, workspace_id, key_type, key_prefix, key_hash, scopes] = params;
      const row = { id: `key-${keys.size + 1}`, tenant_id, workspace_id, key_type, key_prefix, key_hash, scopes,
        status: 'active', created_at: '2026-10-15T00:00:00Z', last_used_at: null };
      keys.set(row.id, row);
      return result([row]);
    }
    if (sql.startsWith('SELECT tenant_id')) {
      const row = keys.get(params[0]);
      return result(row?.workspace_id === params[1] ? [row] : []);
    }
    if (sql.trimStart().startsWith('SELECT id')) return result([...keys.values()].filter(k => k.workspace_id === params[0]));
    if (sql.startsWith('UPDATE workspace_api_keys SET status')) {
      const row = keys.get(params[0]);
      if (!row || row.workspace_id !== params[1] || row.status !== 'active') return result([]);
      row.status = 'revoked';
      return result([{ id: row.id }]);
    }
    throw new Error('Unexpected key SQL');
  } };
  const client = { async query(sql, params = []) {
    record('postgres.query');
    if (sql.includes('information_schema.columns')) return result([
      { column_name: 'id', data_type: 'integer', udt_name: 'int4' },
      { column_name: 'body', data_type: 'text', udt_name: 'text' },
    ]);
    if (sql.includes('FROM pg_index')) return result([{ column_name: 'id' }]);
    if (sql.includes('set_config')) return result([]);
    if (sql.startsWith('INSERT')) {
      const columns = /INSERT INTO [^(]+\(([^)]+)\)/.exec(sql)[1].split(',').map(s => s.trim().replaceAll('"', ''));
      const inserted = [];
      for (let i = 0; i < params.length; i += columns.length) {
        const row = Object.fromEntries(columns.map((c, n) => [c, params[i + n]]));
        data.set(row.id, row);
        inserted.push(row);
      }
      return result(inserted);
    }
    throw new Error('Unexpected data SQL');
  } };
  const registry = { async withWorkspaceClient(_workspace, _identity, fn) { record('postgres.connect'); return fn(client); } };
  return { temporal, history, pool, registry };
}

async function fixture(t, n) {
  const calls = [];
  const io = externalIo(calls);
  const flowExecutor = createFlowExecutor({ temporalClient: io.temporal });
  const triggers = createFlowTriggerRegistry({ temporalClient: io.temporal });
  flowExecutor.setTriggerRegistry(triggers);
  const flowMonitoringExecutor = createFlowMonitoringExecutor({ workflowHistoryProvider: io.history });
  const tokens = { admin: { tenantId: TEN, workspaceId: WS, credentialWorkspaceId: WS, workspaceIds: [WS],
    actorId: 'contract-admin', roles: ['tenant_admin'] } };
  let owningTenant = TEN;
  const server = createControlPlaneServer({ registry: io.registry, flowExecutor, flowMonitoringExecutor,
    apiKeyStore: createApiKeyStore({ pool: io.pool }),
    jwtVerifier: { async verify(token) { return tokens[token]; } },
    resolveWorkspaceTenant: async () => owningTenant,
    logger: { error() {} },
  });
  t.after(async () => { server.closeAllConnections(); await flowExecutor.close(); await flowMonitoringExecutor.close(); });
  const dispatch = (method, path, body, headers = adminHeaders) => request(server, method, path, { body, headers });
  const seed = async (method, path, body, status) => {
    const response = await dispatch(method, path, body);
    assert.equal(response.status, status, `seed ${method} ${path}: ${response.body?.code ?? ''}`);
    return response.body;
  };
  const values = { workspaceId: WS };
  if (n < 20) {
    const flow = await seed('POST', F, { name: 'Seeded flow', definition }, 201);
    values.flowId = flow.flowId;
    await seed('POST', `${F}/${flow.flowId}/versions`, undefined, 201);
    const execution = await seed('POST', `${F}/${flow.flowId}/executions`, { version: 1 }, 201);
    values.executionId = execution.executionId;
    values.signalName = 'review';
    // Resume is exercised from a paused schedule, not an already-resumed no-op.
    if (n === 14) await seed('POST', `${F}/${flow.flowId}/schedule/pause`, undefined, 200);
  } else if (n === 37) {
    await seed('POST', R, { row: { id: 1, body: 'seeded' } }, 201);
    Object.assign(values, { databaseName: 'appdb', schemaName: 'public', tableName: 'docs' });
  } else {
    const key = await seed('POST', K, { keyType: 'anon' }, 201);
    values.keyId = key.id;
  }
  calls.length = 0;
  return { server, calls, values, dispatch,
    setOwner(tenant) { owningTenant = tenant; },
    token(name, identity) { tokens[name] = { ...tokens.admin, ...identity }; return { authorization: `Bearer ${name}` }; },
  };
}

// Added one row at a time: each missing operation was observed red before its source was added.
const cases = [
  { n: 2, status: 200, check(body) { assert.equal(body.type, 'node-status'); assert.equal(body.nodeId, 'step-1'); assert.equal(body.status, 'scheduled'); } },
  { n: 5, status: 200, check(b, v) { assert.equal(b.flowId, v.flowId); assert.equal(b.name, 'Seeded flow'); assert.deepEqual(b.definition, definition); } },
  { n: 6, status: 200, body: { name: 'Updated flow', definition }, check(b, v) { assert.equal(b.flowId, v.flowId); assert.equal(b.name, 'Updated flow'); } },
  { n: 7, status: 200, check(b, v) { assert.equal(b.items.length, 1); assert.equal(b.items[0].executionId, v.executionId); } },
  { n: 8, status: 200, check(b, v) { assert.equal(b.executionId, v.executionId); assert.equal(b.events[0].nodeId, 'step-1'); } },
  { n: 9, status: 202, check(b, v) { assert.equal(b.executionId, v.executionId); assert.equal(b.status, 'Cancelling'); } },
  { n: 10, status: 201, check(b, v) { assert.equal(b.retriedFrom, v.executionId); assert.notEqual(b.executionId, v.executionId); assert.equal(b.version, 1); } },
  { n: 11, status: 202, body: { approved: true }, check(b, v) { assert.equal(b.executionId, v.executionId); assert.equal(b.signal, 'review'); assert.equal(b.delivered, true); } },
  { n: 12, status: 200, check(b, v) { assert.equal(b.flowId, v.flowId); assert.equal(b.paused, false); assert.deepEqual(b.cron, ['*/5 * * * *']); } },
  { n: 13, status: 200, check(b, v) { assert.equal(b.flowId, v.flowId); assert.equal(b.paused, true); } },
  { n: 14, status: 200, check(b, v) { assert.equal(b.flowId, v.flowId); assert.equal(b.paused, false); assert.equal(b.nextActionTimes.length, 1); } },
  { n: 15, status: 202, check(b, v) { assert.equal(b.status, 'triggered'); assert.equal(b.scheduleId, `${TEN}:${WS}:${v.flowId}`); } },
  { n: 16, status: 200, check(b) { assert.equal(b.valid, true); } },
  { n: 17, status: 201, check(b, v) { assert.equal(b.flowId, v.flowId); assert.equal(b.version, 2); } },
  { n: 18, status: 200, check(b, v) { assert.equal(b.items.length, 1); assert.equal(b.items[0].flowId, v.flowId); assert.deepEqual(b.items[0].cron, ['*/5 * * * *']); } },
  { n: 19, status: 200, check(b) { assert.ok(b.items.length > 0); assert.ok(b.items.some(item => item.id === 'db.query' && item.inputSchema.type === 'object')); } },
  { n: 37, status: 201, body: { rows: [{ id: 2, body: 'bulk row' }] }, check(b) { assert.equal(b.affected, 1); assert.deepEqual(b.items, [{ id: 2, body: 'bulk row' }]); } },
  { n: 40, status: 200, check(b, v) { assert.equal(b.items.length, 1); assert.equal(b.items[0].id, v.keyId); assert.equal(b.items[0].status, 'active'); assert.ok(!('key' in b.items[0])); } },
  { n: 41, status: 201, body: { keyType: 'service', scopes: ['data:read'] }, check(b, v) { assert.notEqual(b.id, v.keyId); assert.equal(b.keyType, 'service'); assert.deepEqual(b.scopes, ['data:read']); } },
  { n: 42, status: 200, check(b, v) { assert.equal(b.id, v.keyId); assert.equal(b.revoked, true); } },
  { n: 43, status: 201, check(b, v) { assert.notEqual(b.id, v.keyId); assert.equal(b.keyType, 'anon'); assert.deepEqual(b.scopes, ['data:read']); } },
];

test('the HTTP table covers exactly the 21 TO_PUBLISH rows', () => {
  assert.deepEqual(cases.map(c => c.n), rows.map(r => r.n));
});

function urlFor(path, values) {
  return path.replace(/\{([^}]+)\}/g, (_match, key) => {
    assert.ok(values[key], `missing path value ${key}`);
    return encodeURIComponent(values[key]);
  });
}

function assertSuccess(item, operation, response, values) {
  assert.equal(response.status, item.status, response.body?.code);
  const media = item.n === 2 ? 'text/event-stream' : 'application/json';
  assert.match(response.headers['content-type'], new RegExp(media));
  let actual = response.body;
  if (item.n === 2) {
    assert.ok(response.text.startsWith('retry: 3000\n\n'));
    const data = response.text.split('\n\n').find(frame => frame.split('\n').some(line => line.startsWith('data: ')));
    assert.ok(data, 'skip retry and inspect the first data event');
    actual = JSON.parse(data.split('\n').find(line => line.startsWith('data: ')).slice(6));
  }
  validate(operation.responses[String(item.status)].content[media].schema, actual);
  item.check(actual, values);
}

for (const item of cases) {
  const row = rows.find(r => r.n === item.n);
  test(`row ${item.n}: ${row.operationId} matches real HTTP success and denial contracts`, async t => {
    const matches = openapiRoutes(document).filter(r => routeKey(r) === routeKey(row));
    assert.equal(matches.length, 1, `${row.operationId} must be published`);
    const { operation, path } = matches[0];
    assert.equal(operation.operationId, row.operationId);
    const ctx = await fixture(t, item.n);
    const url = urlFor(path, ctx.values);
    const body = item.body;
    if (operation.requestBody) validate(operation.requestBody.content['application/json'].schema, body);
    else assert.equal(body, undefined, 'bodyless operation sends no body');
    assertSuccess(item, operation, await ctx.dispatch(row.method, url, body), ctx.values);

    assert.ok(operation['x-audiences'].length > 0);
    assert.equal(new Set(operation['x-audiences']).size, operation['x-audiences'].length);
    for (const role of operation['x-audiences']) {
      // Fresh seeds keep cancellation, publication, revocation and rotation independent.
      const audience = await fixture(t, item.n);
      const headers = audience.token('audience', { roles: [role] });
      const result = await audience.dispatch(row.method, urlFor(path, audience.values), body, headers);
      assertSuccess(item, operation, result, audience.values);
    }

    // Authentication and workspace ownership checks must happen before external I/O.
    const denied = async (headers, status, code) => {
      ctx.calls.length = 0;
      const result = await ctx.dispatch(row.method, url, body, headers);
      assert.equal(result.status, status);
      assert.equal(result.body.code, code);
      assert.deepEqual(ctx.calls, []);
    };
    await denied({}, 401, 'UNAUTHENTICATED');
    ctx.setOwner('ten_other');
    await denied(adminHeaders, 403, 'CROSS_TENANT_VIOLATION');
    ctx.setOwner(TEN);
    await denied(ctx.token('other-workspace', { workspaceId: 'ws_other', credentialWorkspaceId: 'ws_other' }), 403, 'FORBIDDEN');
    if ([6, 17, 40, 41, 42, 43].includes(item.n)) {
      for (const role of ['tenant_developer', 'tenant_viewer', 'workspace_developer', 'workspace_viewer']) {
        assert.ok(!operation['x-audiences'].includes(role), `denied role ${role} must not be advertised`);
        await denied(ctx.token('denied-role', { roles: [role] }), 403, 'FORBIDDEN');
      }
    }
    if ([6, 17, 41, 42, 43].includes(item.n)) await denied(ctx.token('empty', { roles: [] }), 403, 'FORBIDDEN');
    for (const field of ['x-family', 'x-scope', 'x-resource-type', 'x-visibility', 'x-audiences', 'x-tenant-binding', 'x-workspace-binding', 'security']) assert.ok(operation[field], `${row.operationId}: ${field}`);
    assert.match(operation.responses['401'].description, /UNAUTHENTICATED/);
    assert.match(operation.responses['403'].description, /CROSS_TENANT_VIOLATION/);
    assert.match(operation.responses['403'].description, /FORBIDDEN/);
    for (const status of ['401', '403']) assert.equal(operation.responses[status].content['application/json'].schema.$ref, '#/components/schemas/ErrorResponse');
  });
}

for (const invalid of [
  { n: 6, body: { definition: { nodes: 'invalid' } }, status: 400, code: 'FLOW_DEFINITION_INVALID' },
  { n: 37, body: { rows: [] }, status: 400, code: 'PLAN_REJECTED' },
  { n: 41, body: { keyType: 'root' }, status: 400, code: 'INVALID_KEY_TYPE' },
]) {
  test(`row ${invalid.n}: its family rejects an invalid body through HTTP`, async t => {
    const row = rows.find(r => r.n === invalid.n);
    const { path } = openapiRoutes(document).find(r => routeKey(r) === routeKey(row));
    const ctx = await fixture(t, invalid.n);
    const response = await ctx.dispatch(row.method, urlFor(path, ctx.values), invalid.body);
    assert.equal(response.status, invalid.status);
    assert.equal(response.body.code, invalid.code);
  });
}

test('row 37 reuses the bulk request schema and has its own concrete response contract', () => {
  const alias = openapiRoutes(document).find(r => r.operation.operationId === 'bulkInsertPostgresRows').operation;
  const original = openapiRoutes(document).find(r => r.operation.operationId === 'bulkInsertPostgresDataRows').operation;
  assert.deepEqual(alias.requestBody.content['application/json'].schema, original.requestBody.content['application/json'].schema);
  const schema = alias.responses['201'].content['application/json'].schema;
  assert.notDeepEqual(schema, original.responses['201'].content['application/json'].schema);
  const check = validator(schema);
  for (const value of [
    { affected: 1, access: {} },
    { items: [], affected: -1, access: { reason: 'grant_only', rlsEnforced: false, rowPredicateRequired: false } },
    { items: [], affected: 0, access: {} },
    { items: [false], affected: 1, access: { reason: 'grant_only', rlsEnforced: false, rowPredicateRequired: false } },
  ]) assert.equal(check(value), false, 'reject malformed alias responses');
});
