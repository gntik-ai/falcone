import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../../packages/internal-contracts/src');
const SCHEMA_PATH = resolve(SRC, 'flow-definition.json');
const FIXTURE_DIR = resolve(SRC, 'fixtures/flows');

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const mapping = JSON.parse(readFileSync(resolve(SRC, 'flow-definition-mapping.json'), 'utf8'));

function compile() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  return ajv.compile(schema);
}

function errorsFor(doc) {
  const validate = compile();
  validate(doc);
  return validate.errors ?? [];
}

function validDoc(overrides = {}) {
  return {
    apiVersion: 'v1.0',
    name: 'contract-flow',
    nodes: [{ id: 'n1', type: 'task', taskType: 'noop' }],
    ...overrides
  };
}

test('flow-definition: schema artifact exposes the expected identity fields', () => {
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.$id, 'flow-definition');
  assert.deepEqual(schema.required.includes('apiVersion'), true);
  assert.deepEqual(schema.required.includes('name'), true);
  assert.deepEqual(schema.required.includes('nodes'), true);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.apiVersion.enum, ['v1.0']);
});

test('flow-definition: all example fixtures validate with zero errors', () => {
  const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(fixtures.length >= 5, `expected at least five fixtures, found ${fixtures.length}`);
  for (const file of fixtures) {
    const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'));
    const validate = compile();
    const ok = validate(doc);
    assert.equal(ok, true, `${file} should validate, errors: ${JSON.stringify(validate.errors)}`);
  }
});

test('flow-definition: each named fixture is present', () => {
  const names = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  for (const expected of ['minimal-3-node.json', 'branch-retry.json', 'parallel-fan-out.json', 'human-approval.json', 'sub-flow-ref.json']) {
    assert.ok(names.includes(expected), `missing fixture ${expected}`);
  }
});

test('flow-definition: document missing apiVersion fails with a required violation', () => {
  const { apiVersion, ...rest } = validDoc();
  void apiVersion;
  const errors = errorsFor(rest);
  assert.ok(
    errors.some((e) => e.keyword === 'required' && e.params.missingProperty === 'apiVersion'),
    JSON.stringify(errors)
  );
});

test('flow-definition: document with apiVersion v99.0 fails with an enum violation', () => {
  const errors = errorsFor(validDoc({ apiVersion: 'v99.0' }));
  assert.ok(
    errors.some((e) => e.keyword === 'enum' && e.instancePath === '/apiVersion'),
    JSON.stringify(errors)
  );
});

test('flow-definition: node missing id fails with a required violation referencing id', () => {
  const errors = errorsFor(validDoc({ nodes: [{ type: 'task', taskType: 'noop' }] }));
  assert.ok(
    errors.some((e) => e.keyword === 'required' && e.params.missingProperty === 'id'),
    JSON.stringify(errors)
  );
});

test('flow-definition: node of type loop fails with an enum violation on type', () => {
  const errors = errorsFor(validDoc({ nodes: [{ id: 'n1', type: 'loop' }] }));
  assert.ok(
    errors.some((e) => e.keyword === 'enum' && e.instancePath === '/nodes/0/type'),
    JSON.stringify(errors)
  );
});

test('flow-definition: unknown top-level field fails with an additionalProperties violation', () => {
  const errors = errorsFor(validDoc({ unknownField: true }));
  assert.ok(
    errors.some((e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'unknownField'),
    JSON.stringify(errors)
  );
});

test('flow-definition: trigger with unknown kind fails with an enum violation', () => {
  const errors = errorsFor(validDoc({ triggers: [{ kind: 'timer' }] }));
  assert.ok(
    errors.some((e) => e.keyword === 'enum' && e.instancePath === '/triggers/0/kind'),
    JSON.stringify(errors)
  );
});

test('flow-definition: input with unsupported type fails with an enum violation', () => {
  const errors = errorsFor(validDoc({ inputs: { startDate: { type: 'date' } } }));
  assert.ok(
    errors.some((e) => e.keyword === 'enum' && e.instancePath === '/inputs/startDate/type'),
    JSON.stringify(errors)
  );
});

test('flow-definition: sub-flow node missing flowVersion fails with a required violation', () => {
  const errors = errorsFor(validDoc({ nodes: [{ id: 'n1', type: 'sub-flow', flowId: 'child' }] }));
  assert.ok(
    errors.some((e) => e.keyword === 'required' && e.params.missingProperty === 'flowVersion'),
    JSON.stringify(errors)
  );
});

test('flow-definition: valid cron trigger and parallel/branches node validate', () => {
  const cron = compile()(validDoc({ triggers: [{ kind: 'cron', schedule: '0 9 * * 1-5' }] }));
  assert.equal(cron, true);

  const parallel = compile()(validDoc({
    nodes: [
      { id: 'p1', type: 'parallel', branches: ['a', 'b'] },
      { id: 'a', type: 'task', taskType: 't' },
      { id: 'b', type: 'task', taskType: 't' }
    ]
  }));
  assert.equal(parallel, true);
});

test('flow-definition: canvasMetadata is optional and free-form', () => {
  assert.equal(compile()(validDoc()), true);
  assert.equal(compile()(validDoc({ canvasMetadata: { nodes: { n1: { x: 1, y: 2 } }, zoom: 1.5 } })), true);
});

test('flow-definition-mapping: carries all nine error codes bound to the schema', () => {
  assert.equal(mapping.schemaId, schema.$id);
  const codes = mapping.errorCodes.map((e) => e.code);
  for (let n = 1; n <= 9; n += 1) {
    assert.ok(codes.includes(`FLW-E00${n}`), `mapping missing FLW-E00${n}`);
  }
});

test('flow-definition-mapping: Temporal mapping covers task->RetryPolicy and approval->signal', () => {
  const byDsl = new Map(mapping.temporalMapping.map((row) => [row.dsl, row.temporal]));
  assert.match(byDsl.get('task+retryPolicy'), /per-activity RetryPolicy/i);
  assert.match(byDsl.get('approval'), /signal/i);
  assert.match(byDsl.get('sub-flow'), /child workflow/i);
  assert.match(byDsl.get('trigger.cron'), /Schedule/i);
});

test('flow-definition-mapping: evolution policy pins the current apiVersion enum', () => {
  assert.deepEqual(mapping.evolutionPolicy.currentVersions, schema.properties.apiVersion.enum);
  assert.equal(mapping.evolutionPolicy.versionField, 'apiVersion');
  assert.ok(mapping.evolutionPolicy.rules.length >= 3);
});

test('flow-definition-mapping: expression engine records CEL/cel-js per ADR-11', () => {
  assert.equal(mapping.expressionEngine.language, 'CEL');
  assert.equal(mapping.expressionEngine.implementation, 'cel-js');
  assert.equal(mapping.expressionEngine.adr, 'ADR-11');
});
