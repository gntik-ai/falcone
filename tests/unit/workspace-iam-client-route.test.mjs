import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes } from '../../apps/control-plane/routes.mjs';
import { createWorkspaceIamClient } from '../../apps/control-plane/workspace-iam-client-handlers.mjs';

test('wizard POST resolves to a workspace IAM client handler instead of NO_ROUTE', () => {
  const path = '/v1/workspaces/{workspaceId}/iam/clients';
  const route = routes.find((r) => r.method === 'POST' && r.path === path);
  assert.ok(route, 'POST wizard payload returns NO_ROUTE without a registered route');
  assert.equal(route.localHandler, 'createWorkspaceIamClient');
  assert.equal(route.auth, 'authenticated');
  const catalog = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.json', import.meta.url)));
  const entry = catalog.find((r) => r.method === 'POST' && r.path === path);
  assert.equal(entry.module, 'apps/control-plane/b-handlers.mjs');
  assert.equal(entry.export, 'LOCAL_HANDLERS.createWorkspaceIamClient');
  assert.equal(entry.invoke, 'ctx');
  assert.doesNotMatch(entry.notes, /GAP/);
  assert.equal(typeof createWorkspaceIamClient, 'function');
});

test('the packaged runtime map and control-plane image include workspace IAM creation', () => {
  const runtime = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url)));
  assert.equal(runtime.find((r) => r.method === 'POST' && r.path === '/v1/workspaces/{workspaceId}/iam/clients')?.localHandler, 'createWorkspaceIamClient');
  const dockerfile = readFileSync(new URL('../../apps/control-plane/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /apps\/control-plane\/workspace-iam-client-handlers\.mjs/);
  assert.match(dockerfile, /apps\/control-plane\/workspace-iam-context\.mjs/);
});
