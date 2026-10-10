import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { routes as seedRoutes } from '../../apps/control-plane/routes.mjs';
import { assertFunctionsServed, loadFunctionRuntimeRoutes } from './helpers/functions-runtime.mjs';

const readJson = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const catalog = readJson('packages/internal-contracts/src/public-route-catalog.json').routes;
const family = readJson('apps/control-plane-executor/openapi/families/functions.openapi.json');
const routesFromFamily = (document) => Object.entries(document.paths).flatMap(([path, methods]) => Object.entries(methods)
  .filter(([, operation]) => operation['x-family'] === 'functions')
  .map(([method, operation]) => ({ family: 'functions', path, method: method.toUpperCase(), operationId: operation.operationId })));
const familyRoutes = routesFromFamily(family);

test('every published functions operation resolves in the shipped merged runtime table', () => {
  const runtime = loadFunctionRuntimeRoutes();
  assertFunctionsServed(catalog, runtime);
  const functions = catalog.filter((route) => route.family === 'functions');
  assert.equal(functions.length, runtime.filter((route) => route.path.startsWith('/v1/functions/')).length);
  assertFunctionsServed(familyRoutes);
  assert.deepEqual(functions.map((route) => route.operationId).sort(), familyRoutes.map((route) => route.operationId).sort());
});

test('parity rejects an unmatched operation added to the OpenAPI family and names METHOD path', () => {
  const injectedFamily = structuredClone(family);
  injectedFamily.paths['/v1/functions/actions/{resourceId}/unserved-trigger'] = {
    post: { 'x-family': 'functions', operationId: 'unservedFunctionTrigger' },
  };
  assert.throws(() => assertFunctionsServed(routesFromFamily(injectedFamily)),
    /POST \/v1\/functions\/actions\/\{resourceId\}\/unserved-trigger/);
});

test('parity rejects a catalog operation when its served seed route is removed', () => {
  const runtime = loadFunctionRuntimeRoutes(seedRoutes.filter((route) => !route.path.endsWith('/activations/{activationId}/rerun')));
  const rerun = catalog.filter((route) => route.operationId === 'rerunFunctionActivation');
  assert.equal(rerun.length, 1);
  assert.throws(() => assertFunctionsServed(rerun, runtime),
    /POST \/v1\/functions\/actions\/\{resourceId\}\/activations\/\{activationId\}\/rerun/);
});

test('runtime matching accepts parameter aliases, trailing slashes, ANY and shipped extra routes', () => {
  const runtime = loadFunctionRuntimeRoutes([
    { method: 'ANY', path: '/v1/functions/actions/{actionId}', localHandler: 'seed' },
  ], [
    { method: 'ANY', path: '/v1/functions/actions/{actionId}', localHandler: 'extra' },
    { method: 'GET', path: '/v1/functions/workspaces/{workspaceId}/extra' },
  ]);
  assert.equal(runtime.find((route) => route.path === '/v1/functions/actions/{actionId}').localHandler, 'seed');
  assertFunctionsServed([
    { family: 'functions', method: 'PATCH', path: '/v1/functions/actions/{resourceId}/' },
    { family: 'functions', method: 'GET', path: '/v1/functions/workspaces/{workspaceId}/extra' },
    { family: 'events', method: 'GET', path: '/unrelated' },
  ], runtime);
});
