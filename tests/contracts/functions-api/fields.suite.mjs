import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  CATALOG_ID_INVALID, CATALOG_ID_PATTERN, CATALOG_ID_VALID, CONFIGURATION_SCHEMAS, ERROR_REASONS, FIXTURES_DIR,
  compileSchema, deepClone, loadContract, loadInventory, readFixture, schemaValidator,
} from './support.mjs';
import { diffNodes } from './parity.mjs';

const contract = loadContract();
const inventory = loadInventory();
const schemas = contract.components.schemas;

const DIGEST = `sha256:${'a'.repeat(64)}`;

function rejectedAt(validate, instance, pointer) {
  const valid = validate(instance);
  return !valid && (validate.errors ?? []).some((error) => error.instancePath === pointer || error.instancePath.startsWith(`${pointer}/`));
}

function findKey(node, key, where = '', found = []) {
  if (Array.isArray(node)) node.forEach((item, index) => findKey(item, key, `${where}/${index}`, found));
  else if (node && typeof node === 'object') {
    for (const [name, value] of Object.entries(node)) {
      if (name === key) found.push(`${where}/${name}`);
      findKey(value, key, `${where}/${name}`, found);
    }
  }
  return found;
}

// runtimeMode ----------------------------------------------------------------------------------

function runtimeModeProblems(document) {
  const problems = [];
  for (const name of CONFIGURATION_SCHEMAS) {
    const schema = document.components.schemas[name];
    const mode = schema.properties?.runtimeMode;
    if (!mode) { problems.push(`${name}: runtimeMode missing`); continue; }
    if (JSON.stringify(mode.enum) !== JSON.stringify(['wasm', 'oci'])) problems.push(`${name}: runtimeMode enum`);
    if (mode.default !== 'wasm') problems.push(`${name}: runtimeMode default`);
    if (mode.type !== 'string') problems.push(`${name}: runtimeMode type`);
    if ('x-extensible-enum' in mode) problems.push(`${name}: runtimeMode must not be extensible`);
    if ((schema.required ?? []).includes('runtimeMode')) problems.push(`${name}: runtimeMode must be optional`);
  }
  return problems;
}

test('runtimeMode is optional on the three configuration schemas, enum [wasm, oci], default wasm, not extensible', () => {
  assert.deepEqual(runtimeModeProblems(contract), []);
});

test('runtime keeps its inventory type and enum', () => {
  for (const name of ['FunctionExecutionConfiguration', 'FunctionActionExecutionConfiguration', 'FunctionDefinitionPayload']) {
    assert.deepEqual(schemas[name].properties.runtime, inventory.components.schemas[name].properties.runtime, name);
  }
  assert.deepEqual(schemas.FunctionExecutionConfiguration.properties.runtime.enum, ['nodejs:20', 'python:3.11', 'php:8.2', 'go:1.22', 'java:21', 'container:image']);
});

test('runtimeMode mutations are caught', () => {
  const mutate = (change) => { const copy = deepClone(contract); change(copy.components.schemas.FunctionExecutionConfiguration.properties.runtimeMode, copy.components.schemas.FunctionExecutionConfiguration); return copy; };
  assert.notDeepEqual(runtimeModeProblems(mutate((mode) => { mode.enum.push('native'); })), []);
  assert.notDeepEqual(runtimeModeProblems(mutate((mode) => { mode.default = 'oci'; })), []);
  assert.notDeepEqual(runtimeModeProblems(mutate((mode) => { mode['x-extensible-enum'] = true; })), []);
  assert.notDeepEqual(runtimeModeProblems(mutate((mode, schema) => { schema.required.push('runtimeMode'); })), []);
});

for (const [fixture, valid] of [['omitted', true], ['wasm', true], ['oci', true], ['invalid-native', false]]) {
  test(`runtime-mode/${fixture} is ${valid ? 'accepted' : 'rejected'} by every configuration schema`, () => {
    const { instances, expectedRejection } = readFixture(`runtime-mode/${fixture}`);
    assert.deepEqual(Object.keys(instances).sort(), [...CONFIGURATION_SCHEMAS].sort());
    for (const name of CONFIGURATION_SCHEMAS) {
      const validate = schemaValidator(contract, name);
      if (valid) assert.equal(validate(instances[name]), true, `${name}: ${JSON.stringify(validate.errors)}`);
      else assert.equal(rejectedAt(validate, instances[name], expectedRejection), true, name);
    }
  });
}

test('legacy configurations (no runtimeMode) stay valid against the inventory, wasm needs the contract', () => {
  const { instances: omitted } = readFixture('runtime-mode/omitted');
  const { instances: wasm } = readFixture('runtime-mode/wasm');
  for (const name of CONFIGURATION_SCHEMAS) {
    assert.equal(schemaValidator(inventory, name)(omitted[name]), true, name);
    assert.equal(schemaValidator(inventory, name)(wasm[name]), false, `${name}: inventory must not know runtimeMode`);
  }
});

// base -----------------------------------------------------------------------------------------

function baseProblems(document) {
  const problems = [];
  for (const name of CONFIGURATION_SCHEMAS) {
    const schema = document.components.schemas[name];
    const base = schema.properties?.base;
    if (!base) { problems.push(`${name}: base missing`); continue; }
    if ((schema.required ?? []).includes('base')) problems.push(`${name}: base must be optional`);
    if (base.discriminator?.propertyName !== 'kind') problems.push(`${name}: base must be discriminated on kind`);
    if (!Array.isArray(base.oneOf) || base.oneOf.length !== 2) { problems.push(`${name}: base must be a oneOf of two branches`); continue; }
    const byKind = Object.fromEntries(base.oneOf.map((branch) => [branch.properties?.kind?.const, branch]));
    const expected = { catalog: ['kind', 'id', 'digest'], byo: ['kind', 'image_digest', 'signer_identity', 'attestation_ref'] };
    for (const [kind, required] of Object.entries(expected)) {
      const branch = byKind[kind];
      if (!branch) { problems.push(`${name}: base kind ${kind} missing`); continue; }
      if (JSON.stringify([...branch.required].sort()) !== JSON.stringify([...required].sort())) problems.push(`${name}: base ${kind} required set`);
      if (JSON.stringify(Object.keys(branch.properties).sort()) !== JSON.stringify([...required].sort())) problems.push(`${name}: base ${kind} property set`);
      if (branch.additionalProperties !== false) problems.push(`${name}: base ${kind} must be closed`);
    }
    if (byKind.catalog && byKind.catalog.properties.id.pattern !== CATALOG_ID_PATTERN) problems.push(`${name}: catalog id pattern`);
    if ('x-extensible-enum' in (byKind.catalog?.properties.kind ?? {}) || 'x-extensible-enum' in (byKind.byo?.properties.kind ?? {})) problems.push(`${name}: kind must not be extensible`);
  }
  return problems;
}

test('base is an optional oneOf discriminated on kind with the exact required sets', () => {
  assert.deepEqual(baseProblems(contract), []);
});

test('base mutations are caught', () => {
  const mutate = (change) => { const copy = deepClone(contract); change(copy.components.schemas.FunctionDefinitionPayload.properties.base); return copy; };
  assert.notDeepEqual(baseProblems(mutate((base) => { base.oneOf[0].required.pop(); })), []);
  assert.notDeepEqual(baseProblems(mutate((base) => { base.oneOf[1].required = base.oneOf[1].required.filter((name) => name !== 'signer_identity'); })), []);
  assert.notDeepEqual(baseProblems(mutate((base) => { base.oneOf.pop(); })), []);
  assert.notDeepEqual(baseProblems(mutate((base) => { base.oneOf[0].properties.id.pattern = '^.+$'; })), []);
  assert.notDeepEqual(baseProblems(mutate((base) => { base.oneOf[0].properties.kind['x-extensible-enum'] = true; })), []);
});

for (const [fixture, valid] of [['catalog', true], ['byo', true], ['omitted', true], ['invalid-kind-default', false], ['invalid-catalog-no-digest', false], ['invalid-byo-no-signer', false]]) {
  test(`base/${fixture} is ${valid ? 'accepted' : 'rejected'} by every configuration schema`, () => {
    const { instances, expectedRejection } = readFixture(`base/${fixture}`);
    for (const name of CONFIGURATION_SCHEMAS) {
      const validate = schemaValidator(contract, name);
      if (valid) assert.equal(validate(instances[name]), true, `${name}: ${JSON.stringify(validate.errors)}`);
      else assert.equal(rejectedAt(validate, instances[name], expectedRejection), true, name);
    }
  });
}

function idFixtures(kind) {
  const dir = `${FIXTURES_DIR}/base/catalog-id/${kind}`;
  return Object.fromEntries(fs.readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => {
    const name = file.replace(/\.json$/, '');
    return [name, readFixture(`base/catalog-id/${kind}/${name}`).id];
  }));
}

test('catalog id fixtures are exactly the operator decision 3 values', () => {
  assert.deepEqual(idFixtures('valid'), CATALOG_ID_VALID);
  assert.deepEqual(idFixtures('invalid'), CATALOG_ID_INVALID);
});

test('every valid catalog id validates and every invalid one is rejected', () => {
  const validate = compileSchema(contract, { $ref: '#/components/schemas/FunctionDefinitionPayload/properties/base' });
  const catalog = (id) => ({ kind: 'catalog', id, digest: DIGEST });
  for (const [name, id] of Object.entries(idFixtures('valid'))) assert.equal(validate(catalog(id)), true, `${name}: ${id}`);
  for (const [name, id] of Object.entries(idFixtures('invalid'))) assert.equal(validate(catalog(id)), false, `${name}: ${id}`);
});

// errors ---------------------------------------------------------------------------------------

function errorFixtureProblems(document, reason, fixture) {
  const problems = [];
  const validate = schemaValidator(document, 'ErrorResponse');
  if (!validate(fixture)) problems.push(`not an ErrorResponse: ${JSON.stringify(validate.errors)}`);
  if (fixture.code !== ERROR_REASONS[reason]) problems.push(`code ${fixture.code}`);
  if (fixture.detail?.reason !== reason) problems.push(`detail.reason ${fixture.detail?.reason}`);
  if (fixture.retryable !== false) problems.push(`retryable ${fixture.retryable}`);
  return problems;
}

for (const reason of Object.keys(ERROR_REASONS)) {
  test(`errors/${reason} is a non-retryable ErrorResponse with ${ERROR_REASONS[reason]}`, () => {
    assert.deepEqual(errorFixtureProblems(contract, reason, readFixture(`errors/${reason}`)), []);
  });
}

test('error fixture mutations are caught', () => {
  const fixture = readFixture('errors/oci_not_authorized');
  const mutate = (change) => { const copy = deepClone(fixture); change(copy); return copy; };
  assert.notDeepEqual(errorFixtureProblems(contract, 'oci_not_authorized', mutate((copy) => { copy.retryable = true; })), []);
  assert.notDeepEqual(errorFixtureProblems(contract, 'oci_not_authorized', mutate((copy) => { delete copy.retryable; })), []);
  assert.notDeepEqual(errorFixtureProblems(contract, 'oci_not_authorized', mutate((copy) => { copy.code = 'GW_BASE_DISABLED'; })), []);
  assert.notDeepEqual(errorFixtureProblems(contract, 'oci_not_authorized', mutate((copy) => { copy.code = 'oci_not_authorized'; })), []);
  assert.notDeepEqual(errorFixtureProblems(contract, 'oci_not_authorized', mutate((copy) => { copy.detail.reason = 'base_disabled'; })), []);
});

function errorSchemaProblems(document) {
  const problems = [];
  const response = document.components.schemas.ErrorResponse;
  const detail = document.components.schemas.ErrorDetail;
  if (response.properties.code.pattern !== '^GW_[A-Z0-9_]+$') problems.push('code pattern');
  if ('enum' in response.properties.code) problems.push('code must not carry an enum');
  if ('x-extensible-enum' in response.properties.code) problems.push('code must not be extensible');
  if (response.properties.retryable.type !== 'boolean') problems.push('retryable type');
  if (detail.properties.reason.type !== 'string') problems.push('detail.reason type');
  problems.push(...diffNodes(inventory.components.schemas.ErrorResponse, response, '/ErrorResponse', new Set()));
  problems.push(...diffNodes(inventory.components.schemas.ErrorDetail, detail, '/ErrorDetail', new Set()));
  return problems;
}

test('ErrorResponse and ErrorDetail match the inventory exactly, with no code enum', () => {
  assert.deepEqual(errorSchemaProblems(contract), []);
  assert.deepEqual([...schemas.ErrorResponse.required].sort(), ['code', 'correlationId', 'detail', 'message', 'requestId', 'resource', 'status', 'timestamp']);
  for (const code of Object.values(ERROR_REASONS)) assert.match(code, new RegExp(schemas.ErrorResponse.properties.code.pattern));
});

test('adding an enum or extensibility to ErrorResponse.code is caught', () => {
  const withEnum = deepClone(contract);
  withEnum.components.schemas.ErrorResponse.properties.code.enum = Object.values(ERROR_REASONS);
  assert.notDeepEqual(errorSchemaProblems(withEnum), []);
  const extensible = deepClone(contract);
  extensible.components.schemas.ErrorResponse.properties.code['x-extensible-enum'] = true;
  assert.notDeepEqual(errorSchemaProblems(extensible), []);
});

// status ---------------------------------------------------------------------------------------

function statusProblems(document) {
  const problems = [];
  const state = document.components.schemas.FunctionProvisioningState;
  const { runtimeMode, failureReason } = state.properties;
  if (JSON.stringify(runtimeMode?.enum) !== JSON.stringify(['wasm', 'oci'])) problems.push('runtimeMode enum');
  if ('x-extensible-enum' in (runtimeMode ?? {})) problems.push('runtimeMode must not be extensible');
  if (JSON.stringify(failureReason?.enum) !== JSON.stringify(['oci_not_authorized', 'base_disabled', 'base_mismatch'])) problems.push('failureReason enum');
  if (failureReason?.['x-extensible-enum'] !== true) problems.push('failureReason must be extensible');
  for (const name of ['runtimeMode', 'failureReason']) if (state.required.includes(name)) problems.push(`${name} must be optional`);
  if (JSON.stringify(state.required) !== JSON.stringify(['state'])) problems.push('required');
  problems.push(...diffNodes(inventory.components.schemas.FunctionLifecycleState, document.components.schemas.FunctionLifecycleState, '/FunctionLifecycleState', new Set()));
  return problems;
}

test('FunctionProvisioningState gains optional runtimeMode and an extensible failureReason; FunctionLifecycleState is unchanged', () => {
  assert.deepEqual(statusProblems(contract), []);
  assert.deepEqual(schemas.FunctionLifecycleState.enum, ['active', 'unavailable', 'deletion_pending']);
});

test('x-extensible-enum appears on failureReason only', () => {
  assert.deepEqual(findKey(contract, 'x-extensible-enum'), ['/components/schemas/FunctionProvisioningState/properties/failureReason/x-extensible-enum']);
});

test('status mutations are caught', () => {
  const mutate = (change) => { const copy = deepClone(contract); change(copy.components.schemas.FunctionProvisioningState, copy.components.schemas); return copy; };
  assert.notDeepEqual(statusProblems(mutate((state) => { state.properties.failureReason.enum.pop(); })), []);
  assert.notDeepEqual(statusProblems(mutate((state) => { delete state.properties.failureReason['x-extensible-enum']; })), []);
  assert.notDeepEqual(statusProblems(mutate((state) => { state.properties.runtimeMode.enum.push('native'); })), []);
  assert.notDeepEqual(statusProblems(mutate((state) => { state.required.push('failureReason'); })), []);
  assert.notDeepEqual(statusProblems(mutate((state, all) => { all.FunctionLifecycleState.enum.push('failed'); })), []);
});

for (const [fixture, valid] of [
  ['runtime-mode-wasm', true], ['runtime-mode-oci', true], ['failure-oci_not_authorized', true],
  ['failure-base_disabled', true], ['failure-base_mismatch', true], ['invalid-unknown-reason', false],
]) {
  test(`status/${fixture} is ${valid ? 'accepted' : 'rejected'} by FunctionProvisioningState`, () => {
    const validate = schemaValidator(contract, 'FunctionProvisioningState');
    const instance = readFixture(`status/${fixture}`);
    if (valid) assert.equal(validate(instance), true, JSON.stringify(validate.errors));
    else assert.equal(rejectedAt(validate, instance, '/failureReason'), true);
  });
}

test('status fixtures with the new fields are unknown to the inventory', () => {
  const validate = schemaValidator(inventory, 'FunctionProvisioningState');
  assert.equal(validate(readFixture('status/runtime-mode-oci')), false);
});
