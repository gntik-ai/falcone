/**
 * Black-box test suite for OpenSpec change add-flows-dsl-schema.
 *
 * Drives the PUBLIC surface ONLY: the schema artifact and validator API exported from
 * `@in-falcone/internal-contracts` (services/internal-contracts/src/index.mjs). No
 * internal module paths, no private helpers — exactly what the sibling consumers
 * (interpreter worker, control-plane API, console editors) will import.
 *
 * Structural validation is exercised by compiling the exported JSON Schema with AJV
 * (the repo's existing validator dependency). Semantic validation is exercised through
 * the exported validateFlowDefinition() function and its stable FLW-E error codes.
 *
 * Scenario coverage (capability: workflows / spec.md):
 *   bbx-flows-dsl-001  Schema artifact carries the expected identity fields
 *   bbx-flows-dsl-002  Schema rejects a document missing apiVersion
 *   bbx-flows-dsl-003  Schema rejects an unknown apiVersion value (enum)
 *   bbx-flows-dsl-004  Schema rejects unknown top-level properties
 *   bbx-flows-dsl-005  Valid cron trigger passes; unknown trigger kind rejected
 *   bbx-flows-dsl-006  Input parameter with unsupported type is rejected
 *   bbx-flows-dsl-007  Task node with retryPolicy passes; node missing id rejected
 *   bbx-flows-dsl-008  Node with unknown type rejected (enum on /type)
 *   bbx-flows-dsl-009  Sub-flow node requires flowId and flowVersion
 *   bbx-flows-dsl-010  Parallel node with a branches array passes
 *   bbx-flows-dsl-011  canvasMetadata round-trips and is optional
 *   bbx-flows-dsl-012  All five example fixtures validate against the schema
 *   bbx-flows-dsl-013  Duplicate node IDs produce FLW-E001
 *   bbx-flows-dsl-014  Cyclic edge produces FLW-E002
 *   bbx-flows-dsl-015  Dangling edge reference produces FLW-E003
 *   bbx-flows-dsl-016  A well-formed flow returns an empty error list
 *   bbx-flows-dsl-017  Validator surfaces every FLW-E code via FLOW_VALIDATION_ERROR_CODES
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Ajv from 'ajv';

import {
  flowDefinitionSchema,
  FLOW_DEFINITION_SCHEMA_URL,
  validateFlowDefinition,
  FLOW_VALIDATION_ERROR_CODES
} from '../../services/internal-contracts/src/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../../services/internal-contracts/src/fixtures/flows');

function compile() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  return ajv.compile(flowDefinitionSchema);
}

function errorsFor(doc) {
  const validate = compile();
  validate(doc);
  return validate.errors ?? [];
}

function isValid(doc) {
  const validate = compile();
  return validate(doc);
}

function hasError(errors, predicate) {
  return errors.some(predicate);
}

function baseDoc(overrides = {}) {
  return {
    apiVersion: 'v1.0',
    name: 'flow',
    nodes: [{ id: 'n1', type: 'task', taskType: 'noop' }],
    ...overrides
  };
}

test('bbx-flows-dsl-001 schema artifact carries the expected identity fields', () => {
  assert.equal(flowDefinitionSchema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(flowDefinitionSchema.$id, 'flow-definition');
  for (const field of ['apiVersion', 'name', 'nodes']) {
    assert.ok(flowDefinitionSchema.required.includes(field), `top-level required must include ${field}`);
  }
  assert.ok(String(FLOW_DEFINITION_SCHEMA_URL).endsWith('flow-definition.json'));
});

test('bbx-flows-dsl-002 schema rejects a document missing apiVersion', () => {
  const { apiVersion, ...rest } = baseDoc();
  void apiVersion;
  const errors = errorsFor(rest);
  assert.ok(
    hasError(errors, (e) => e.keyword === 'required' && e.params.missingProperty === 'apiVersion'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-003 schema rejects an unknown apiVersion value', () => {
  const errors = errorsFor(baseDoc({ apiVersion: 'v99.0' }));
  assert.ok(
    hasError(errors, (e) => e.keyword === 'enum' && e.instancePath === '/apiVersion'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-004 schema rejects unknown top-level properties', () => {
  const errors = errorsFor(baseDoc({ unknownField: true }));
  assert.ok(
    hasError(errors, (e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'unknownField'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-005 valid cron trigger passes; unknown trigger kind rejected', () => {
  assert.equal(isValid(baseDoc({ triggers: [{ kind: 'cron', schedule: '0 9 * * 1-5' }] })), true);

  const errors = errorsFor(baseDoc({ triggers: [{ kind: 'timer' }] }));
  assert.ok(
    hasError(errors, (e) => e.keyword === 'enum' && e.instancePath === '/triggers/0/kind'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-006 input parameter with unsupported type is rejected', () => {
  const errors = errorsFor(baseDoc({ inputs: { startDate: { type: 'date' } } }));
  assert.ok(
    hasError(errors, (e) => e.keyword === 'enum' && e.instancePath === '/inputs/startDate/type'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-007 task node with retryPolicy passes; node missing id rejected', () => {
  assert.equal(
    isValid(baseDoc({ nodes: [{ id: 'n1', type: 'task', taskType: 'send-email', retryPolicy: { maxAttempts: 3, backoffCoefficient: 2.0 } }] })),
    true
  );

  const errors = errorsFor(baseDoc({ nodes: [{ type: 'task', taskType: 'send-email' }] }));
  assert.ok(
    hasError(errors, (e) => e.keyword === 'required' && e.params.missingProperty === 'id' && e.instancePath === '/nodes/0'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-008 node with unknown type is rejected', () => {
  const errors = errorsFor(baseDoc({ nodes: [{ id: 'n1', type: 'loop' }] }));
  assert.ok(
    hasError(errors, (e) => e.keyword === 'enum' && e.instancePath === '/nodes/0/type'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-009 sub-flow node requires flowId and flowVersion', () => {
  const errors = errorsFor(baseDoc({ nodes: [{ id: 'n1', type: 'sub-flow', flowId: 'child' }] }));
  assert.ok(
    hasError(errors, (e) => e.keyword === 'required' && e.params.missingProperty === 'flowVersion'),
    JSON.stringify(errors)
  );
});

test('bbx-flows-dsl-010 parallel node with a branches array passes', () => {
  assert.equal(
    isValid(baseDoc({
      nodes: [
        { id: 'p1', type: 'parallel', branches: ['a', 'b'] },
        { id: 'a', type: 'task', taskType: 't' },
        { id: 'b', type: 'task', taskType: 't' }
      ]
    })),
    true
  );
});

test('bbx-flows-dsl-011 canvasMetadata round-trips and is optional', () => {
  const withMeta = baseDoc({ canvasMetadata: { nodes: { n1: { x: 100, y: 200 } } } });
  assert.equal(isValid(withMeta), true);
  // Round-trips verbatim through serialisation.
  const roundTripped = JSON.parse(JSON.stringify(withMeta));
  assert.deepEqual(roundTripped.canvasMetadata, { nodes: { n1: { x: 100, y: 200 } } });

  assert.equal(isValid(baseDoc()), true, 'document without canvasMetadata is still valid');
});

test('bbx-flows-dsl-012 all five example fixtures validate against the schema', () => {
  const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(fixtures.length >= 5, `expected at least five fixtures, found ${fixtures.length}`);
  for (const file of fixtures) {
    const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'));
    const validate = compile();
    assert.equal(validate(doc), true, `${file}: ${JSON.stringify(validate.errors)}`);
  }
});

test('bbx-flows-dsl-013 duplicate node IDs produce FLW-E001', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'dup',
    nodes: [
      { id: 'step-1', type: 'task', taskType: 't' },
      { id: 'step-1', type: 'task', taskType: 't' }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'FLW-E001'), JSON.stringify(result.errors));
});

test('bbx-flows-dsl-014 cyclic edge produces FLW-E002', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'cycle',
    nodes: [
      { id: 'A', type: 'task', taskType: 't', next: 'B' },
      { id: 'B', type: 'task', taskType: 't', next: 'A' }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'FLW-E002'), JSON.stringify(result.errors));
});

test('bbx-flows-dsl-015 dangling edge reference produces FLW-E003', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'dangling',
    nodes: [{ id: 'start', type: 'task', taskType: 't', next: 'ghost-node' }]
  });
  assert.equal(result.ok, false);
  const e003 = result.errors.find((e) => e.code === 'FLW-E003');
  assert.ok(e003, JSON.stringify(result.errors));
  assert.equal(e003.nodeId, 'start');
});

test('bbx-flows-dsl-016 a well-formed flow returns an empty error list', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'clean',
    nodes: [
      { id: 'a', type: 'task', taskType: 't', next: 'b' },
      { id: 'b', type: 'task', taskType: 't' }
    ]
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('bbx-flows-dsl-017 validator publishes every FLW-E code in its rule table', () => {
  for (let n = 1; n <= 9; n += 1) {
    const code = `FLW-E00${n}`;
    assert.ok(Object.prototype.hasOwnProperty.call(FLOW_VALIDATION_ERROR_CODES, code), `missing ${code}`);
    assert.equal(typeof FLOW_VALIDATION_ERROR_CODES[code], 'string');
  }
});
