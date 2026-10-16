import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import Ajv from 'ajv/dist/2020.js';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';
import { createFlowMonitoringExecutor } from '../../apps/control-plane-executor/src/runtime/flow-monitoring-executor.mjs';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';
import { openapiRoutes, routeKey } from './helpers/console-publication.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');
const rows = read('tests/contracts/fixtures/gateway-only-reconciled.json').rows;
const operations = openapiRoutes(document);
const tenantId = 'ten_contract';
const workspaceId = 'ws_contract';
const flowId = 'flow-contract';
const flows = `/v1/flows/workspaces/${workspaceId}/flows`;
const keys = `/v1/workspaces/${workspaceId}/api-keys`;
const table = `/v1/postgres/workspaces/${workspaceId}/data/appdb/schemas/public/tables/docs`;
const definition = { apiVersion: 'v1.0', name: 'Contract flow',
  triggers: [{ kind: 'cron', schedule: '*/5 * * * *' }],
  nodes: [{ id: 'review', type: 'approval', approvers: ['role:workspace_admin'], timeout: 'P2D' }] };
const cases = [
  { n: 2, status: 200 },
  { n: 5, status: 200 },
  { n: 6, status: 200, body: { name: 'Renamed' } },
  { n: 7, status: 200 },
  { n: 8, status: 200 },
  { n: 9, status: 202 },
  { n: 10, status: 201 },
  { n: 11, status: 202, body: { approved: true } },
  { n: 12, status: 200 },
  { n: 13, status: 200 },
  { n: 14, status: 200 },
  { n: 15, status: 202 },
  { n: 16, status: 200 },
  { n: 17, status: 201 },
  { n: 18, status: 200 },
  { n: 19, status: 200 },
  { n: 37, status: 201, body: { rows: [{ id: 2, body: 'inserted' }] } },
  { n: 40, status: 200 },
  { n: 41, status: 201, body: { keyType: 'service', scopes: ['data:read'] } },
  { n: 42, status: 200 },
  { n: 43, status: 201 },
];
function validator(schema) {
  assert.ok(schema, 'a concrete schema must be published');
  return new Ajv({ strict: false, validateFormats: false }).compile({ ...schema, components: document.components });
}
function validate(schema, value) {
  const check = validator(schema);
  assert.ok(check(value), JSON.stringify(check.errors));
}
function operationFor(row) {
  const matches = operations.filter(op => routeKey(op) === routeKey(row));
  assert.equal(matches.length, 1, `row ${row.n} must have one published operation`);
  assert.equal(matches[0].operation.operationId, row.operationId);
  return matches[0];
}

// Only external I/O is replaced. These fakes retain state seeded through public HTTP routes.
function externalIo() {
  const calls = [];
  const workflows = new Map();
  const schedules = new Map();
  const apiKeys = new Map();
  const dataRows = [];
  const history = [{ eventId: 5, activityTaskScheduledEventAttributes: { activityId: 'review' } }];
  const record = name => calls.push(name);
  function workflowHandle(id) {
    const state = workflows.get(id);
    assert.ok(state, 'workflow must be seeded');
    return {
      firstExecutionRunId: state.runId,
      async describe() { record('workflow.describe'); return { status: { name: state.status }, searchAttributes: state.searchAttributes }; },
      async fetchHistory() { record('workflow.history'); return { events: history }; },
      async cancel() { record('workflow.cancel'); state.status = 'Cancelled'; },
      async signal(name, payload) { record('workflow.signal'); state.signals.push({ name, payload }); },
    };
  }
  function scheduleHandle(id) {
    return {
      async describe() { record('schedule.describe'); return { scheduleId: id, ...structuredClone(schedules.get(id)) }; },
      async pause(note) { record('schedule.pause'); Object.assign(schedules.get(id).state, { paused: true, note }); },
      async unpause(note) { record('schedule.unpause'); Object.assign(schedules.get(id).state, { paused: false, note }); },
      async trigger() { record('schedule.trigger'); schedules.get(id).info.recentActions.push({ scheduledAt: '2026-10-15T00:00:00Z', takenAt: '2026-10-15T00:00:00Z' }); },
      async update(fn) { record('schedule.update'); schedules.set(id, fn(schedules.get(id))); },
    };
  }
  const temporal = {
    workflow: {
      async start(_type, opts) {
        record('workflow.start');
        workflows.set(opts.workflowId, { runId: 'run-contract', status: 'Running', searchAttributes: opts.searchAttributes, signals: [] });
        return workflowHandle(opts.workflowId);
      },
      getHandle: workflowHandle,
      async *list() {
        record('workflow.list');
        for (const [workflowId, state] of workflows) yield { workflowId, runId: state.runId, status: { name: state.status } };
      },
    },
    schedule: {
      async create(opts) {
        record('schedule.create');
        if (schedules.has(opts.scheduleId)) throw new Error('already exists');
        schedules.set(opts.scheduleId, { spec: opts.spec, state: { paused: false, note: null }, info: { nextActionTimes: ['2026-10-16T00:00:00Z'], recentActions: [] } });
        return scheduleHandle(opts.scheduleId);
      },
      getHandle: scheduleHandle,
      async *list() { record('schedule.list'); for (const [scheduleId, state] of schedules) yield { scheduleId, ...structuredClone(state) }; },
    },
  };
  const historyProvider = {
    async describe(id) { record('history.describe'); assert.ok(workflows.has(id)); return { status: { name: 'Completed' } }; },
    async fetchHistory(id) { record('history.fetch'); assert.ok(workflows.has(id)); return { events: history }; },
    isTerminal: status => status === 'Completed',
  };
  const pool = { async query(sql, params) {
    record('api-key.query');
    if (sql.startsWith('INSERT')) {
      const [tenant_id, workspace_id, key_type, key_prefix, , scopes] = params;
      const id = `key-${apiKeys.size + 1}`;
      const row = { id, tenant_id, workspace_id, key_type, key_prefix, scopes, status: 'active', created_at: '2026-10-15T00:00:00Z', last_used_at: null };
      apiKeys.set(id, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith('SELECT')) {
      const result = sql.includes('WHERE id =') ? [apiKeys.get(params[0])].filter(Boolean)
        : [...apiKeys.values()].filter(row => row.workspace_id === params[0]);
      return { rows: result, rowCount: result.length };
    }
    if (sql.startsWith('UPDATE')) {
      const row = apiKeys.get(params[0]);
      if (row) row.status = 'revoked';
      return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error('Unexpected API key SQL');
  } };
  const client = { async query(sql, params) {
    record('postgres.query');
    if (sql.includes('information_schema.columns')) return { rows: [
      { column_name: 'id', data_type: 'integer', udt_name: 'int4' },
      { column_name: 'body', data_type: 'text', udt_name: 'text' },
    ], rowCount: 2 };
    if (sql.includes('FROM pg_index')) return { rows: [{ column_name: 'id' }], rowCount: 1 };
    if (sql.includes('set_config') || /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
    if (/^INSERT/.test(sql)) {
      const inserted = [];
      for (let i = 0; i < params.length; i += 2) inserted.push({ id: params[i], body: params[i + 1] });
      dataRows.push(...inserted);
      return { rows: inserted, rowCount: inserted.length };
    }
    if (/^SELECT/.test(sql)) return { rows: [...dataRows], rowCount: dataRows.length };
    throw new Error('Unexpected PostgreSQL SQL');
  } };
  const registry = {
    async withWorkspaceClient(_workspace, _identity, fn) { record('postgres.connect'); return fn(client); },
    async withAdminClient(_workspace, fn) { record('postgres.admin'); return fn(client); },
  };
  return { calls, temporal, historyProvider, pool, registry };
}

async function harness() {
  const io = externalIo();
  const flowTriggerRegistry = createFlowTriggerRegistry({ temporalClient: io.temporal });
  const flowExecutor = createFlowExecutor({ temporalClient: io.temporal, flowTriggerRegistry, logger: { error() {} } });
  const flowMonitoringExecutor = createFlowMonitoringExecutor({ workflowHistoryProvider: io.historyProvider });
  const apiKeyStore = createApiKeyStore({ pool: io.pool });
  async function request(method, path, body, { credential = 'tenant_admin', foreignTenant = false, boundWorkspace = workspaceId } = {}) {
    const server = createControlPlaneServer({ registry: io.registry, flowExecutor, flowMonitoringExecutor, apiKeyStore,
      logger: { error() {} }, resolveWorkspaceTenant: async () => foreignTenant ? 'ten_other' : tenantId,
      // Authentication is an external boundary; workspace binding and authorization run in the real server.
      jwtVerifier: { async verify() { return { tenantId, workspaceId: boundWorkspace, credentialWorkspaceId: boundWorkspace,
        actorId: 'contract-actor', roleName: 'falcone_app', roles: credential ? [credential] : [] }; } } });
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers: { ...(credential === null ? {} : { authorization: 'Bearer synthetic-contract-token' }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) } });
    const chunks = [];
    const headers = {};
    const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.setHeader = (name, value) => { headers[name] = value; };
    res.writeHead = (status, values) => { res.statusCode = status; Object.assign(headers, values); return res; };
    const done = once(res, 'finish');
    await server.listeners('request')[0](req, res);
    await done;
    const raw = Buffer.concat(chunks).toString();
    return { status: res.statusCode, headers, raw, body: headers['content-type']?.startsWith('text/event-stream') ? undefined : JSON.parse(raw) };
  }
  const created = await request('POST', flows, { flowId, name: 'Contract flow', definition });
  assert.equal(created.status, 201);
  const published = await request('POST', `${flows}/${flowId}/versions`);
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const started = await request('POST', `${flows}/${flowId}/executions`, { version: 1 });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const key = await request('POST', keys, { keyType: 'anon', scopes: ['data:read'] });
  assert.equal(key.status, 201);
  const row = await request('POST', `${table}/rows`, { row: { id: 1, body: 'seed' } });
  assert.equal(row.status, 201, JSON.stringify(row.body));
  const values = { workspaceId, flowId, executionId: started.body.executionId, signalName: 'review', databaseName: 'appdb', schemaName: 'public', tableName: 'docs', keyId: key.body.id };
  return { request, io, values, async close() { await flowExecutor.close(); await flowMonitoringExecutor.close?.(); } };
}

for (const scenario of cases) {
  const row = rows.find(row => row.n === scenario.n);
  test(`row ${row.n}: real handler success matches the published request and response`, async () => {
    const { path, operation } = operationFor(row);
    const h = await harness();
    try {
      const url = path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(h.values[name]));
      if (operation.requestBody) validate(operation.requestBody.content['application/json'].schema, scenario.body);
      else assert.equal(scenario.body, undefined, 'bodyless operations send no body');
      const response = await h.request(row.method, url, scenario.body);
      assert.equal(response.status, scenario.status, JSON.stringify(response.body));
      const content = operation.responses[scenario.status]?.content;
      assert.ok(content, 'the success status must be documented');
      if (row.n === 2) {
        assert.match(response.headers['content-type'], /text\/event-stream/);
        assert.ok(response.raw.startsWith('retry: 3000\n\n'));
        const frame = response.raw.split('\n\n').find(block => block.split('\n').some(line => line.startsWith('data: ')));
        const data = JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6));
        assert.equal(data.nodeId, 'review');
        assert.equal(data.type, 'node-status');
        validate(content['text/event-stream'].schema, data);
      } else {
        validate(content['application/json'].schema, response.body);
        if ([7, 18, 19, 40].includes(row.n)) assert.ok(response.body.items.length > 0, 'list must contain seeded data');
        if ([5, 6, 17].includes(row.n)) assert.equal(response.body.flowId, flowId);
        if (row.n === 6) assert.equal(response.body.name, 'Renamed');
        if ([8, 9, 11].includes(row.n)) assert.equal(response.body.executionId, h.values.executionId);
        if ([12, 13, 14, 15].includes(row.n)) assert.equal(response.body.scheduleId, `${tenantId}:${workspaceId}:${flowId}`);
        if (row.n === 13) assert.equal(response.body.paused, true);
        if (row.n === 14) assert.equal(response.body.paused, false);
        if (row.n === 37) assert.deepEqual(response.body.items, [{ id: 2, body: 'inserted' }]);
        if (row.n === 40) assert.equal(response.body.items[0].id, h.values.keyId);
        if (row.n === 42) assert.equal(response.body.id, h.values.keyId);
      }
    } finally { await h.close(); }
  });
}

// Authentication/tenancy/role rejection uses native status and code only. The I/O log
// intentionally excludes JWT verification and ownership resolution, which implement these gates.
for (const scenario of cases) {
  const row = rows.find(row => row.n === scenario.n);
  test(`row ${row.n}: denial matrix stops before external executor I/O`, async () => {
    const { path, operation } = operationFor(row);
    const h = await harness();
    try {
      const url = path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(h.values[name]));
      const denials = [
        { options: { credential: null }, status: 401, code: 'UNAUTHENTICATED' },
        { options: { foreignTenant: true }, status: 403, code: 'CROSS_TENANT_VIOLATION' },
        { options: { boundWorkspace: 'ws_other' }, status: 403, code: 'FORBIDDEN' },
      ];
      if ([6, 17, 40, 41, 42, 43].includes(row.n)) denials.push({ options: { credential: 'tenant_developer' }, status: 403, code: 'FORBIDDEN' });
      if ([41, 42, 43].includes(row.n)) denials.push({ options: { credential: '' }, status: 403, code: 'FORBIDDEN' });
      for (const denial of denials) {
        h.io.calls.length = 0;
        const result = await h.request(row.method, url, scenario.body, denial.options);
        assert.equal(result.status, denial.status);
        assert.equal(result.body.code, denial.code);
        assert.deepEqual(h.io.calls, [], `row ${row.n}: denied request must not reach external I/O`);
      }
      assert.match(operation.responses['401'].description, /UNAUTHENTICATED/);
      assert.match(operation.responses['403'].description, /FORBIDDEN/);
      assert.match(operation.responses['403'].description, /CROSS_TENANT_VIOLATION/);
      for (const status of ['401', '403']) assert.deepEqual(operation.responses[status].content['application/json'].schema, { $ref: '#/components/schemas/ErrorResponse' });
    } finally { await h.close(); }
  });
  test(`row ${row.n}: every advertised audience receives a successful response`, async () => {
    const { path, operation } = operationFor(row);
    assert.ok(operation['x-audiences'].length > 0);
    for (const credential of operation['x-audiences']) {
      const h = await harness();
      try {
        const url = path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(h.values[name]));
        const result = await h.request(row.method, url, scenario.body, { credential });
        assert.equal(result.status, scenario.status, `row ${row.n}: ${credential}`);
      } finally { await h.close(); }
    }
  });
}

test('the success table covers all 21 TO_PUBLISH rows exactly once', () => {
  assert.deepEqual(cases.map(c => c.n).sort((a, b) => a - b), rows.filter(row => row.disposition === 'TO_PUBLISH').map(row => row.n));
});
for (const invalid of [
  { n: 6, body: { definition: { apiVersion: 'unsupported', nodes: [] } }, code: 'FLOW_DEFINITION_INVALID' },
  { n: 37, body: { rows: [] }, code: 'PLAN_REJECTED' },
  { n: 41, body: { keyType: 'invalid' }, code: 'INVALID_KEY_TYPE' },
]) {
  test(`row ${invalid.n}: family rejects an invalid request body`, async () => {
    const row = rows.find(row => row.n === invalid.n);
    const { path, operation } = operationFor(row);
    // Flow DSL validity is enforced by the executor after the object envelope is decoded.
    if (invalid.n !== 6) assert.equal(validator(operation.requestBody.content['application/json'].schema)(invalid.body), false);
    const h = await harness();
    try {
      const url = path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(h.values[name]));
      const result = await h.request(row.method, url, invalid.body);
      assert.equal(result.status, 400);
      assert.equal(result.body.code, invalid.code);
    } finally { await h.close(); }
  });
}
