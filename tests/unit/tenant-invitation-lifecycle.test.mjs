import test from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../../apps/control-plane/routes.mjs';

test('975: invitation lifecycle operations reach local handlers', () => {
  for (const [method, suffix, handler] of [
    ['GET', '', 'listInvitations'], ['GET', '/{invitationId}', 'getInvitation'],
    ['POST', '/{invitationId}/acceptance', 'acceptInvitation'],
    ['POST', '/{invitationId}/revocation', 'revokeInvitation'],
    ['POST', '/{invitationId}/resend', 'resendInvitation'],
  ]) {
    const route = routes.find(r => r.method === method && r.path === `/v1/tenants/{tenantId}/invitations${suffix}`);
    assert.ok(route, `${method} ${suffix || 'collection'} must resolve instead of NO_ROUTE`);
    assert.equal(route.localHandler, handler);
  }
});


// Database and identity-provider boundaries only; production repositories and handlers are real.
function database() {
  const rows = new Map();
  const audit = [];
  return { rows, audit, async connect() { return { query: this.query.bind(this), release() {} }; },
    async query(sql, args = []) {
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/SELECT row_hash/.test(sql)) return { rows: [] };
      if (/INSERT INTO plan_audit_events/.test(sql)) { audit.push(JSON.parse(args[5])); return { rows: [{ id: args[0] }] }; }
      if (/FROM tenants/.test(sql)) return { rows: args[0] === 'ten_alpha' ? [{ id: 'ten_alpha', iam_realm: 'ten_alpha' }] : [] };
      if (/FROM workspaces/.test(sql)) return { rows: ['wrk_alpha', 'workspace-alpha'].includes(args[0]) ? [{ id: 'wrk_alpha', tenant_id: 'ten_alpha' }] : [] };
      if (/INSERT INTO tenant_invitations/.test(sql)) {
        const [id, tenant_id, workspace_id, email_hash, token_hash, email_hmac_key_id, role, expires_at, created_by] = args;
        const row = { id, tenant_id, workspace_id, email_hash, token_hash, email_hmac_key_id, role, expires_at, created_by, status: 'pending', masked_email: null, created_at: '2026-10-09T00:00:00.000Z' };
        rows.set(id, row); return { rows: [{ ...row }] };
      }
      if (/SELECT .* FROM tenant_invitations/s.test(sql)) {
        const selected = [...rows.values()].filter(r => r.tenant_id === args[0]);
        if (/id = \$2/.test(sql)) return { rows: selected.filter(r => r.id === args[1]).map(r => ({ ...r })) };
        if (/token_hash = \$2/.test(sql)) return { rows: selected.filter(r => r.token_hash === args[1]).map(r => ({ ...r })) };
        return { rows: selected.filter(r => args[1] == null || args[1].includes(r.workspace_id)).map(r => ({ ...r })) };
      }
      if (/UPDATE tenant_invitations/.test(sql)) {
        const row = rows.get(args[1]);
        if (!row || row.tenant_id !== args[0]) return { rows: [] };
        if (/SET status='accepted'/.test(sql)) {
          if (row.status !== 'pending' || Date.parse(row.expires_at) <= Date.now() || row.token_hash !== args[2] || row.email_hash !== args[3] || row.email_hmac_key_id !== args[4]) return { rows: [] };
          row.status = 'accepted'; row.accepted_at = new Date().toISOString();
        } else if (/SET accepted_by/.test(sql)) { row.accepted_by = args[2]; }
        else if (/SET status='failed'/.test(sql)) { row.status = 'failed'; }
        else if (/SET status='revoked'/.test(sql)) {
          if (row.status !== 'pending') return { rows: [] };
          row.status = 'revoked'; row.revoked_by = args[2];
        } else if (/SET status='pending'/.test(sql)) {
          if (!['pending', 'expired', 'revoked', 'failed'].includes(row.status)) return { rows: [] };
          Object.assign(row, { status: 'pending', token_hash: args[2], email_hash: args[3], email_hmac_key_id: args[4], expires_at: args[5] });
        }
        else throw new Error(`Unexpected update: ${sql}`);
        return { rows: [{ ...row }] };
      }
      throw new Error(`Unexpected database operation: ${sql}`);
    }
  };
}
const owner = { sub: 'owner', actorType: 'tenant_owner', tenantId: 'ten_alpha' };
function context(pool = database(), body = { email: 'Guest@Example.com', role: 'workspace_admin', workspaceId: 'wrk_alpha' }) {
  return { pool, body, params: { tenantId: 'ten_alpha' }, identity: owner, invitationKey: { id: 'test-key', key: 'test-only-key-with-at-least-32-bytes' } };
}

test('975: create returns one-time proof but persists only keyed identifiers and safe audit', async () => {
  const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const { createHash } = await import('node:crypto');
  const ctx = context();
  const res = await INVITATION_HANDLERS.createInvitation(ctx);
  assert.equal(res.statusCode, 202);
  assert.match(res.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(res.body.expiresAt) > Date.now());
  const row = ctx.pool.rows.get(res.body.id);
  assert.equal(row.masked_email, null);
  assert.equal(row.email_hmac_key_id, 'test-key');
  assert.notEqual(row.email_hash, createHash('sha256').update('guest@example.com').digest('hex'));
  assert.equal(row.token_hash, createHash('sha256').update(res.body.token).digest('hex'));
  assert.equal(JSON.stringify([...ctx.pool.rows.values(), ...ctx.pool.audit]).includes('guest@example.com'), false);
  assert.equal(JSON.stringify([...ctx.pool.rows.values(), ...ctx.pool.audit]).includes(res.body.token), false);
  assert.equal(ctx.pool.audit[0].eventType, 'iam.invitation.created');
});


test('975: reads expose expiry and safe fields, with tenant and workspace isolation', async () => {
  const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const created = await handlers.createInvitation(ctx);
  ctx.params.invitationId = created.body.id;
  ctx.pool.rows.get(created.body.id).expires_at = '2000-01-01T00:00:00.000Z';
  const read = await handlers.getInvitation(ctx);
  assert.deepEqual(read.body, { id: created.body.id, workspaceId: 'wrk_alpha', role: 'workspace_admin', status: 'expired', expiresAt: '2000-01-01T00:00:00.000Z', createdAt: '2026-10-09T00:00:00.000Z' });
  assert.deepEqual((await handlers.listInvitations(ctx)).body.items, [read.body]);
  assert.equal((await handlers.getInvitation({ ...ctx, identity: { ...owner, tenantId: 'ten_beta' } })).statusCode, 404);
  assert.equal((await handlers.getInvitation({ ...ctx, identity: { ...owner, actorType: 'tenant_developer' } })).statusCode, 403);
  const workspaceOwner = { sub: 'workspace-owner', actorType: 'workspace_owner', roles: ['workspace_owner'], tenantId: 'ten_alpha', workspaceId: 'wrk_alpha' };
  assert.deepEqual((await handlers.listInvitations({ ...ctx, identity: workspaceOwner })).body.items, [read.body]);
  assert.equal((await handlers.getInvitation({ ...ctx, identity: { ...workspaceOwner, workspaceId: 'wrk_beta' } })).statusCode, 403);
});


function identityProvider({ existing = null, fail = false } = {}) {
  const users = existing ? [structuredClone(existing)] : [];
  const granted = [];
  const requests = [];
  return { users, granted, requests,
    async findUsersByEmail(_realm, email) { return users.filter(u => u.email.toLowerCase() === email); },
    async createUser(_realm, user) { requests.push('createUser'); if (fail) throw new Error('boundary failure'); users.push({ id: 'guest-id', ...user }); return 'guest-id'; },
    async updateUser(_realm, id, patch) { Object.assign(users.find(u => u.id === id), patch); },
    async deleteUser(_realm, id) { users.splice(users.findIndex(u => u.id === id), 1); },
    async assignRealmRoles(_realm, id, roles) { requests.push('assignRealmRoles'); if (fail) throw new Error('boundary failure'); granted.push({ id, roles }); },
    async removeRealmRoles() { granted.splice(0); },
    async listUserRealmRoles() { return []; }
  };
}

test('975: single-use acceptance grants the bound role once under concurrent requests', async () => {
  const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const created = await handlers.createInvitation(ctx);
  const kc = identityProvider();
  const accept = { ...ctx, identity: null, kcAdmin: kc, params: { ...ctx.params, invitationId: created.body.id }, body: { token: created.body.token, email: 'guest@example.com', password: 'CorrectHorse12' } };
  const results = await Promise.all([handlers.acceptInvitation(accept), handlers.acceptInvitation(accept)]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 400]);
  assert.equal(kc.users.length, 1);
  assert.equal(kc.users[0].emailVerified, true);
  assert.deepEqual(kc.users[0].attributes, { tenant_id: ['ten_alpha'], workspace_id: ['wrk_alpha'] });
  assert.deepEqual(kc.granted, [{ id: 'guest-id', roles: ['workspace_admin'] }]);
  assert.equal(ctx.pool.rows.get(created.body.id).status, 'accepted');
  assert.equal(ctx.pool.audit.at(-1).eventType, 'iam.invitation.accepted');
  assert.equal((await handlers.acceptInvitation(accept)).statusCode, 400);
  assert.equal(kc.users.length, 1);
});


test('975: revoke invalidates proof, resend rotates it, accepted rows cannot be changed', async () => {
  const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const created = await handlers.createInvitation(ctx);
  ctx.params.invitationId = created.body.id;
  assert.equal((await handlers.revokeInvitation(ctx)).statusCode, 200);
  const kc = identityProvider();
  const accept = token => handlers.acceptInvitation({ ...ctx, identity: null, kcAdmin: kc, body: { email: 'guest@example.com', token, password: 'CorrectHorse12' } });
  assert.equal((await accept(created.body.token)).statusCode, 400);
  assert.equal(kc.users.length, 0);
  const resent = await handlers.resendInvitation({ ...ctx, body: { email: 'guest@example.com' } });
  assert.equal(resent.statusCode, 202);
  assert.notEqual(resent.body.token, created.body.token);
  assert.equal((await accept(created.body.token)).statusCode, 400);
  assert.equal((await accept(resent.body.token)).statusCode, 201);
  assert.equal((await handlers.revokeInvitation(ctx)).statusCode, 409);
  assert.equal((await handlers.resendInvitation(ctx)).statusCode, 409);
  assert.deepEqual(ctx.pool.audit.map(e => e.eventType), ['iam.invitation.created', 'iam.invitation.revoked', 'iam.invitation.resent', 'iam.invitation.accepted']);
});


test('975: invitation signup is denied without proof and shares the acceptance path', async () => {
  const prior = process.env.CONSOLE_SIGNUP_SELF_SERVICE;
  process.env.CONSOLE_SIGNUP_SELF_SERVICE = 'false';
  const { AUTH_HANDLERS } = await import('../../apps/control-plane/auth-handlers.mjs?975-invitation-mode');
  if (prior === undefined) delete process.env.CONSOLE_SIGNUP_SELF_SERVICE; else process.env.CONSOLE_SIGNUP_SELF_SERVICE = prior;
  const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const kc = identityProvider();
  const signup = { ...ctx, kcAdmin: kc, body: { tenantId: 'ten_alpha', primaryEmail: 'guest@example.com', username: 'guest', password: 'CorrectHorse12' } };
  assert.equal((await AUTH_HANDLERS.signup(signup)).statusCode, 403);
  assert.equal(kc.users.length, 0);
  const invite = await INVITATION_HANDLERS.createInvitation(ctx);
  const accepted = await AUTH_HANDLERS.signup({ ...signup, body: { ...signup.body, invitationToken: invite.body.token } });
  assert.equal(accepted.statusCode, 201);
  assert.equal(kc.users[0].emailVerified, true);
  assert.equal(ctx.pool.rows.get(invite.body.id).status, 'accepted');
});

test('975: public signup never verifies an invited address or grants its role', async () => {
  const { AUTH_HANDLERS } = await import('../../apps/control-plane/auth-handlers.mjs');
  const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const invite = await INVITATION_HANDLERS.createInvitation(ctx);
  const kc = identityProvider();
  const res = await AUTH_HANDLERS.signup({ ...ctx, kcAdmin: kc, body: { tenantId: 'ten_alpha', primaryEmail: 'guest@example.com', username: 'guest', password: 'CorrectHorse12', roles: ['workspace_admin'] } });
  assert.equal(res.statusCode, 201);
  assert.equal(kc.users[0].emailVerified, false);
  assert.deepEqual(kc.granted, []);
  assert.equal(ctx.pool.rows.get(invite.body.id).status, 'pending');
});

test('975: kc-admin createUser does not verify an email by default', async () => {
  const { kcAdmin } = await import('../../apps/control-plane/kc-admin.mjs');
  const original = globalThis.fetch;
  let user;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/protocol/openid-connect/token')) return new Response(JSON.stringify({ access_token: 'test-only', expires_in: 300 }), { status: 200 });
    user = JSON.parse(options.body);
    return new Response(null, { status: 201, headers: { location: 'http://keycloak.invalid/users/test-id' } });
  };
  try {
    assert.equal(await kcAdmin.createUser('tenant-test', { username: 'guest', email: 'guest@example.com' }), 'test-id');
    assert.equal(user.emailVerified, false);
  } finally { globalThis.fetch = original; }
});

test('975: tenant user collection includes realm roles', async () => {
  const { listTenantUsers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const result = await listTenantUsers({ ...context(), kcAdmin: {
    async listUsers() { return [{ id: 'user-1', username: 'guest' }]; },
    async listUserRealmRoles() { return [{ name: 'tenant_developer' }, { name: 'custom_tenant_role' }, { name: 'default-roles-ten_alpha' }]; }
  } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.items[0].roles, ['tenant_developer', 'custom_tenant_role']);
});

for (const scenario of ['invalid', 'expired', 'revoked', 'reused', 'legacy', 'wrong-email', 'other-tenant', 'old-key', 'query-token']) {
  test(`975: ${scenario} acceptance changes neither membership nor invitation`, async () => {
    const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
    const ctx = context();
    const created = await handlers.createInvitation(ctx);
    const row = ctx.pool.rows.get(created.body.id);
    if (scenario === 'expired') row.expires_at = '2000-01-01T00:00:00.000Z';
    if (scenario === 'revoked') row.status = 'revoked';
    if (scenario === 'reused') row.status = 'accepted';
    if (scenario === 'legacy') row.token_hash = null;
    if (scenario === 'old-key') row.email_hmac_key_id = 'retired-key';
    const before = structuredClone(row);
    const kc = identityProvider();
    const body = { token: scenario === 'invalid' ? 'x'.repeat(43) : created.body.token,
      email: scenario === 'wrong-email' ? 'other@example.com' : 'guest@example.com', password: 'CorrectHorse12' };
    if (scenario === 'query-token') delete body.token;
    const result = await handlers.acceptInvitation({ ...ctx, kcAdmin: kc, identity: null,
      params: { tenantId: scenario === 'other-tenant' ? 'ten_beta' : 'ten_alpha', invitationId: row.id },
      query: { token: created.body.token }, body });
    assert.equal(result.statusCode, 400);
    assert.deepEqual(result.body, { code: 'INVITATION_INVALID', message: 'Invitation cannot be accepted' });
    assert.deepEqual(kc.users, []);
    assert.deepEqual(kc.granted, []);
    assert.deepEqual(kc.requests, []);
    assert.deepEqual(row, before);
  });
}

test('975: Keycloak failure consumes proof and permits explicit resend retry', async () => {
  const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const created = await handlers.createInvitation(ctx);
  ctx.params.invitationId = created.body.id;
  const accept = { ...ctx, identity: null, kcAdmin: identityProvider({ fail: true }), body: { token: created.body.token, email: 'guest@example.com', password: 'CorrectHorse12' } };
  assert.equal((await handlers.acceptInvitation(accept)).statusCode, 502);
  assert.equal(ctx.pool.rows.get(created.body.id).status, 'failed');
  assert.equal((await handlers.acceptInvitation(accept)).statusCode, 400);
  assert.equal((await handlers.resendInvitation(ctx)).statusCode, 202);
});

test('975: linking requires the existing principal and never overwrites a foreign workspace binding', async () => {
  const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const created = await handlers.createInvitation(ctx);
  const kc = identityProvider({ existing: { id: 'existing-user', email: 'guest@example.com', emailVerified: false, attributes: {} } });
  const accept = { ...ctx, kcAdmin: kc, params: { ...ctx.params, invitationId: created.body.id }, body: { token: created.body.token, email: 'guest@example.com' } };
  assert.equal((await handlers.acceptInvitation({ ...accept, identity: null })).statusCode, 400);
  assert.deepEqual(kc.granted, []);
  const signedIn = { sub: 'existing-user', tenantId: 'ten_alpha', actorType: 'tenant_viewer' };
  assert.equal((await handlers.acceptInvitation({ ...accept, identity: signedIn })).statusCode, 201);
  assert.equal(kc.users.length, 1);
  assert.equal(kc.users[0].emailVerified, true);
  assert.deepEqual(kc.granted, [{ id: 'existing-user', roles: ['workspace_admin'] }]);
});

test('975: missing HMAC key fails closed on every invitation route', async () => {
  const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  for (const handler of Object.values(INVITATION_HANDLERS)) {
    assert.equal((await handler({ ...ctx, invitationKey: { id: 'missing', key: '' } })).statusCode, 503);
  }
  assert.equal(ctx.pool.rows.size, 0);
});

test('975: acceptance permits new invitees and resolves the signed-in principal for account linking', () => {
  const route = routes.find(r => r.localHandler === 'acceptInvitation');
  assert.equal(route.auth, 'public');
  assert.equal(route.optionalIdentity, true);
});

test('975: every invitation contract operation has a local route mapping and IAM family entry', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json'));
  const iam = JSON.parse(readFileSync('apps/control-plane-executor/openapi/families/iam.openapi.json'));
  const runtime = JSON.parse(readFileSync('apps/control-plane/route-map.runtime.json'));
  const mapped = JSON.parse(readFileSync('apps/control-plane/route-map.json'));
  const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const operations = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).filter(([, op]) => op['x-resource-type'] === 'invitation').map(([method, op]) => ({ path, method, op })));
  assert.deepEqual(operations.map(({ op }) => op.operationId).sort(), ['acceptInvitation', 'createInvitation', 'getInvitation', 'listInvitations', 'resendInvitation', 'revokeInvitation']);
  for (const { path, method, op } of operations) {
    assert.equal(iam.paths[path]?.[method]?.operationId, op.operationId);
    assert.ok(mapped.some(r => r.operationId === op.operationId && r.path === path && r.method === method.toUpperCase()));
    const route = runtime.find(r => r.path === path && r.method === method.toUpperCase());
    assert.equal(route?.localHandler, op.operationId);
    assert.equal(typeof INVITATION_HANDLERS[route.localHandler], 'function');
  }
  assert.equal(doc.components.schemas.Invitation.properties.emailHash, undefined);
  assert.equal(doc.components.schemas.InvitationWriteRequest.properties.emailHash, undefined);
});

for (const [label, identity, body, expected] of [
  ['workspace owner', { sub: 'workspace-owner', actorType: 'workspace_owner', roles: ['workspace_owner'], tenantId: 'ten_alpha', workspaceId: 'wrk_alpha' }, { email: 'guest@example.com', role: 'viewer', workspaceId: 'wrk_alpha' }, 202],
  ['cross tenant', { ...owner, tenantId: 'ten_beta' }, undefined, 404],
  ['tenant developer', { ...owner, actorType: 'tenant_developer' }, undefined, 403],
  ['workspace scope', { ...owner, actorType: 'workspace_admin', workspaceId: 'wrk_other' }, undefined, 403],
  ['workspace tenant role', { ...owner, actorType: 'workspace_admin', workspaceId: 'wrk_alpha' }, { email: 'guest@example.com', role: 'tenant_admin', workspaceId: 'wrk_alpha' }, 403],
  ['hash only', owner, { emailHash: 'a'.repeat(64), role: 'tenant_admin' }, 400],
  ['foreign workspace', owner, { email: 'guest@example.com', role: 'workspace_admin', workspaceId: 'wrk_beta' }, 404],
]) {
  test(`975: create enforces ${label}`, async () => {
    const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
    const ctx = context(undefined, body);
    const result = await INVITATION_HANDLERS.createInvitation({ ...ctx, identity });
    assert.equal(result.statusCode, expected);
    assert.equal(ctx.pool.rows.size, expected === 202 ? 1 : 0);
  });
}

test('975: arbitrary message and metadata cannot persist recipient hints or forged bindings', async () => {
  const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  ctx.body.message = 'guest@example.com';
  ctx.body.metadata = { email: 'guest@example.com', maskedEmail: 'g***t@example.com' };
  ctx.body.targetBindings = [{ bindingRef: 'ten_beta' }];
  assert.equal((await INVITATION_HANDLERS.createInvitation(ctx)).statusCode, 202);
  const persisted = JSON.stringify([...ctx.pool.rows.values()]);
  assert.equal(persisted.includes('guest@example.com'), false);
  assert.equal(persisted.includes('g***t@example.com'), false);
  assert.equal(persisted.includes('ten_beta'), false);
});

test('975: failed linking restores existing verification and binding before resend', async () => {
  const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const invite = await handlers.createInvitation(ctx);
  const original = { id: 'existing-user', email: 'guest@example.com', emailVerified: false, attributes: { locale: ['en'] } };
  const kc = identityProvider({ existing: original, fail: true });
  const res = await handlers.acceptInvitation({ ...ctx, kcAdmin: kc,
    identity: { sub: 'existing-user', tenantId: 'ten_alpha' },
    params: { ...ctx.params, invitationId: invite.body.id }, body: { email: 'guest@example.com', token: invite.body.token } });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(kc.users, [original]);
  assert.equal(ctx.pool.rows.get(invite.body.id).status, 'failed');
});

test('975: invitation account creation preserves the configured signup password minimum', async () => {
  const { INVITATION_HANDLERS: handlers } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context();
  const invite = await handlers.createInvitation(ctx);
  const kc = identityProvider();
  const prior = process.env.CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH;
  process.env.CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH = '16';
  try {
    const result = await handlers.acceptInvitation({ ...ctx, kcAdmin: kc, identity: null,
      params: { ...ctx.params, invitationId: invite.body.id }, body: { token: invite.body.token, email: 'guest@example.com', password: 'short123' } });
    assert.equal(result.statusCode, 400);
    assert.deepEqual(kc.requests, []);
    assert.equal(ctx.pool.rows.get(invite.body.id).status, 'pending');
  } finally { if (prior === undefined) delete process.env.CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH; else process.env.CONSOLE_SIGNUP_PASSWORD_MIN_LENGTH = prior; }
});


test('975: workspace slug resolution grants and persists the canonical workspace binding', async () => {
  const { INVITATION_HANDLERS } = await import('../../apps/control-plane/invitation-handlers.mjs');
  const ctx = context(undefined, { email: 'guest@example.com', role: 'workspace_admin', workspaceId: 'workspace-alpha' });
  const result = await INVITATION_HANDLERS.createInvitation({ ...ctx, identity: {
    actorType: 'workspace_admin', sub: 'workspace-admin', tenantId: 'ten_alpha', workspaceId: 'wrk_alpha'
  } });
  assert.equal(result.statusCode, 202);
  assert.equal(result.body.workspaceId, 'wrk_alpha');
});
