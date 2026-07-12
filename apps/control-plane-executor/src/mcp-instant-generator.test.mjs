// Unit tests for the Instant MCP generator (change add-mcp-instant-generator, #392).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFromPostgresSchema, generateFromFunctions, generateFromStorage, generateFromEvents,
  generateFromFlows, generateInstantManifest,
} from './mcp-instant-generator.mjs';

const SCHEMA = {
  database: 'app', name: 'public',
  tables: [
    { name: 'orders', columns: [{ name: 'id', type: 'bigint' }, { name: 'total', type: 'numeric' }, { name: 'paid', type: 'boolean' }, { name: 'meta', type: 'jsonb' }, { name: 'note', type: 'text' }] },
    { name: 'customers', columns: [{ name: 'id', type: 'uuid' }, { name: 'name', type: 'text' }] },
  ],
};

test('postgres: read query_<table> + mutating insert_<table>, RLS-bound data path, column-derived schema', () => {
  const tools = generateFromPostgresSchema('srv', SCHEMA);
  const q = tools.find((t) => t.name === 'query_orders');
  assert.equal(q.mutates, false);
  assert.equal(q.suggestedScope, null);
  // The real executor data-rows route ends in /rows (server.mjs `${data}/rows`); the base without
  // it matches no route and would fall through to the executor index (#565).
  assert.match(q.path, /^\/v1\/postgres\/workspaces\/\{workspaceId\}\/data\/app\/schemas\/public\/tables\/orders\/rows$/);
  assert.equal(q.method, 'GET');
  const ins = tools.find((t) => t.name === 'insert_orders');
  assert.equal(ins.mutates, true);
  assert.equal(ins.method, 'POST');
  assert.match(ins.path, /\/tables\/orders\/rows$/);
  assert.equal(ins.suggestedScope, 'mcp:srv:write:table:orders');
  // column types mapped
  const props = ins.inputSchema.properties.row.properties;
  assert.equal(props.total.type, 'number');
  assert.equal(props.paid.type, 'boolean');
  assert.equal(props.meta.type, 'object');
  assert.equal(props.note.type, 'string');
});

test('functions / storage / events generators produce the expected tools (real executor routes)', () => {
  const fns = generateFromFunctions('srv', [{ id: 'fn1', name: 'resize' }]);
  assert.equal(fns[0].name, 'invoke_resize');
  // Real executor route: invoke by ACTION NAME under the workspace prefix (server.mjs
  // `${fn}/([^/]+)/invocations`). The old /v1/functions/<id>/invoke matched no route (#565).
  assert.equal(fns[0].path, '/v1/functions/workspaces/{workspaceId}/actions/resize/invocations');
  assert.equal(fns[0].mutates, true);

  const st = generateFromStorage('srv', [{ name: 'media' }]);
  assert.deepEqual(st.map((t) => t.name).sort(), ['delete_object_media', 'get_object_media', 'put_object_media']);
  assert.equal(st.find((t) => t.name === 'get_object_media').mutates, false);
  assert.equal(st.find((t) => t.name === 'delete_object_media').mutates, true);
  // Real wired storage route (route catalog, #500): /v1/storage/buckets/{bucketId}/objects/{objectKey}.
  for (const t of st) assert.match(t.path, /^\/v1\/storage\/buckets\/media\/objects\/\{objectKey\}$/);

  const ev = generateFromEvents('srv', [{ name: 'orders.created' }]);
  const pub = ev.find((t) => t.name === 'publish_event');
  assert.ok(pub && pub.mutates === true);
  // Real executor event route: workspace-scoped, topic as a path segment (server.mjs `${evt}`).
  assert.equal(pub.path, '/v1/events/workspaces/{workspaceId}/topics/{topic}/publish');
  const cons = ev.find((t) => t.name === 'consume_events');
  assert.ok(cons && cons.mutates === false);
  assert.equal(cons.path, '/v1/events/workspaces/{workspaceId}/topics/{topic}/messages');
});

test('flows generator: published flows → long-running run_flow_<flow> tools (real executions route)', () => {
  const flows = generateFromFlows('srv', [{ id: 'flw_1', name: 'Nightly Report' }]);
  assert.equal(flows.length, 1);
  const t = flows[0];
  assert.equal(t.name, 'run_flow_nightly-report');
  assert.equal(t.mutates, true);
  assert.equal(t.longRunning, true);
  assert.equal(t.method, 'POST');
  assert.equal(t.path, '/v1/flows/workspaces/{workspaceId}/flows/flw_1/executions');
  // The mapper emits `scope`; the generator mirrors it onto suggestedScope so curation keeps it.
  assert.equal(t.suggestedScope, 'mcp:flows:run:nightly-report');
  assert.equal(t.source.type, 'flow');
});

test('manifest is ALWAYS a draft requiring curation; never published', () => {
  const m = generateInstantManifest('srv', { postgres: SCHEMA, functions: [{ id: 'f', name: 'go' }], storage: [{ name: 'b' }], events: [{ name: 't' }] });
  assert.equal(m.status, 'draft');
  assert.equal(m.requiresCuration, true);
  assert.deepEqual(m.generatedFrom.sort(), ['events', 'functions', 'postgres', 'storage']);
  assert.ok(m.tools.length > 0);
  // every tool described + classified; mutating tools carry a suggested scope
  for (const t of m.tools) {
    assert.ok(t.description && t.description.length >= 20);
    assert.equal(typeof t.mutates, 'boolean');
    if (t.mutates) assert.ok(t.suggestedScope && t.suggestedScope.startsWith('mcp:srv:write:'));
  }
});

test('generation is deterministic / idempotent (same input -> identical manifest)', () => {
  const a = generateInstantManifest('srv', { postgres: SCHEMA, storage: [{ name: 'b' }, { name: 'a' }] });
  const b = generateInstantManifest('srv', { postgres: SCHEMA, storage: [{ name: 'a' }, { name: 'b' }] });
  assert.deepEqual(a, b);
  // tools are sorted by name
  assert.deepEqual([...a.tools].map((t) => t.name), [...a.tools].map((t) => t.name).sort());
});

test('empty resources -> still a draft, no tools', () => {
  const m = generateInstantManifest('srv', {});
  assert.equal(m.status, 'draft');
  assert.equal(m.requiresCuration, true);
  assert.equal(m.tools.length, 0);
});
