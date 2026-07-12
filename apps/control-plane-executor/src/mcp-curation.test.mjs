// Unit tests for MCP tool curation + publish gate (change add-mcp-tool-curation, #393).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCuration, publishManifest, isConnectable, previewToolList } from './mcp-curation.mjs';
import { generateInstantManifest } from './mcp-instant-generator.mjs';

const draft = (tools) => ({ serverId: 'srv', status: 'draft', requiresCuration: true, tools });

test('applyCuration: disabled tools excluded; description + scope overrides applied', () => {
  const d = draft([
    { name: 'query_orders', description: 'old', mutates: false, suggestedScope: null },
    { name: 'insert_orders', description: 'old', mutates: true, suggestedScope: 'mcp:srv:write:table:orders' },
    { name: 'delete_orders', description: 'danger', mutates: true, suggestedScope: 'mcp:srv:write:table:orders' },
  ]);
  const curated = applyCuration(d, { decisions: {
    delete_orders: { enabled: false },
    query_orders: { description: 'List orders for this tenant.' },
    insert_orders: { scope: 'mcp:srv:orders:create' },
  } });
  assert.equal(curated.status, 'curated');
  assert.equal(curated.requiresCuration, false);
  assert.deepEqual(curated.tools.map((t) => t.name), ['query_orders', 'insert_orders']); // delete dropped
  assert.equal(curated.tools[0].description, 'List orders for this tenant.');
  assert.equal(curated.tools[0].scope, null); // read tool: no scope
  assert.equal(curated.tools[1].scope, 'mcp:srv:orders:create'); // curator scope wins
  assert.deepEqual(curated.violations, []);
});

test('applyCuration: enabled mutating tool with no scope is a violation', () => {
  const curated = applyCuration(draft([{ name: 'wipe', description: 'x', mutates: true, suggestedScope: null }]));
  assert.ok(curated.violations.some((v) => v.code === 'mutating_tool_without_scope' && v.tool === 'wipe'));
});

test('publishManifest: refused on violation, refused on zero enabled, allowed when clean', () => {
  // violation: mutating without scope
  const c1 = applyCuration(draft([{ name: 'm', mutates: true, suggestedScope: null, description: 'x' }]));
  assert.equal(publishManifest(c1).ok, false);
  // zero enabled
  const c2 = applyCuration(draft([{ name: 'r', mutates: false, suggestedScope: null, description: 'x' }]), { decisions: { r: { enabled: false } } });
  assert.equal(publishManifest(c2).ok, false);
  assert.ok(publishManifest(c2).violations.some((v) => v.code === 'no_enabled_tools'));
  // clean
  const c3 = applyCuration(draft([{ name: 'r', mutates: false, suggestedScope: null, description: 'read tool' }, { name: 'w', mutates: true, suggestedScope: 'mcp:srv:write', description: 'write tool' }]));
  const pub = publishManifest(c3);
  assert.equal(pub.ok, true);
  assert.equal(pub.manifest.status, 'published');
});

test('publishManifest: a non-curated (draft) manifest cannot be published', () => {
  const res = publishManifest(draft([{ name: 'r', mutates: false, description: 'x' }]));
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === 'not_curated'));
});

test('isConnectable: only a published manifest is connectable', () => {
  const d = draft([{ name: 'r', mutates: false, suggestedScope: null, description: 'read' }]);
  assert.equal(isConnectable(d), false);                 // draft
  const c = applyCuration(d);
  assert.equal(isConnectable(c), false);                 // curated, not published
  assert.equal(isConnectable(publishManifest(c).manifest), true); // published
});

test('end-to-end with #392: generated draft is not connectable until curated + published', () => {
  const gen = generateInstantManifest('srv', {
    postgres: { database: 'app', name: 'public', tables: [{ name: 't', columns: [{ name: 'id', type: 'int' }] }] },
  });
  assert.equal(isConnectable(gen), false); // #392 draft never connectable
  const curated = applyCuration(gen); // keep all; suggestedScope on insert_t carries through
  const pub = publishManifest(curated);
  assert.equal(pub.ok, true);
  assert.equal(isConnectable(pub.manifest), true);
  const preview = previewToolList(pub.manifest);
  assert.ok(preview.find((t) => t.name === 'insert_t' && t.mutates === true && t.scope));
  assert.ok(preview.find((t) => t.name === 'query_t' && t.mutates === false));
});
