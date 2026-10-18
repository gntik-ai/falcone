// add-llm-agent-flow-task (#640) — task-type catalog + gateway-route contract.
//
// Pins the cross-module contract: the Temporal-free descriptor catalog (consumed by the console
// palette + the validate endpoint's FLW-E006) agrees with the canonical name list and carries a
// well-formed llm.complete descriptor; and the APISIX gateway forwards the LLM subpaths to the
// executor (else they 404 NO_ROUTE on the control-plane).
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildTaskTypeCatalog, TASK_TYPE_DESCRIPTORS } from '../../apps/control-plane-executor/src/runtime/flow-task-types.mjs';
import { TASK_TYPE_NAMES } from '../../apps/workflow-worker/src/activities/catalog-names.mjs';
import { llmCompleteInputSchema } from '../../apps/workflow-worker/src/activities/llm-complete.mjs';
import Ajv from 'ajv';

test('ctr-llm-cat-01: llm.complete is present in both the canonical names and the descriptor catalog', () => {
  assert.ok(TASK_TYPE_NAMES.includes('llm.complete'), 'canonical name list includes llm.complete');
  assert.ok(TASK_TYPE_DESCRIPTORS.some((d) => d.id === 'llm.complete'), 'descriptor catalog includes llm.complete');
});

test('ctr-llm-cat-02: buildTaskTypeCatalog() holds its id-set invariant and emits a usable llm descriptor', () => {
  const catalog = buildTaskTypeCatalog(); // throws if descriptor ids drift from TASK_TYPE_NAMES
  const llm = catalog.find((d) => d.id === 'llm.complete');
  assert.ok(llm, 'catalog lists llm.complete');
  assert.equal(llm.category, 'ai');
  assert.equal(llm.inputSchema.type, 'object');
  assert.deepEqual(llm.inputSchema.required, ['model']);
  assert.equal(typeof llm.inputSchema.properties.messages, 'object');
});

test('ctr-llm-cat-03: APISIX routes the LLM subpaths to the executor', () => {
  const src = readFileSync(fileURLToPath(new URL('../../deploy/kind/apisix/apisix.yaml', import.meta.url)), 'utf8');
  const idx = src.indexOf('2003-llm');
  assert.ok(idx > -1, 'a dedicated 2003-llm route exists in apisix.yaml');
  const block = src.slice(idx, idx + 800);
  assert.match(block, /llm-provider\|llm\/completions\|llm-usage/, 'route matches the three LLM subpaths');
  assert.match(block, /falcone-control-plane-executor/, 'route forwards to the executor, not the control-plane');
});

test('both llm.complete catalogs accept only a literal optional JSON-schema responseFormat', () => {
  const descriptor = buildTaskTypeCatalog().find(item => item.id === 'llm.complete').inputSchema;
  const expected = {
    type: 'object', required: ['type', 'name', 'schema'],
    properties: { type: { const: 'json_schema' }, name: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }, schema: { type: 'object' } },
    additionalProperties: false,
  };
  for (const schema of [descriptor, llmCompleteInputSchema]) {
    assert.deepEqual(schema.properties.responseFormat, expected);
    const validate = new Ajv({ strict: false }).compile(schema);
    const responseFormat = { type: 'json_schema', name: 'answer', schema: { type: 'object' } };
    assert.equal(validate({ model: 'fixture-model' }), true);
    assert.equal(validate({ model: 'fixture-model', responseFormat }), true);
    for (const invalid of [{ ...responseFormat, strict: true }, { ...responseFormat, name: 'bad.name' }, { ...responseFormat, schema: [] }, '${input.schema}']) {
      assert.equal(validate({ model: 'fixture-model', responseFormat: invalid }), false);
    }
  }
});

test('both llm.complete catalogs accept only the optional literal system promptCache', () => {
  const descriptor = buildTaskTypeCatalog().find(item => item.id === 'llm.complete').inputSchema;
  for (const schema of [descriptor, llmCompleteInputSchema]) {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.promptCache, { type: 'string', enum: ['system'] });
    const validate = new Ajv({ strict: false }).compile(schema);
    assert.equal(validate({ model: 'fixture-model' }), true);
    assert.equal(validate({ model: 'fixture-model', promptCache: 'system' }), true);
    for (const invalid of [null, false, 0, '', 'all', ['system'], {}, '${input.cache}']) {
      assert.equal(validate({ model: 'fixture-model', promptCache: invalid }), false);
    }
  }
});

test('both llm.complete catalogs accept the same optional literal connectionId', () => {
  const descriptor = buildTaskTypeCatalog().find(item => item.id === 'llm.complete').inputSchema;
  assert.deepEqual(descriptor, llmCompleteInputSchema);
  for (const schema of [descriptor, llmCompleteInputSchema]) {
    assert.deepEqual(schema.required, ['model']);
    assert.deepEqual(schema.properties.connectionId, { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$' });
    const validate = new Ajv({ strict: false }).compile(schema);
    assert.equal(validate({ model: 'fixture-model' }), true);
    for (const connectionId of ['anthropic-main', 'a', 'a'.repeat(63)]) {
      assert.equal(validate({ model: 'fixture-model', connectionId }), true);
    }
    for (const connectionId of [null, false, 1, {}, [], '', 'Bad', '-bad', 'bad_id', 'a'.repeat(64), '${input.connection}']) {
      assert.equal(validate({ model: 'fixture-model', connectionId }), false);
    }
  }
});

test('llm.batch has the same bounded literal input schema in the descriptor and worker registry', async () => {
  assert.ok(TASK_TYPE_NAMES.includes('llm.batch'));
  const { resolveActivity } = await import('../../apps/workflow-worker/src/activities/catalog.mjs');
  const { llmBatchInputSchema } = await import('../../apps/workflow-worker/src/activities/llm-batch.mjs');
  const descriptor = buildTaskTypeCatalog().find(d => d.id === 'llm.batch');
  assert.equal(descriptor.category, 'ai');
  assert.deepEqual(descriptor.inputSchema, llmBatchInputSchema);
  assert.deepEqual(resolveActivity('llm.batch').inputSchema, llmBatchInputSchema);
  const validate = new Ajv({ strict: false }).compile(llmBatchInputSchema);
  const valid = { model: 'fixture-model', items: [{ customId: 'one', prompt: 'hello' }] };
  assert.equal(validate(valid), true);
  for (const invalid of [{ ...valid, workspaceId: 'foreign' }, { ...valid, items: [] },
    { ...valid, items: Array(1001).fill(valid.items[0]) }, { ...valid, items: [{ customId: 'bad.id', prompt: 'x' }] },
    { ...valid, items: [{ ...valid.items[0], extra: true }] }, { ...valid, pollSeconds: 29 },
    { ...valid, pollSeconds: 601 }, { ...valid, maxWaitSeconds: 59 }, { ...valid, maxWaitSeconds: 82801 }]) {
    assert.equal(validate(invalid), false);
  }
});

// Pin the existing descriptor bytes from immutable base 4a93293 (#1185 replay contract).
test('llm.complete descriptor remains byte-for-byte unchanged', () => {
  const source = readFileSync(new URL('../../apps/control-plane-executor/src/runtime/flow-task-types.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("  {\n    id: 'llm.complete'");
  const end = source.indexOf('\n  },', start) + 6;
  assert.equal(createHash('sha256').update(source.slice(start, end)).digest('hex'), '9c7f14588dcab3b96530d2c9067254e0b0a727cf55bb54c76ef2bfc037babffd');
});
