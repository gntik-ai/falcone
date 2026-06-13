// Unit tests for the Instant MCP generator (change add-mcp-instant-generator, #392).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFromPostgresSchema, generateFromFunctions, generateFromStorage, generateFromEvents,
  generateInstantManifest,
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
  assert.match(q.path, /^\/v1\/postgres\/workspaces\/\{workspaceId\}\/data\/app\/schemas\/public\/tables\/orders$/);
  const ins = tools.find((t) => t.name === 'insert_orders');
  assert.equal(ins.mutates, true);
  assert.equal(ins.suggestedScope, 'mcp:srv:write:table:orders');
  // column types mapped
  const props = ins.inputSchema.properties.row.properties;
  assert.equal(props.total.type, 'number');
  assert.equal(props.paid.type, 'boolean');
  assert.equal(props.meta.type, 'object');
  assert.equal(props.note.type, 'string');
});

test('functions / storage / events generators produce the expected tools', () => {
  const fns = generateFromFunctions('srv', [{ id: 'fn1', name: 'resize' }]);
  assert.equal(fns[0].name, 'invoke_resize');
  assert.equal(fns[0].path, '/v1/functions/fn1/invoke');
  assert.equal(fns[0].mutates, true);

  const st = generateFromStorage('srv', [{ name: 'media' }]);
  assert.deepEqual(st.map((t) => t.name).sort(), ['delete_object_media', 'get_object_media', 'put_object_media']);
  assert.equal(st.find((t) => t.name === 'get_object_media').mutates, false);
  assert.equal(st.find((t) => t.name === 'delete_object_media').mutates, true);

  const ev = generateFromEvents('srv', [{ name: 'orders.created' }]);
  assert.ok(ev.find((t) => t.name === 'publish_event' && t.mutates === true));
  assert.ok(ev.find((t) => t.name === 'subscribe_events' && t.mutates === false));
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
