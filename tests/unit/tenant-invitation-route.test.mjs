import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { routes } from '../../deploy/kind/control-plane/routes.mjs';
import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';

const ROUTE_PATH = '/v1/tenants/{tenantId}/invitations';
const runtimeRouteMap = JSON.parse(readFileSync(new URL('../../deploy/kind/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));

function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

function compileRoutes(routeTable) {
  return routeTable
    .map((r) => ({ ...r, _rx: compilePath(r.path) }))
    .sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
      || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
}

function matchRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function fakeStore({ workspace = { id: 'wrk_alpha', tenant_id: 'ten_alpha' } } = {}) {
  const calls = [];
  return {
    calls,
    async getTenant(_pool, tenantId) {
      calls.push(['getTenant', tenantId]);
      return tenantId === 'ten_alpha'
        ? { id: 'ten_alpha', slug: 'alpha', display_name: 'Tenant Alpha', iam_realm: 'ten_alpha' }
        : null;
    },
    async getWorkspace(_pool, workspaceId) {
      calls.push(['getWorkspace', workspaceId]);
      return workspaceId === workspace?.id ? workspace : null;
    },
    async insertInvitation(_pool, invitation) {
      calls.push(['insertInvitation', invitation]);
      return {
        ...invitation,
        tenant_id: invitation.tenantId,
        workspace_id: invitation.workspaceId,
        created_at: '2099-03-28T18:00:00.000Z',
      };
    },
  };
}

function ctx({ identity, body, store = fakeStore() } = {}) {
  return {
    params: { tenantId: 'ten_alpha' },
    body: body ?? {
      email: 'guest@example.com',
      role: 'workspace_admin',
      message: 'Hola',
      workspaceId: 'wrk_alpha',
    },
    identity: identity ?? {
      actorType: 'tenant_owner',
      tenantId: 'ten_alpha',
      sub: 'usr_owner',
      roles: ['tenant_owner'],
      workspaceIds: [],
    },
    pool: {},
    store,
    callerContext: { correlationId: 'corr_759_unit' },
  };
}

test('fix-759-10: invitation route resolves to a deployed local handler, not NO_ROUTE', () => {
  const route = routes.find((r) => r.method === 'POST' && r.path === ROUTE_PATH);
  assert.ok(route, `${ROUTE_PATH} must be registered in seed routes`);
  assert.equal(route.localHandler, 'createInvitation');
  assert.equal(route.auth, 'authenticated');
  assert.equal(typeof LOCAL_HANDLERS.createInvitation, 'function');

  const hit = matchRoute(compileRoutes(routes), 'POST', '/v1/tenants/ten_alpha/invitations');
  assert.ok(hit, 'console invitation request must resolve to a route');
  assert.equal(hit.route.localHandler, 'createInvitation');
  assert.equal(hit.params.tenantId, 'ten_alpha');

  const runtimeRoute = runtimeRouteMap.find((r) => r.method === 'POST' && r.path === ROUTE_PATH);
  assert.ok(runtimeRoute, `${ROUTE_PATH} must be present in route-map.runtime.json loaded by the kind image`);
  assert.equal(runtimeRoute.localHandler, 'createInvitation');
});

test('fix-759-11: tenant owner invitation persists masked/hash email and returns MutationAccepted', async () => {
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({ store }));

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.entityType, 'invitation');
  assert.equal(res.body.status, 'accepted');
  assert.equal(res.body.acceptedEventType, 'iam.invitation.created');
  assert.equal(res.body.tenantId, 'ten_alpha');
  assert.equal(res.body.workspaceId, 'wrk_alpha');
  assert.match(res.body.entityId, /^inv_[0-9a-f]+$/);

  const insert = store.calls.find(([name]) => name === 'insertInvitation');
  assert.ok(insert, 'handler must persist an invitation record');
  const invitation = insert[1];
  assert.equal(invitation.tenantId, 'ten_alpha');
  assert.equal(invitation.workspaceId, 'wrk_alpha');
  assert.equal(invitation.role, 'workspace_admin');
  assert.equal(invitation.maskedEmail, 'g***t@example.com');
  assert.match(invitation.emailHash, /^[0-9a-f]{64}$/);
  assert.equal('email' in invitation, false);
  assert.equal(invitation.metadata.message, 'Hola');
  assert.deepEqual(invitation.targetBindings, [
    { bindingType: 'tenant', bindingRef: 'ten_alpha' },
    { bindingType: 'workspace', bindingRef: 'wrk_alpha' },
  ]);
  for (const binding of invitation.targetBindings) {
    assert.equal('targetType' in binding, false);
    assert.equal('tenantId' in binding, false);
    assert.equal('workspaceId' in binding, false);
    assert.equal('role' in binding, false);
  }
});

test('fix-759-11a: caller-supplied maskedEmail cannot persist the raw invitee address', async () => {
  const rawEmail = 'guest@example.com';
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({
    store,
    body: {
      email: rawEmail,
      maskedEmail: rawEmail,
      role: 'workspace_viewer',
      message: 'Hola',
      workspaceId: 'wrk_alpha',
    },
  }));

  assert.equal(res.statusCode, 202);
  const insert = store.calls.find(([name]) => name === 'insertInvitation');
  assert.ok(insert, 'handler must persist an invitation record');
  const invitation = insert[1];
  assert.equal(invitation.maskedEmail, 'g***t@example.com');
  assert.equal('email' in invitation, false);
  assert.equal(JSON.stringify(invitation).includes(rawEmail), false);
});

test('fix-759-11b: hash-only invitations do not trust caller-supplied maskedEmail', async () => {
  const rawEmail = 'guest@example.com';
  const emailHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({
    store,
    body: {
      emailHash,
      maskedEmail: rawEmail,
      role: 'workspace_viewer',
      workspaceId: 'wrk_alpha',
    },
  }));

  assert.equal(res.statusCode, 202);
  const insert = store.calls.find(([name]) => name === 'insertInvitation');
  assert.ok(insert, 'handler must persist an invitation record');
  const invitation = insert[1];
  assert.equal(invitation.emailHash, emailHash);
  assert.equal(invitation.maskedEmail, null);
  assert.equal('email' in invitation, false);
  assert.equal(JSON.stringify(invitation).includes(rawEmail), false);
});

test('fix-759-11b-1: hash-only invitations reject raw-email emailHash values', async () => {
  const rawEmail = 'guest@example.com';
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({
    store,
    body: {
      emailHash: rawEmail,
      role: 'workspace_viewer',
      workspaceId: 'wrk_alpha',
    },
  }));

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.match(res.body.message, /emailHash must be a SHA-256 hex digest/);
  assert.equal(store.calls.some(([name]) => name === 'insertInvitation'), false);
});

test('fix-759-11b-2: email input overrides a mismatched caller-supplied emailHash', async () => {
  const rawEmail = 'guest@example.com';
  const mismatchedHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({
    store,
    body: {
      email: rawEmail,
      emailHash: mismatchedHash,
      role: 'workspace_viewer',
      workspaceId: 'wrk_alpha',
    },
  }));

  assert.equal(res.statusCode, 202);
  const insert = store.calls.find(([name]) => name === 'insertInvitation');
  assert.ok(insert, 'handler must persist an invitation record');
  const invitation = insert[1];
  assert.equal(invitation.emailHash, sha256Hex(rawEmail));
  assert.notEqual(invitation.emailHash, mismatchedHash);
  assert.equal(invitation.maskedEmail, 'g***t@example.com');
  assert.equal('email' in invitation, false);
  assert.equal(JSON.stringify(invitation).includes(rawEmail), false);
});

test('fix-759-11c: caller-supplied metadata cannot smuggle raw email or bindings', async () => {
  const rawEmail = 'guest@example.com';
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({
    store,
    body: {
      email: rawEmail,
      role: 'workspace_viewer',
      message: 'Hola',
      workspaceId: 'wrk_alpha',
      metadata: {
        email: rawEmail,
        maskedEmail: rawEmail,
        targetBindings: [
          { bindingType: 'tenant', bindingRef: 'ten_beta' },
          { bindingType: 'workspace', bindingRef: 'wrk_beta' },
        ],
      },
    },
  }));

  assert.equal(res.statusCode, 202);
  const insert = store.calls.find(([name]) => name === 'insertInvitation');
  assert.ok(insert, 'handler must persist an invitation record');
  const invitation = insert[1];
  assert.deepEqual(invitation.metadata, { message: 'Hola' });
  assert.equal(JSON.stringify(invitation.metadata).includes(rawEmail), false);
  assert.deepEqual(invitation.targetBindings, [
    { bindingType: 'tenant', bindingRef: 'ten_alpha' },
    { bindingType: 'workspace', bindingRef: 'wrk_alpha' },
  ]);
  assert.equal(
    invitation.targetBindings.some((binding) => ['ten_beta', 'wrk_beta'].includes(binding.bindingRef)),
    false,
  );
});

test('fix-759-12: workspace admin can invite only for a verified workspace binding', async () => {
  const allowedStore = fakeStore();
  const allowed = await LOCAL_HANDLERS.createInvitation(ctx({
    store: allowedStore,
    identity: {
      actorType: 'workspace_admin',
      tenantId: 'ten_alpha',
      sub: 'usr_ws_admin',
      roles: ['workspace_admin'],
      workspaceIds: ['wrk_alpha'],
    },
  }));
  assert.equal(allowed.statusCode, 202);
  assert.equal(allowedStore.calls.some(([name]) => name === 'insertInvitation'), true);

  const deniedStore = fakeStore();
  const denied = await LOCAL_HANDLERS.createInvitation(ctx({
    store: deniedStore,
    identity: {
      actorType: 'workspace_admin',
      tenantId: 'ten_alpha',
      sub: 'usr_ws_admin',
      roles: ['workspace_admin'],
      workspaceIds: ['wrk_other'],
    },
  }));
  assert.equal(denied.statusCode, 403);
  assert.equal(deniedStore.calls.some(([name]) => name === 'insertInvitation'), false);
});

test('fix-759-13: workspace admin cannot grant tenant-scope roles through a workspace invite', async () => {
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({
    store,
    identity: {
      actorType: 'workspace_admin',
      tenantId: 'ten_alpha',
      sub: 'usr_ws_admin',
      roles: ['workspace_admin'],
      workspaceIds: ['wrk_alpha'],
    },
    body: {
      email: 'guest@example.com',
      role: 'tenant_owner',
      message: 'Hola',
      workspaceId: 'wrk_alpha',
    },
  }));

  assert.equal(res.statusCode, 403);
  assert.equal(store.calls.some(([name]) => name === 'insertInvitation'), false);
});

test('fix-759-14: caller-supplied targetBindings cannot smuggle cross-scope invitation bindings', async () => {
  const store = fakeStore();
  const res = await LOCAL_HANDLERS.createInvitation(ctx({
    store,
    identity: {
      actorType: 'workspace_admin',
      tenantId: 'ten_alpha',
      sub: 'usr_ws_admin',
      roles: ['workspace_admin'],
      workspaceIds: ['wrk_alpha'],
    },
    body: {
      email: 'guest@example.com',
      role: 'workspace_viewer',
      message: 'Hola',
      workspaceId: 'wrk_alpha',
      targetBindings: [
        { bindingType: 'tenant', bindingRef: 'ten_beta' },
        { bindingType: 'workspace', bindingRef: 'wrk_beta' },
      ],
    },
  }));

  assert.equal(res.statusCode, 202);
  const insert = store.calls.find(([name]) => name === 'insertInvitation');
  assert.ok(insert, 'handler must persist a derived invitation record');
  const invitation = insert[1];
  assert.equal(invitation.tenantId, 'ten_alpha');
  assert.equal(invitation.workspaceId, 'wrk_alpha');
  assert.deepEqual(invitation.targetBindings, [
    { bindingType: 'tenant', bindingRef: 'ten_alpha' },
    { bindingType: 'workspace', bindingRef: 'wrk_alpha' },
  ]);
  assert.equal(
    invitation.targetBindings.some((binding) => ['ten_beta', 'wrk_beta'].includes(binding.bindingRef)),
    false,
  );
});
