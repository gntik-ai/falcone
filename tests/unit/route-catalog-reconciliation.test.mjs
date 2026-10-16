import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes } from '../../apps/control-plane/routes.mjs';

const runtime = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url)));
const catalog = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.json', import.meta.url)));
const newlyWired = catalog.filter(r => r.method && /tenant-roles|workflow-jobs|platform\/secrets\/.*(?:rotate|revoke|consumer-status|history)$|workspaces\/\{workspaceId\}\/capability-catalog|members\/\{memberId\}\/privilege-domains/.test(r.path));

test('all 13 shipped handler routes resolve in the effective runtime table', () => {
  assert.equal(newlyWired.length, 13);
  const effective = new Map([...runtime, ...routes].map(r => [`${r.method} ${r.path}`, r]));
  for (const entry of newlyWired) {
    const key = `${entry.method} ${entry.path}`;
    assert.ok(effective.has(key), `${key} returns NO_ROUTE`);
  }
});

const { loadRoutes, matchRoute } = await import('../../apps/control-plane/route-table.mjs');
test('each new route matches a concrete URL with the real server matcher', () => {
  const table = loadRoutes(runtime, routes);
  for (const entry of newlyWired) {
    const matched = matchRoute(table, entry.method, entry.path.replace(/\{\w+\}/g, 'route-probe'));
    assert.ok(matched, `${entry.method} ${entry.path}`);
    assert.equal(matched.route.export, entry.export);
    assert.equal(matched.route.module, `/repo/${entry.module}`);
  }
});

test('reconciliation detects a removed route, wrong export, and unsupported invoke with METHOD path', async () => {
  const { collectRouteCatalogViolations } = await import('../../scripts/lib/control-plane-routes.mjs');
  const entry = { method: 'GET', path: '/v1/platform/secrets/{domain}/{secretName}/consumer-status', module: 'packages/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs', export: 'main', invoke: 'params-auth-db' };
  const wired = { ...entry, module: `/repo/${entry.module}` };
  const check = options => collectRouteCatalogViolations({ catalog: [entry], runtime: [wired], seed: [], allowlist: [], ...options });
  assert.deepEqual(await check({}), []);
  for (const options of [{ runtime: [] }, { runtime: [{ ...wired, export: 'missingHandler' }] }, { runtime: [{ ...wired, invoke: 'facade' }] }, { catalog: [{ ...entry, export: 'createWorkspaceCapabilityCatalog' }] }]) {
    const errors = await check(options);
    assert.ok(errors.some(error => error.includes(`${entry.method} ${entry.path}`)), JSON.stringify(errors));
  }
});

test('allowlist rejects missing justification, missing issue and stale wired exclusions', async () => {
  const { collectRouteCatalogViolations } = await import('../../scripts/lib/control-plane-routes.mjs');
  const entry = { method: 'GET', path: '/example', module: 'NONE' };
  for (const allow of [{ ...entry, issue: '#985' }, { ...entry, reason: 'not shipped' }, { ...entry, reason: 'not shipped', issue: '#985' }]) {
    const errors = await collectRouteCatalogViolations({ catalog: [entry], runtime: [{ ...entry, localHandler: 'example' }], seed: [], allowlist: [allow] });
    assert.ok(errors.some(error => error.includes('GET /example')), JSON.stringify(errors));
  }
});

test('real catalog agrees with the effective runtime table', async () => {
  const { collectRouteCatalogViolations, readRouteReconciliationInputs } = await import('../../scripts/lib/control-plane-routes.mjs');
  assert.deepEqual(await collectRouteCatalogViolations({ ...await readRouteReconciliationInputs(), checkExports: false }), []);
});

test('real catalog handler exports are functions (hermetic import check)', async t => {
  const { collectRouteCatalogViolations, readRouteReconciliationInputs } = await import('../../scripts/lib/control-plane-routes.mjs');
  let errors;
  try { errors = await collectRouteCatalogViolations(await readRouteReconciliationInputs()); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find package /.test(error.message)) {
      t.skip(`Sandbox dependency unavailable: ${error.message}`); return;
    }
    throw error;
  }
  assert.deepEqual(errors, []);
});

test('removing any newly wired route fails reconciliation and names its METHOD path', async () => {
  const { collectRouteCatalogViolations, readRouteReconciliationInputs } = await import('../../scripts/lib/control-plane-routes.mjs');
  const inputs = await readRouteReconciliationInputs();
  for (const entry of newlyWired) {
    const errors = await collectRouteCatalogViolations({ ...inputs, checkExports: false,
      runtime: runtime.filter(route => `${route.method} ${route.path}` !== `${entry.method} ${entry.path}`) });
    assert.ok(errors.some(error => error.startsWith(`${entry.method} ${entry.path}`)), `${entry.method} ${entry.path}`);
  }
});

test('handler export introspection is isolated from the caller environment', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { collectRouteCatalogViolations } = await import('../../scripts/lib/control-plane-routes.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'falcone-route-import-'));
  const module = join(directory, 'handler.mjs');
  await writeFile(module, 'export const main = process.env.FALCONE_ROUTE_IMPORT_PROBE ? null : () => {};');
  process.env.FALCONE_ROUTE_IMPORT_PROBE = 'test-only';
  try {
    const entry = { method: 'GET', path: '/environment-probe', module, export: 'main', invoke: 'params-only' };
    assert.deepEqual(await collectRouteCatalogViolations({ catalog: [entry], runtime: [entry], seed: [], allowlist: [] }), []);
  } finally {
    delete process.env.FALCONE_ROUTE_IMPORT_PROBE;
    await rm(directory, { recursive: true, force: true });
  }
});

test('plan lifecycle history resolves as an internal superadmin route with pagination', () => {
  const path = '/v1/plans/{planId}/lifecycle-history';
  const matched = matchRoute(loadRoutes(runtime, routes), 'GET', '/v1/plans/plan-a/lifecycle-history');
  assert.ok(matched);
  assert.equal(matched.route.module, '/repo/packages/provisioning-orchestrator/src/actions/plan-lifecycle-history.mjs');
  assert.equal(matched.route.auth, 'superadmin');
  assert.equal(matched.route.invoke, 'callercontext-overrides');
  assert.equal(matched.route.mergeQueryIntoParams, true);
  assert.deepEqual(matched.route.deps, ['db']);
  assert.ok(catalog.some(route => route.path === path && route.family === 'plans' && route.auth === 'superadmin'));
});
