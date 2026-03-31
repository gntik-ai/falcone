import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/privilege-domain-assign.mjs';

function createDb() {
  const calls = [];
  return {
    calls,
    async query(sql) { calls.push(sql); return { rows: [] }; }
  };
}

test('happy path grant structural_admin', async () => {
  const events = [];
  const db = createDb();
  const result = await main({ workspaceId: 'ws-1', memberId: 'm-1', tenantId: 't-1', structural_admin: true, data_access: false, auth: { sub: 'actor-1', tenantId: 't-1', privilegeDomains: { 'ws-1': ['structural_admin'] } } }, {
    db,
    repo: {
      getAssignment: async () => null,
      getStructuralAdminCountForUpdate: async () => 2,
      upsertAssignment: async () => ({ assignment: { memberId: 'm-1', workspaceId: 'ws-1', tenantId: 't-1', structural_admin: true, data_access: false }, transitions: [{ changeType: 'assigned', privilegeDomain: 'structural_admin' }] })
    },
    publishEvent: async (topic, payload) => events.push({ topic, payload }),
    syncKeycloakRoles: async () => { events.push({ topic: 'keycloak' }); },
    invalidateApisixCache: async () => { events.push({ topic: 'apisix' }); }
  });
  assert.equal(result.statusCode, 200);
});

test('last admin guard returns 400', async () => {
  const result = await main({ workspaceId: 'ws-1', memberId: 'm-1', tenantId: 't-1', structural_admin: false, data_access: false, auth: { sub: 'actor-1', tenantId: 't-1', privilegeDomains: { 'ws-1': ['structural_admin'] } } }, {
    db: createDb(),
    repo: {
      getAssignment: async () => ({ structural_admin: true, data_access: false }),
      getStructuralAdminCountForUpdate: async () => 1
    },
    publishEvent: async () => {}
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'LAST_STRUCTURAL_ADMIN');
});

test('unauthorized actor gets 403', async () => {
  const result = await main({ workspaceId: 'ws-1', memberId: 'm-1', tenantId: 't-1', structural_admin: true, data_access: false, auth: { sub: 'actor-1', tenantId: 't-1', privilegeDomains: { 'ws-1': [] } } }, { db: createDb() });
  assert.equal(result.statusCode, 403);
});

test('missing workspaceId gets 400', async () => {
  const result = await main({ memberId: 'm-1', tenantId: 't-1', structural_admin: true, data_access: false, auth: { sub: 'actor-1', tenantId: 't-1', privilegeDomains: { 'ws-1': ['structural_admin'] } } }, { db: createDb() });
  assert.equal(result.statusCode, 400);
});

test('idempotent recall produces 200', async () => {
  const result = await main({ workspaceId: 'ws-1', memberId: 'm-1', tenantId: 't-1', structural_admin: true, data_access: false, auth: { sub: 'actor-1', tenantId: 't-1', privilegeDomains: { 'ws-1': ['structural_admin'] } } }, {
    db: createDb(),
    repo: {
      getAssignment: async () => ({ structural_admin: true, data_access: false }),
      upsertAssignment: async () => ({ assignment: { memberId: 'm-1', workspaceId: 'ws-1', tenantId: 't-1', structural_admin: true, data_access: false }, transitions: [] })
    }
  });
  assert.equal(result.statusCode, 200);
});
