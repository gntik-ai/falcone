/**
 * Black-box tests for fix-console-operator-shell (P1, live E2E re-run 2026-06-18
 * BUG-CONSOLE-SESSION / F1).
 *
 * Defect: the web-console reconnect-state-sync probe (and other shell code) called
 * `GET /v1/console/session`, but the route was never implemented → 404, breaking the
 * reconnect sync and leaving a dead reference.
 *
 * Fix: implement `/v1/console/session` as a lightweight authenticated whoami that
 * returns the VERIFIED principal (never the request body/headers). The route is
 * `authenticated`, so tenant operators reach it too.
 *
 * Drives the public LOCAL_HANDLERS.consoleSession + the route registration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';
import { routes as seedRoutes } from '../../deploy/kind/control-plane/routes.mjs';

test('bbx-console-session-01: returns the verified principal for an operator (200)', async () => {
  const res = await LOCAL_HANDLERS.consoleSession({
    identity: { sub: 'u1', tenantId: 'acme', workspaceId: 'ws1', actorType: 'tenant_owner', roles: ['tenant_owner'] },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authenticated, true);
  assert.equal(res.body.principal.tenantId, 'acme');
  assert.equal(res.body.principal.actorType, 'tenant_owner');
});

test('bbx-console-session-02: never echoes spoofed identity from the body', async () => {
  const res = await LOCAL_HANDLERS.consoleSession({
    identity: { sub: 'u1', tenantId: 'acme', actorType: 'tenant_owner' },
    body: { tenantId: 'EVIL', actorType: 'superadmin' },
  });
  assert.equal(res.body.principal.tenantId, 'acme', 'principal comes from the verified identity, not the body');
  assert.notEqual(res.body.principal.actorType, 'superadmin');
});

test('bbx-console-session-03: the route is registered as authenticated (reachable by operators)', () => {
  const route = seedRoutes.find((r) => r.method === 'GET' && r.path === '/v1/console/session');
  assert.ok(route, '/v1/console/session GET must be registered (was 404)');
  assert.equal(route.localHandler, 'consoleSession');
  assert.equal(route.auth, 'authenticated', 'must be authenticated (not superadmin-only) so operators can reach it');
});
