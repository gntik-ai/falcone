import assert from 'node:assert/strict';
import test from 'node:test';
import YAML from 'yaml';
import { ALLOWED_ADDITIONS, behaviorOf, diffBehavior, diffContracts, diffNodes, operationKeys } from './parity.mjs';
import { deepClone, loadContract, loadInventory, operationsOf } from './support.mjs';

const contract = loadContract();
const inventory = loadInventory();

const mutated = (change) => {
  const copy = deepClone(contract);
  change(copy);
  return copy;
};

function firstRefNode(node, where = '') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) { const found = firstRefNode(item, `${where}/${index}`); if (found) return found; }
  } else if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') return node;
    for (const [key, value] of Object.entries(node)) { const found = firstRefNode(value, `${where}/${key}`); if (found) return found; }
  }
  return null;
}

test('every inventory path, method and operationId exists in the contract, and nothing else does', () => {
  assert.deepEqual(operationKeys(contract), operationKeys(inventory));
  assert.equal(operationKeys(contract).length, 23);
  assert.equal(contract.openapi, inventory.openapi);
  assert.deepEqual(contract.servers, inventory.servers);
});

test('security requirements are unchanged, and no security scheme is invented', () => {
  const requirements = (document) => operationsOf(document).map(({ operationId, operation }) => [operationId, operation.security]);
  assert.deepEqual(requirements(contract), requirements(inventory));
  assert.ok(requirements(contract).every(([, security]) => JSON.stringify(security) === '[{"bearerAuth":[]}]'));
  assert.equal(contract.components.securitySchemes, inventory.components.securitySchemes);
});

test('deep parity: the contract equals the inventory except for the allowed additions', () => {
  assert.deepEqual(diffContracts(inventory, contract), []);
});

test('the allowed additions are exactly the optional properties named by the operator', () => {
  const added = diffNodes(inventory, contract, '', new Set()).filter((line) => line.endsWith(': added')).map((line) => line.slice(0, -': added'.length)).sort();
  assert.deepEqual(added, [...ALLOWED_ADDITIONS].sort());
  assert.deepEqual(diffNodes(inventory, contract, '', new Set()).filter((line) => !line.endsWith(': added') && !line.startsWith('/info/version')), []);
  assert.deepEqual([...ALLOWED_ADDITIONS].sort(), [
    '/components/schemas/FunctionActionExecutionConfiguration/properties/base',
    '/components/schemas/FunctionActionExecutionConfiguration/properties/runtimeMode',
    '/components/schemas/FunctionDefinitionPayload/properties/base',
    '/components/schemas/FunctionDefinitionPayload/properties/runtimeMode',
    '/components/schemas/FunctionExecutionConfiguration/properties/base',
    '/components/schemas/FunctionExecutionConfiguration/properties/runtimeMode',
    '/components/schemas/FunctionProvisioningState/properties/failureReason',
    '/components/schemas/FunctionProvisioningState/properties/runtimeMode',
  ]);
});

const pageSize = (document) => document.components.parameters.PageSize.schema;
const someOperation = (document, operationId) => operationsOf(document).find((entry) => entry.operationId === operationId).operation;

const MUTATIONS = {
  'removing a route': (copy) => { delete copy.paths['/v1/functions/workspaces/{workspaceId}/inventory']; },
  'removing a method': (copy) => { delete copy.paths['/v1/functions/actions/{resourceId}'].patch; },
  'removing a response status': (copy) => { delete someOperation(copy, 'getFunctions').responses['404']; },
  'retargeting a response schema': (copy) => { someOperation(copy, 'getFunctions').responses['200'].content['application/json'].schema.$ref = '#/components/schemas/FunctionVersion'; },
  'removing a security requirement': (copy) => { delete someOperation(copy, 'getFunctions').security; },
  'changing a security requirement': (copy) => { someOperation(copy, 'getFunctions').security = [{ apiKey: [] }]; },
  'adding a security scheme': (copy) => { copy.components.securitySchemes = { bearerAuth: { type: 'http', scheme: 'bearer' } }; },
  'changing the API version': (copy) => { copy.components.parameters.XApiVersion.schema.const = '2026-04-01'; },
  'changing a numeric bound': (copy) => { pageSize(copy).maximum = 500; },
  'changing a default': (copy) => { pageSize(copy).default = 30; },
  'changing an enum': (copy) => { copy.components.schemas.FunctionWebActionConfiguration.properties.responseMode.enum.push('stream'); },
  'changing a format': (copy) => { copy.components.schemas.GatewayMutationAccepted.properties.acceptedAt.format = 'uri'; },
  'changing a pattern': (copy) => { copy.components.schemas.ErrorResponse.properties.code.pattern = '^[A-Z_]+$'; },
  'changing a length bound': (copy) => { copy.components.schemas.FunctionDeploymentSource.properties.digest.minLength = 1; },
  'changing additionalProperties': (copy) => { copy.components.schemas.FunctionWebActionConfiguration.additionalProperties = true; },
  'changing a type': (copy) => { copy.components.schemas.FunctionActionPage.properties.total.type = 'string'; },
  'changing required': (copy) => { copy.components.schemas.FunctionActionPage.required = []; },
  'changing a oneOf member': (copy) => { copy.components.schemas.FunctionSecretDeclaration.oneOf.pop(); },
  'adding a property that is not allowed': (copy) => { copy.components.schemas.FunctionProvisioningState.properties.extra = { type: 'string' }; },
  'adding base to a schema that is not named': (copy) => { copy.components.schemas.FunctionVersion.properties.base = { type: 'string' }; },
  'removing a property': (copy) => { delete copy.components.schemas.FunctionActionPage.properties.total; },
  'adding a sibling default beside a $ref': (copy) => { firstRefNode(copy.components.schemas).default = 'x'; },
  'adding a sibling nullable beside a $ref': (copy) => { firstRefNode(copy.paths).nullable = true; },
  'changing the idempotency header': (copy) => { copy.components.parameters.IdempotencyKey.name = 'X-Idempotency-Key'; },
  'dropping the idempotency header from an operation': (copy) => { const op = someOperation(copy, 'createFunctions'); op.parameters = op.parameters.filter((parameter) => !parameter.$ref.endsWith('/IdempotencyKey')); },
};

for (const [name, change] of Object.entries(MUTATIONS)) {
  test(`parity fails on ${name}`, () => {
    assert.notDeepEqual(diffContracts(inventory, mutated(change)), []);
  });
}

test('a sibling default beside a $ref survives a YAML round trip and is still reported', () => {
  const copy = mutated(MUTATIONS['adding a sibling default beside a $ref']);
  const reparsed = YAML.parse(YAML.stringify(copy));
  const differences = diffContracts(inventory, reparsed);
  assert.ok(differences.some((line) => line.endsWith('/default: added')), differences.join('\n'));
});

test('a $ref sibling is reported even when the same default exists on the inventory side only', () => {
  const left = deepClone(inventory);
  firstRefNode(left.components.schemas).default = 'x';
  assert.ok(diffContracts(left, contract).some((line) => line.endsWith('/default: removed')));
});

// pagination, idempotency and replay -----------------------------------------------------------

test('pagination, idempotency header, idempotent methods and replay status match the inventory for every operation', () => {
  assert.deepEqual(diffBehavior(inventory, contract), []);
});

test('behavior is what the inventory documents (known-good literals)', () => {
  const behavior = behaviorOf(contract);
  for (const [operationId, entry] of Object.entries(behavior)) {
    const mutates = entry.method !== 'get';
    assert.equal(entry.idempotency !== null, mutates, `${operationId}: Idempotency-Key only on mutating methods`);
    if (mutates) {
      assert.equal(entry.idempotency.name, 'Idempotency-Key');
      assert.equal(entry.idempotency.in, 'header');
      assert.equal(entry.idempotency.required, false);
      assert.deepEqual(entry.replay, { status: 'original', header: 'X-Idempotency-Replayed', value: 'true' });
    } else assert.equal(entry.replay, null);
  }
  const actions = behavior.listFunctionActions;
  assert.deepEqual(actions.pagination.map((parameter) => parameter.name), ['page[size]', 'page[after]', 'sort', 'search']);
  assert.deepEqual(actions.pagination[0].schema, { default: 25, maximum: 200, minimum: 1, type: 'integer' });
  assert.deepEqual(actions.pagination[1].schema, { maxLength: 256, minLength: 1, type: 'string' });
  const activations = behavior.listFunctionActivations;
  assert.deepEqual(activations.pagination[0].schema, { default: 50, maximum: 200, minimum: 1, type: 'integer' });
  assert.deepEqual(Object.keys(activations.continuationFields).sort(), ['nextCursor', 'size', 'total']);
  assert.deepEqual(activations.continuationFields.nextCursor, { maxLength: 256, minLength: 1, type: 'string' });
  assert.deepEqual(behavior.createFunctions.successStatuses, ['202']);
  assert.deepEqual(behavior.createFunctionWorkspaceSecret.successStatuses, ['201']);
  assert.deepEqual(behavior.deleteFunctionWorkspaceSecret.successStatuses, ['204']);
});

const BEHAVIOR_MUTATIONS = {
  'a pagination default': (copy) => { pageSize(copy).default = 30; },
  'a pagination maximum': (copy) => { copy.components.parameters.FunctionActivationPageSize.schema.maximum = 100; },
  'a pagination parameter name': (copy) => { copy.components.parameters.PageAfter.name = 'page[cursor]'; },
  'a continuation field': (copy) => { delete copy.components.schemas.FunctionActivationPage.properties.nextCursor; },
  'a continuation field type': (copy) => { copy.components.schemas.FunctionActivationPage.properties.nextCursor.type = 'integer'; },
  'the idempotency header name': (copy) => { copy.components.parameters.IdempotencyKey.name = 'X-Idempotency-Key'; },
  'an operation that requires idempotency': (copy) => { const op = someOperation(copy, 'invokeFunctionAction'); op.parameters = op.parameters.filter((parameter) => !parameter.$ref.endsWith('/IdempotencyKey')); },
  'the replay status': (copy) => { copy.components.parameters.IdempotencyKey.description = copy.components.parameters.IdempotencyKey.description.replace('replay the original status', 'replay status 200'); },
  'the replay header': (copy) => { copy.components.parameters.IdempotencyKey.description = copy.components.parameters.IdempotencyKey.description.replace('X-Idempotency-Replayed', 'X-Replayed'); },
  'a success status': (copy) => { const responses = someOperation(copy, 'createFunctions').responses; responses['200'] = responses['202']; delete responses['202']; },
};

for (const [name, change] of Object.entries(BEHAVIOR_MUTATIONS)) {
  test(`behavior parity fails when ${name} changes`, () => {
    assert.notDeepEqual(diffBehavior(inventory, mutated(change)), []);
  });
}
