// Authorization denial attribution through the writer API (#958).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordRouteDenial, recordScopeDenial } from '../../apps/control-plane/audit-writer.mjs';
import { createScopeEnforcementDenial } from '../../packages/provisioning-orchestrator/src/models/scope-enforcement-denial.mjs';
import { readFile } from 'node:fs/promises';

const identity = { tenantId: 'tenant-alpha', sub: 'actor-alpha', actorType: 'tenant_member' };
const route = { method: 'GET', path: '/v1/plans', auth: 'superadmin' };
const silent = { warn() {} };

// Database boundary: return the inserted row with the database's column names.
const db = {
  async query(sql, values) {
    const columns = sql.match(/INSERT INTO scope_enforcement_denials\s*\(([^)]+)\)/)[1]
      .split(',').map((column) => column.trim());
    return { rows: [Object.fromEntries(columns.map((column, i) => [column, values[i]]))] };
  }
};

test('a role gate denial carries the required role without inventing scope evidence', async () => {
  const row = await recordRouteDenial(db, route, { identity }, { statusCode: 403 }, 'corr-role', silent);
  assert.equal(row.denial_type, 'ROLE_INSUFFICIENT');
  assert.equal(row.required_role, 'superadmin');
  assert.equal(row.request_path, '/v1/plans');
  assert.equal(row.correlation_id, 'corr-role');
  assert.deepEqual(row.required_scopes, []);
  assert.deepEqual(row.missing_scopes, []);
});

test('only required or missing scope evidence permits the scope-insufficient label', async () => {
  for (const evidence of [{}, { presentedScopes: ['db:read'] }]) {
    const row = await recordScopeDenial(db, {
      tenantId: identity.tenantId, actorId: identity.sub, correlationId: 'corr-no-scope',
      denialType: 'SCOPE_INSUFFICIENT', ...evidence
    }, silent);
    assert.equal(row.denial_type, 'ROLE_INSUFFICIENT');
  }
  for (const evidence of [{ requiredScopes: ['db:write'] }, { missingScopes: ['db:write'] }]) {
    const row = await recordScopeDenial(db, {
      tenantId: identity.tenantId, actorId: identity.sub, correlationId: 'corr-scope', ...evidence
    }, silent);
    assert.equal(row.denial_type, 'SCOPE_INSUFFICIENT');
  }
  const row = await recordScopeDenial(db, {
    tenantId: identity.tenantId, actorId: identity.sub, correlationId: 'corr-plan',
    denialType: 'PLAN_ENTITLEMENT_DENIED', requiredEntitlement: 'functions:deploy'
  }, silent);
  assert.equal(row.denial_type, 'PLAN_ENTITLEMENT_DENIED');
});

test('denial attribution uses the service-account signal and only the identity workspace', async () => {
  const row = await recordRouteDenial(db, route, {
    identity: { ...identity, isServiceAccount: true, workspaceId: 'workspace-alpha' },
    params: { workspaceId: 'workspace-beta' }
  }, { statusCode: 403 }, 'corr-sa', silent);
  assert.equal(row.actor_type, 'service_account');
  assert.equal(row.workspace_id, 'workspace-alpha');
  const userRow = await recordRouteDenial(db, route, {
    identity, params: { workspaceId: 'workspace-beta' }
  }, { statusCode: 403 }, null, silent);
  assert.equal(userRow.actor_type, 'user');
  assert.equal(userRow.workspace_id, null);
  assert.match(userRow.correlation_id, /^[0-9a-f-]{36}$/);
});

test('unattributable denials emit one safe structured line and write no row', async () => {
  for (const principal of [
    { sub: 'platform-actor', actorType: 'superadmin' },
    { tenantId: 'tenant-alpha', isServiceAccount: true }
  ]) {
    const lines = [];
    const noWrites = { query() { assert.fail('unattributable denial must not reach the database'); } };
    const out = await recordRouteDenial(noWrites, route, {
      identity: principal, req: { headers: { authorization: 'Bearer private-material' } },
      body: { password: 'private-material' }
    }, { statusCode: 403 }, 'corr-log', { warn: (line) => lines.push(line) });
    assert.equal(out, null);
    assert.equal(lines.length, 1);
    const event = JSON.parse(lines[0]);
    assert.equal(event.actor_id, principal.sub ?? null);
    assert.equal(event.actor_type, principal.isServiceAccount ? 'service_account' : 'user');
    assert.equal(event.http_method, 'GET');
    assert.equal(event.request_path, '/v1/plans');
    assert.equal(event.required_role, 'superadmin');
    assert.equal(event.correlation_id, 'corr-log');
    assert.ok(!lines[0].includes('private-material'));
  }
});

test('non-403 results never write or log a denial, and insert failures are swallowed', async () => {
  for (const statusCode of [200, 201, 401, 404, 400, 500]) {
    const never = () => assert.fail('non-403 must not record');
    assert.equal(await recordRouteDenial({ query: never }, route, { identity },
      { statusCode }, 'corr-negative', { warn: never }), null);
  }
  const warnings = [];
  assert.equal(await recordRouteDenial({ query: async () => { throw Error('insert unavailable'); } },
    route, { identity }, { statusCode: 403 }, 'corr-failure', { warn: (line) => warnings.push(line) }), null);
  assert.equal(warnings.length, 1);
});

test('role denials are accepted by the model and the event contract', async () => {
  const record = createScopeEnforcementDenial({
    tenantId: 'tenant-alpha', actorId: 'actor-alpha', actorType: 'user',
    denialType: 'ROLE_INSUFFICIENT', httpMethod: 'GET', requestPath: '/v1/plans', correlationId: 'corr-model'
  });
  assert.equal(record.denialType, 'ROLE_INSUFFICIENT');
  const schema = JSON.parse(await readFile(new URL('../../packages/internal-contracts/src/scope-enforcement-denial-event.json', import.meta.url), 'utf8'));
  assert.ok(schema.properties.denial_type.enum.includes('ROLE_INSUFFICIENT'));
  assert.ok(schema.properties.event_type.enum.includes('ROLE_INSUFFICIENT'));
});

test('an empty correlation header generates an id and ANY routes log the request method', async () => {
  const row = await recordRouteDenial(db, { ...route, method: 'ANY' }, {
    identity, req: { method: 'POST' }
  }, { statusCode: 403 }, '', silent);
  assert.ok(row, 'an empty header must not silently discard the denial');
  assert.match(row.correlation_id, /^[0-9a-f-]{36}$/);
  assert.equal(row.http_method, 'POST');
});
