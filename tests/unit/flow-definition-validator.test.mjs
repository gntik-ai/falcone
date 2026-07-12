import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  validateFlowDefinition,
  FLOW_VALIDATION_ERROR_CODES,
  defaultExpressionEngine
} from '../../packages/internal-contracts/src/flow-definition-validator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INVALID_DIR = resolve(__dirname, '../../packages/internal-contracts/src/fixtures/flows/invalid');

function loadInvalid(name) {
  return JSON.parse(readFileSync(resolve(INVALID_DIR, name), 'utf8'));
}

function codes(result) {
  return result.errors.map((e) => e.code);
}

test('error-code table publishes FLW-E001 through FLW-E009 with descriptions', () => {
  const keys = Object.keys(FLOW_VALIDATION_ERROR_CODES);
  for (let n = 1; n <= 9; n += 1) {
    const code = `FLW-E00${n}`;
    assert.ok(keys.includes(code), `missing ${code}`);
    assert.equal(typeof FLOW_VALIDATION_ERROR_CODES[code], 'string');
    assert.ok(FLOW_VALIDATION_ERROR_CODES[code].length > 0);
  }
  assert.equal(keys.length, 9);
});

test('error output is node-scoped {code, nodeId, message}', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'shape',
    nodes: [{ id: 'start', type: 'task', taskType: 't', next: 'ghost' }]
  });
  assert.equal(result.ok, false);
  const err = result.errors[0];
  assert.deepEqual(Object.keys(err).sort(), ['code', 'message', 'nodeId']);
  assert.equal(err.nodeId, 'start');
  assert.match(err.code, /^FLW-E00\d$/);
});

test('FLW-E001: duplicate node IDs are reported, unique IDs are not', () => {
  const dup = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'dup',
    nodes: [
      { id: 'step-1', type: 'task', taskType: 't' },
      { id: 'step-1', type: 'task', taskType: 't' }
    ]
  });
  assert.ok(codes(dup).includes('FLW-E001'));
  const e001 = dup.errors.find((e) => e.code === 'FLW-E001');
  assert.equal(e001.nodeId, 'step-1');
  assert.equal(e001.message, 'ID de nodo duplicado "step-1"; los ID de nodo deben ser únicos dentro del flujo.');

  const unique = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'unique',
    nodes: [
      { id: 'a', type: 'task', taskType: 't' },
      { id: 'b', type: 'task', taskType: 't' }
    ]
  });
  assert.ok(!codes(unique).includes('FLW-E001'));
});

test('FLW-E001: fixture flw-e001-duplicate-id triggers the code', () => {
  const result = validateFlowDefinition(loadInvalid('flw-e001-duplicate-id.json'));
  assert.ok(codes(result).includes('FLW-E001'));
});

test('FLW-E002: a two-node cycle is reported', () => {
  const result = validateFlowDefinition(loadInvalid('flw-e002-cycle.json'));
  assert.ok(codes(result).includes('FLW-E002'));
});

test('FLW-E002: a self-loop is reported', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'self',
    nodes: [{ id: 'a', type: 'task', taskType: 't', next: 'a' }]
  });
  assert.ok(codes(result).includes('FLW-E002'));
  const e002 = result.errors.find((e) => e.code === 'FLW-E002');
  assert.equal(e002.message, 'El grafo de nodos contiene un ciclo alcanzable desde el nodo "a".');
});

test('FLW-E002: a longer cycle through sequence/branch edges is reported', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'long-cycle',
    nodes: [
      { id: 'seq', type: 'sequence', steps: ['t1'] },
      { id: 't1', type: 'task', taskType: 't', next: 'br' },
      {
        id: 'br',
        type: 'branch',
        arms: [
          { when: 'x > 1', next: 'seq' },
          { when: 'x <= 1', next: 't1' }
        ]
      }
    ]
  });
  assert.ok(codes(result).includes('FLW-E002'));
});

test('FLW-E002: an acyclic diamond is NOT flagged as a cycle', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'diamond',
    nodes: [
      { id: 'fork', type: 'parallel', branches: ['left', 'right'], next: 'join' },
      { id: 'left', type: 'task', taskType: 't', next: 'join' },
      { id: 'right', type: 'task', taskType: 't', next: 'join' },
      { id: 'join', type: 'task', taskType: 't' }
    ]
  });
  assert.ok(!codes(result).includes('FLW-E002'), JSON.stringify(result.errors));
});

test('FLW-E003: a dangling reference is reported and a cycle is not invented from it', () => {
  const result = validateFlowDefinition(loadInvalid('flw-e003-dangling-ref.json'));
  assert.ok(codes(result).includes('FLW-E003'));
  assert.ok(!codes(result).includes('FLW-E002'));
  const e003 = result.errors.find((e) => e.code === 'FLW-E003');
  assert.equal(e003.message, 'El nodo "start" referencia el nodo desconocido "ghost-node".');
});

test('FLW-E004: sub-flow references are checked only when a resolver is supplied', () => {
  const doc = loadInvalid('flw-e004-unresolved-sub-flow.json');

  const withoutResolver = validateFlowDefinition(doc);
  assert.ok(!codes(withoutResolver).includes('FLW-E004'), 'no resolver -> rule is a no-op');

  const withResolver = validateFlowDefinition(doc, { resolveSubFlow: () => false });
  assert.ok(codes(withResolver).includes('FLW-E004'));
  const e004 = withResolver.errors.find((e) => e.code === 'FLW-E004');
  assert.equal(e004.message, 'La referencia de subflujo does-not-exist@v9.9 no pudo resolverse.');

  const resolved = validateFlowDefinition(doc, { resolveSubFlow: () => true });
  assert.ok(!codes(resolved).includes('FLW-E004'));
});

test('FLW-E004: resolver receives the flowId + flowVersion reference', () => {
  const seen = [];
  validateFlowDefinition(loadInvalid('flw-e004-unresolved-sub-flow.json'), {
    resolveSubFlow: (ref) => {
      seen.push(ref);
      return true;
    }
  });
  assert.deepEqual(seen, [{ flowId: 'does-not-exist', flowVersion: 'v9.9' }]);
});

test('FLW-E005: an unparseable CEL expression is reported via the default engine', () => {
  const result = validateFlowDefinition(loadInvalid('flw-e005-bad-expression.json'));
  assert.ok(codes(result).includes('FLW-E005'));
  const e005 = result.errors.find((e) => e.code === 'FLW-E005');
  assert.equal(e005.message, 'La expresión "amount > > 100" no puede analizarse con el motor cel.');
});

test('FLW-E005: a well-formed CEL expression is accepted by the default engine', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'ok-expr',
    nodes: [
      {
        id: 'decide',
        type: 'branch',
        arms: [
          { when: 'amount > 100 && status == "active"', next: 'a' },
          { when: 'amount <= 100', next: 'b' }
        ]
      },
      { id: 'a', type: 'task', taskType: 't' },
      { id: 'b', type: 'task', taskType: 't' }
    ]
  });
  assert.ok(!codes(result).includes('FLW-E005'), JSON.stringify(result.errors));
});

test('FLW-E005: the expression engine is an injectable seam', () => {
  const calls = [];
  const rejectAll = {
    name: 'stub',
    parse(expression) {
      calls.push(expression);
      return { ok: false };
    }
  };
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'stub-engine',
    nodes: [
      {
        id: 'decide',
        type: 'branch',
        arms: [
          { when: 'a', next: 'x' },
          { when: 'b', next: 'y' }
        ]
      },
      { id: 'x', type: 'task', taskType: 't' },
      { id: 'y', type: 'task', taskType: 't' }
    ]
  }, { expressionEngine: rejectAll });
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(codes(result).filter((c) => c === 'FLW-E005').length, 2);
});

test('defaultExpressionEngine wraps CEL and reports parse success/failure', () => {
  assert.equal(defaultExpressionEngine.name, 'cel');
  assert.equal(defaultExpressionEngine.parse('amount > 100').ok, true);
  assert.equal(defaultExpressionEngine.parse('amount > > 100').ok, false);
});

test('FLW-E006: unknown taskType is reported only when a catalog is supplied', () => {
  const doc = loadInvalid('flw-e006-unknown-task-type.json');

  const withoutCatalog = validateFlowDefinition(doc);
  assert.ok(!codes(withoutCatalog).includes('FLW-E006'), 'no catalog -> rule is a no-op');

  const withCatalog = validateFlowDefinition(doc, { taskTypeCatalog: ['known-type'] });
  assert.ok(codes(withCatalog).includes('FLW-E006'));
  const e006 = withCatalog.errors.find((e) => e.code === 'FLW-E006');
  assert.equal(e006.message, 'Tipo de tarea desconocido "not-in-catalog"; no está presente en el catálogo de tipos de tarea.');

  const known = validateFlowDefinition(doc, { taskTypeCatalog: ['not-in-catalog'] });
  assert.ok(!codes(known).includes('FLW-E006'));
});

test('FLW-E007: an invalid cron schedule is reported, 5- and 6-field schedules pass', () => {
  const bad = validateFlowDefinition(loadInvalid('flw-e007-bad-cron.json'));
  assert.ok(codes(bad).includes('FLW-E007'));
  const e007 = bad.errors.find((e) => e.code === 'FLW-E007');
  assert.equal(e007.message, 'La programación cron "0 9" no es una expresión cron POSIX válida (5 o 6 campos).');

  const fiveField = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'cron5',
    triggers: [{ kind: 'cron', schedule: '0 9 * * 1-5' }],
    nodes: [{ id: 'n', type: 'task', taskType: 't' }]
  });
  assert.ok(!codes(fiveField).includes('FLW-E007'));

  const sixField = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'cron6',
    triggers: [{ kind: 'cron', schedule: '0 0 9 * * 1-5' }],
    nodes: [{ id: 'n', type: 'task', taskType: 't' }]
  });
  assert.ok(!codes(sixField).includes('FLW-E007'));
});

test('FLW-E008: an invalid wait duration is reported, ISO 8601 durations pass', () => {
  const bad = validateFlowDefinition(loadInvalid('flw-e008-bad-duration.json'));
  assert.ok(codes(bad).includes('FLW-E008'));
  const e008 = bad.errors.find((e) => e.code === 'FLW-E008');
  assert.equal(e008.message, 'La duración "30 seconds" del nodo de espera "pause" no es una duración ISO 8601 válida.');

  for (const duration of ['PT30S', 'PT5M', 'P1D', 'P1DT2H30M', 'PT0.5S']) {
    const ok = validateFlowDefinition({
      apiVersion: 'v1.0',
      name: 'wait-ok',
      nodes: [
        { id: 'w', type: 'wait', duration, next: 'n' },
        { id: 'n', type: 'task', taskType: 't' }
      ]
    });
    assert.ok(!codes(ok).includes('FLW-E008'), `${duration} should be valid`);
  }
});

test('FLW-E009: a branch with one arm and no default is reported', () => {
  const result = validateFlowDefinition(loadInvalid('flw-e009-branch-arity.json'));
  assert.ok(codes(result).includes('FLW-E009'));
  const e009 = result.errors.find((e) => e.code === 'FLW-E009');
  assert.equal(e009.message, 'La rama "decide" necesita al menos dos brazos, o un brazo más una conexión predeterminada.');
});

test('FLW-E009: one arm plus a default is sufficient', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'arm-plus-default',
    nodes: [
      {
        id: 'decide',
        type: 'branch',
        arms: [{ when: 'x > 1', next: 'a' }],
        default: 'b'
      },
      { id: 'a', type: 'task', taskType: 't' },
      { id: 'b', type: 'task', taskType: 't' }
    ]
  });
  assert.ok(!codes(result).includes('FLW-E009'), JSON.stringify(result.errors));
});

test('a fully well-formed flow returns ok:true and an empty error list', () => {
  const result = validateFlowDefinition({
    apiVersion: 'v1.0',
    name: 'clean',
    triggers: [{ kind: 'cron', schedule: '0 9 * * 1-5' }],
    nodes: [
      { id: 'a', type: 'task', taskType: 'known', next: 'wait' },
      { id: 'wait', type: 'wait', duration: 'PT10S', next: 'decide' },
      {
        id: 'decide',
        type: 'branch',
        arms: [
          { when: 'amount > 100', next: 'b' },
          { when: 'amount <= 100', next: 'c' }
        ]
      },
      { id: 'b', type: 'task', taskType: 'known' },
      { id: 'c', type: 'sub-flow', flowId: 'child', flowVersion: 'v1.0' }
    ]
  }, {
    taskTypeCatalog: ['known'],
    resolveSubFlow: () => true
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('all five canonical fixtures pass the semantic validator with the proper seams', () => {
  const FIXTURE_DIR = resolve(__dirname, '../../packages/internal-contracts/src/fixtures/flows');
  const taskTypeCatalog = [
    'fetch-record', 'transform-record', 'persist-record',
    'manual-review', 'auto-approve',
    'enrich-email', 'enrich-phone', 'enrich-address', 'merge-profile',
    'publish-document', 'prepare-batch', 'record-completion'
  ];
  for (const file of ['minimal-3-node.json', 'branch-retry.json', 'parallel-fan-out.json', 'human-approval.json', 'sub-flow-ref.json']) {
    const doc = JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8'));
    const result = validateFlowDefinition(doc, { taskTypeCatalog, resolveSubFlow: () => true });
    assert.equal(result.ok, true, `${file}: ${JSON.stringify(result.errors)}`);
  }
});
