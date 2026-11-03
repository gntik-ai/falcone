import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpected, fieldSet, sharesNoReferences } from './expected.mjs';
import {
  compileSchema, deepClone, loadContract, loadInventory, operationsOf, readFixture, resolveRef,
} from './support.mjs';

const contract = loadContract();
const inventory = loadInventory();

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Adds runtimeMode: wasm wherever the document's schema declares the property, returning how many were added.
function injectRuntimeMode(document, schema, instance) {
  const node = resolveRef(document, schema);
  let count = 0;
  if (Array.isArray(instance)) {
    for (const item of instance) count += injectRuntimeMode(document, node.items ?? {}, item);
  } else if (isObject(instance) && node.properties) {
    if (node.properties.runtimeMode && !('runtimeMode' in instance)) {
      instance.runtimeMode = 'wasm';
      count += 1;
    }
    for (const [name, value] of Object.entries(instance)) {
      if (node.properties[name]) count += injectRuntimeMode(document, node.properties[name], value);
    }
  }
  return count;
}

function operationOf(document, operationId) {
  return operationsOf(document).find((entry) => entry.operationId === operationId);
}

const validationMessage = (validate) => JSON.stringify(validate.errors);

// Problems found when a legacy request is checked against the operation as the document defines it.
function requestProblems(document, operationId, request) {
  const { operation, pathItem } = operationOf(document, operationId);
  const problems = [];
  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((parameter) => resolveRef(document, parameter));
  const supplied = { path: request.pathParameters ?? {}, query: request.query ?? {}, header: request.headers ?? {} };
  for (const parameter of parameters) {
    const value = supplied[parameter.in][parameter.name];
    if (value === undefined) {
      if (parameter.required) problems.push(`missing required ${parameter.in} parameter ${parameter.name}`);
      continue;
    }
    const validate = compileSchema(document, parameter.schema);
    if (!validate(value)) problems.push(`${parameter.in} ${parameter.name}: ${validationMessage(validate)}`);
  }
  for (const [place, values] of Object.entries(supplied)) {
    for (const name of Object.keys(values)) {
      if (!parameters.some((parameter) => parameter.in === place && parameter.name === name)) problems.push(`undeclared ${place} parameter ${name}`);
    }
  }
  const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
  if (bodySchema) {
    if (request.body === undefined) {
      if (operation.requestBody.required) problems.push('missing required request body');
    } else {
      const validate = compileSchema(document, bodySchema);
      if (!validate(request.body)) problems.push(`body: ${validationMessage(validate)}`);
    }
  } else if (request.body !== undefined) problems.push('unexpected request body');
  return problems;
}

// Problems found when an expected outcome (status, body, error status, error body) is checked against a document.
function expectedProblems(document, operationId, expected) {
  const { operation } = operationOf(document, operationId);
  const problems = [];
  const check = (status, body, label) => {
    const response = operation.responses[String(status)];
    if (!response) { problems.push(`${label}: status ${status} is not a response of ${operationId}`); return; }
    const schema = response.content?.['application/json']?.schema;
    if (!schema) {
      if (body !== undefined) problems.push(`${label}: status ${status} has no body`);
      return;
    }
    const validate = compileSchema(document, schema);
    if (!validate(body)) problems.push(`${label}: ${validationMessage(validate)}`);
  };
  check(expected.response.status, expected.response.body, 'response');
  check(expected.error.status, expected.error.body, 'error');
  return problems;
}

test('the expected-outcome builder reads the inventory freshly and shares nothing between calls', () => {
  const first = buildExpected('getFunctions');
  const second = buildExpected('getFunctions');
  assert.notEqual(first, second);
  assert.equal(sharesNoReferences(first, second), true);
  assert.equal(sharesNoReferences(first, first), false);
  assert.equal(sharesNoReferences(first, { nested: [first.response] }), false);
  assert.deepEqual(first, second);
});

test('the builder derives status and error from the inventory', () => {
  assert.deepEqual(buildExpected('createFunctions').response.status, 202);
  assert.deepEqual(buildExpected('createFunctionWorkspaceSecret').response.status, 201);
  const noContent = buildExpected('deleteFunctionWorkspaceSecret');
  assert.equal(noContent.response.status, 204);
  assert.equal(noContent.response.body, undefined);
  const { error } = buildExpected('getFunctions');
  assert.equal(error.status, 400);
  assert.match(error.body.code, /^GW_[A-Z0-9_]+$/);
  assert.throws(() => buildExpected('notAnOperation'), /not in the inventory/);
});

const RUNTIME_MODE_SLOTS = {
  createFunctions: 1,
  updateFunctions: 1,
  importFunctionDefinition: 1,
  importFunctionPackageDefinition: 1,
};

for (const { operationId } of operationsOf(inventory)) {
  test(`legacy/${operationId} behaves the same with runtimeMode omitted and wasm`, () => {
    const fixture = readFixture(`legacy/${operationId}`);
    const results = {};
    for (const mode of ['omitted', 'wasm']) {
      const request = deepClone(fixture.request);
      let injected = 0;
      if (mode === 'wasm') {
        const bodySchema = operationOf(contract, operationId).operation.requestBody?.content?.['application/json']?.schema;
        if (bodySchema && request.body !== undefined) injected = injectRuntimeMode(contract, bodySchema, request.body);
        assert.equal(injected, RUNTIME_MODE_SLOTS[operationId] ?? 0, `${operationId}: runtimeMode slots`);
        if (injected > 0) assert.match(JSON.stringify(request), /"runtimeMode":"wasm"/);
      } else {
        assert.doesNotMatch(JSON.stringify(request), /runtimeMode|"base"/, 'a legacy request knows nothing of the new fields');
        assert.deepEqual(requestProblems(inventory, operationId, request), [], 'legacy request against the inventory');
      }
      assert.deepEqual(requestProblems(contract, operationId, request), [], `${mode} request against the contract`);

      // Each run builds its own expectation from a fresh read of the inventory.
      const expected = buildExpected(operationId);
      assert.deepEqual(expectedProblems(inventory, operationId, expected), [], `${mode} expectation against the inventory`);
      assert.deepEqual(expectedProblems(contract, operationId, expected), [], `${mode} expectation against the contract`);
      results[mode] = expected;
    }
    assert.equal(sharesNoReferences(results.omitted, results.wasm), true, 'the two runs share no object');
    assert.equal(results.omitted.response.status, results.wasm.response.status);
    assert.equal(results.omitted.error.status, results.wasm.error.status);
    assert.deepEqual(fieldSet(results.omitted.response.body), fieldSet(results.wasm.response.body));
    assert.deepEqual(fieldSet(results.omitted.error.body), fieldSet(results.wasm.error.body));
  });
}

test('the legacy check notices a contract that no longer accepts the legacy request or response', () => {
  const fixture = readFixture('legacy/createFunctions');
  const narrowed = deepClone(contract);
  narrowed.components.schemas.FunctionActionWriteRequest.required.push('deploymentDigest');
  assert.notDeepEqual(requestProblems(narrowed, 'createFunctions', deepClone(fixture.request)), []);

  const widenedResponse = deepClone(contract);
  widenedResponse.components.schemas.GatewayMutationAccepted.properties.status.enum = ['queued'];
  assert.notDeepEqual(expectedProblems(widenedResponse, 'createFunctions', buildExpected('createFunctions')), []);

  const droppedStatus = deepClone(contract);
  delete operationOf(droppedStatus, 'createFunctions').operation.responses['202'];
  assert.notDeepEqual(expectedProblems(droppedStatus, 'createFunctions', buildExpected('createFunctions')), []);

  const droppedError = deepClone(contract);
  delete operationOf(droppedError, 'getFunctions').operation.responses['400'];
  assert.notDeepEqual(expectedProblems(droppedError, 'getFunctions', buildExpected('getFunctions')), []);
});

test('the legacy check notices a request the contract rejects', () => {
  const fixture = readFixture('legacy/createFunctions');
  const noHeader = deepClone(fixture.request);
  delete noHeader.headers['X-API-Version'];
  assert.notDeepEqual(requestProblems(contract, 'createFunctions', noHeader), []);
  const badMode = deepClone(fixture.request);
  badMode.body.execution.runtimeMode = 'native';
  assert.notDeepEqual(requestProblems(contract, 'createFunctions', badMode), []);
  const extraField = deepClone(fixture.request);
  extraField.body.extra = true;
  assert.notDeepEqual(requestProblems(contract, 'createFunctions', extraField), []);
});
