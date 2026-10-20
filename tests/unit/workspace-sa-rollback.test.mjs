import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin } from '../../apps/control-plane/kc-admin.mjs';
import { runBackfill } from '../../scripts/backfill-workspace-service-accounts.mjs';
import { runRollback } from '../../scripts/rollback-workspace-service-accounts.mjs';
import { markServiceAccountCredentialsInvalidated } from '../../apps/control-plane/tenant-store.mjs';
import { createSaRevocationCheck as controlPlaneCheck } from '../../apps/control-plane/sa-revocation.mjs';
import { createSaRevocationCheck as executorCheck } from '../../apps/control-plane-executor/src/runtime/sa-revocation.mjs';
import { fixture, W, ROLE, MARKER, REALM } from './helpers/workspace-sa-fixture.mjs';

test('rollback can contain a partial migration with canonical workspace-context still attached', async () => {
  const f = fixture({ fail: 'remove-default' });
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
  assert.equal(f.state.defaults.length, 1);
  assert.equal(f.state.mappers[0].config['claim.value'], W);
  f.writes.length = 0;
  const { exitCode } = await runRollback({ ...f.options, argv: ['--apply'] });
  assert.equal(exitCode, 0);
  assert.equal(f.state.client.enabled, false);
  assert.equal(f.state.client.attributes[MARKER], W);
  assert.equal(f.state.defaults.length, 1);
  assert.equal(f.state.mappers[0].config['claim.value'], W);
  assert.ok(f.state.cutoff instanceof Date);
  assert.ok(!f.state.roles.includes(ROLE));
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.equal(f.state.client.enabled, true);
});

for (const status of ['active', 'revoked']) {
  test(`rollback contains a bound SA while reporting another ${status} orphan SA`, async () => {
    const f = fixture();
    await runBackfill({ ...f.options, argv: ['--apply'] });
    f.state.additionalRows = [{ ...f.state.row, id: 'other-sa', status,
      kc_client_id: 'sa-other', kc_client_uuid: 'other-client', joined_workspace_id: null }];
    f.state.unregistered = [{ id: 'other-client', clientId: 'sa-other',
      attributes: { 'in-falcone.kind': 'service-account' } }];
    f.writes.length = 0;
    const { exitCode, result } = await runRollback({ ...f.options, argv: ['--apply'] });
    assert.equal(exitCode, 1);
    assert.equal(result.failed[0].serviceAccountId, 'other-sa');
    assert.deepEqual(f.writes, ['disable', 'cutoff', 'remove-role']);
    assert.equal(f.state.client.enabled, false);
    assert.equal(f.state.client.attributes[MARKER], W);
    assert.ok(!f.state.roles.includes(ROLE));
  });
}

test('rollback leaves an unmigrated SA without a hardcoded binding untouched and reports it', async () => {
  const f = fixture();
  const { exitCode, result } = await runRollback({ ...f.options, argv: ['--apply'] });
  assert.equal(exitCode, 1);
  assert.deepEqual(result.failed, [{ serviceAccountId: 'sa-one', reason: 'rollback-requires-canonical-binding' }]);
  assert.deepEqual(f.writes, []);
});

test('client disable can atomically preserve attributes and stamp a rollback marker', async (t) => {
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-admin', expires_in: 300 });
    writes.push({ url, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  });
  await kcAdmin.setClientEnabled('tenant-one', 'client-one', false, { keep: 'yes', 'in-falcone.workspace-rollback': 'workspace-one' });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { enabled: false, attributes: { keep: 'yes', 'in-falcone.workspace-rollback': 'workspace-one' } });
});

test('client PUT transmits explicit null to remove the rollback marker', async (t) => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/protocol/openid-connect/token')) return Response.json({ access_token: 'test-admin', expires_in: 300 });
    bodies.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  });
  await kcAdmin.setClientEnabled(REALM, 'client-one', false, { keep: 'yes', [MARKER]: null });
  assert.deepEqual(bodies, [{ enabled: false, attributes: { keep: 'yes', [MARKER]: null } }]);
});

test('a forward run verifies marker removal before enabling and fails closed if it persists', async () => {
  const f = fixture();
  await runBackfill({ ...f.options, argv: ['--apply'] });
  await runRollback({ ...f.options, argv: ['--apply'] });
  f.state.ignoreMarkerRemoval = true;
  f.writes.length = 0;
  const { exitCode } = await runBackfill({ ...f.options, argv: ['--apply'] });
  assert.equal(exitCode, 1);
  assert.equal(f.state.client.enabled, false);
  assert.equal(f.state.client.attributes[MARKER], W);
  assert.ok(!f.writes.includes('enable'));
  assert.ok(!f.state.roles.includes(ROLE));
});

test('a failure at every marked-client recovery step keeps prior roles and never leaves a new grant', async () => {
  const prepare = async (f) => {
    await runBackfill({ ...f.options, argv: ['--apply'] });
    await runRollback({ ...f.options, argv: ['--apply'] });
    f.calls.length = 0;
    f.writes.length = 0;
  };
  const baseline = fixture();
  await prepare(baseline);
  assert.equal((await runBackfill({ ...baseline.options, argv: ['--apply'] })).exitCode, 0);
  for (let index = 1; index <= baseline.calls.length; index++) {
    for (const afterCommit of [false, true]) {
      const f = fixture({ afterCommit });
      await prepare(f);
      f.state.roles.push('tenant_admin');
      f.state.failAt = index;
      assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1,
        `${index}: ${baseline.calls[index - 1]}`);
      assert.equal(f.state.client.enabled, false);
      assert.ok(!f.state.roles.includes(ROLE));
      assert.deepEqual(f.state.roles, ['offline_access', 'tenant_admin']);
      assert.equal(f.state.mappers[0].config['claim.value'], W);
    }
  }
});

test('rollback cutoff leads the database clock even when the pod clock is behind', async () => {
  const f = fixture();
  f.state.databaseNow = Date.parse('2035-01-01T00:00:00.900Z');
  await runBackfill({ ...f.options, argv: ['--apply'] });
  assert.equal((await runRollback({ ...f.options, argv: ['--apply'], skewSec: 8 })).exitCode, 0);
  assert.equal(f.state.cutoff.toISOString(), '2035-01-01T00:00:10.900Z');
});

test('inherited workspace role is reported and never removed from a group or composite', async () => {
  const f = fixture();
  await runBackfill({ ...f.options, argv: ['--apply'] });
  f.state.roles = f.state.roles.filter(role => role !== ROLE);
  f.state.inheritedRoles = [ROLE, 'tenant_admin'];
  const result = await runRollback({ ...f.options, argv: ['--apply'] });
  assert.equal(result.exitCode, 1);
  assert.equal(result.result.failed[0].reason, 'workspace-role-still-inherited');
  assert.deepEqual(f.state.inheritedRoles, [ROLE, 'tenant_admin']);
  assert.equal(f.state.client.enabled, false);
  assert.equal(f.state.mappers[0].config['claim.value'], W);
});

test('rollback verifies the persisted marker before invalidation or role removal', async () => {
  const f = fixture();
  await runBackfill({ ...f.options, argv: ['--apply'] });
  f.writes.length = 0;
  const disable = f.kc.setClientEnabled;
  f.kc.setClientEnabled = async (realm, uuid, enabled) => disable(realm, uuid, enabled);
  assert.equal((await runRollback({ ...f.options, argv: ['--apply'] })).exitCode, 1);
  assert.deepEqual(f.writes, ['disable']);
  assert.equal(f.state.client.enabled, false);
  assert.ok(f.state.roles.includes(ROLE));
});

test('rollback failure at every step keeps the W binding and never enables a role-less client', async () => {
  const baseline = fixture();
  await runBackfill({ ...baseline.options, argv: ['--apply'] });
  baseline.calls.length = 0;
  await runRollback({ ...baseline.options, argv: ['--apply'] });
  for (let index = 1; index <= baseline.calls.length; index++) {
    for (const afterCommit of [false, true]) {
      const f = fixture({ afterCommit });
      await runBackfill({ ...f.options, argv: ['--apply'] });
      f.state.roles.push('tenant_admin');
      f.calls.length = 0;
      f.writes.length = 0;
      f.state.failAt = index;
      const result = await runRollback({ ...f.options, argv: ['--apply'] });
      assert.equal(result.exitCode, 1, `${index}: ${baseline.calls[index - 1]}`);
      assert.equal(f.state.mappers[0].config['claim.value'], W);
      assert.ok(f.state.roles.includes('tenant_admin'));
      if (!f.state.roles.includes(ROLE)) assert.equal(f.state.client.enabled, false);
      assert.ok(!f.writes.includes('enable'));
      assert.doesNotMatch(f.output.join(''), /secret-token|private-provider-body/);
    }
  }
});

test('rollback dry-run is read-only; apply disables with marker, keeps W and other roles, and a forward run restores only marked clients', async () => {
  const f = fixture();
  await runBackfill({ ...f.options, argv: ['--apply'] });
  f.state.roles.push('tenant_admin');
  f.writes.length = 0;
  assert.equal((await runRollback(f.options)).exitCode, 0);
  assert.deepEqual(f.writes, []);
  f.state.databaseNow = Date.parse('2030-01-01T00:00:00.900Z');
  const result = await runRollback({ ...f.options, argv: ['--apply'], skewSec: 3 });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(f.writes, ['disable', 'cutoff', 'remove-role']);
  assert.equal(f.state.client.enabled, false);
  assert.equal(f.state.client.attributes[MARKER], W);
  assert.equal(f.state.client.attributes.keep, 'yes');
  assert.equal(f.state.cutoff.toISOString(), '2030-01-01T00:00:05.900Z');
  assert.equal(f.state.mappers[0].config['claim.value'], W);
  assert.deepEqual(f.state.roles, ['offline_access', 'tenant_admin']);
  await markServiceAccountCredentialsInvalidated(f.pool, f.state.row.id);
  assert.equal(f.state.cutoff.toISOString(), '2030-01-01T00:00:05.900Z');
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.equal(f.state.client.enabled, true);
  assert.equal(f.state.client.attributes[MARKER], undefined);
  assert.ok(f.state.roles.includes(ROLE));
  f.writes.length = 0;
  await runBackfill({ ...f.options, argv: ['--apply'] });
  assert.deepEqual(f.writes, []);
});

for (const [name, create] of [['control-plane', controlPlaneCheck], ['executor', executorCheck]]) {
  test(`${name} rejects pre-rollback bound role-less and unbound tokens, with exact skew boundaries`, async () => {
    const f = fixture();
    await runBackfill({ ...f.options, argv: ['--apply'] });
    f.state.databaseNow = Date.parse('2030-01-01T00:00:00.900Z');
    await runRollback({ ...f.options, argv: ['--apply'], skewSec: 3 });
    const lookup = async (_pool, clientId, realm) => {
        assert.equal(clientId, 'sa-worker'); assert.equal(realm, REALM);
        return { status: 'active', credentials_invalidated_at: f.state.cutoff };
    };
    const check = create({ pool: f.pool, cacheMs: 0, skewSec: 3,
      realmsBase: 'https://kc/realms/', platformRealm: 'platform',
      store: { getServiceAccountAuthStateByClientId: lookup }, lookupAuthState: lookup,
    });
    const token = { azp: 'sa-worker', iss: `https://kc/realms/${REALM}`, iat: Math.floor(f.state.databaseNow / 1000) };
    assert.equal(await check({ ...token, workspace_id: W, realm_access: { roles: [] } }), true);
    assert.equal(await check({ ...token, realm_access: { roles: [] } }), true);
    assert.equal(await check({ ...token, iat: 1893456001 }), true); // floor(cutoff) - skew - 1
    assert.equal(await check({ ...token, iat: 1893456002 }), false); // floor(cutoff) - skew
  });
}
