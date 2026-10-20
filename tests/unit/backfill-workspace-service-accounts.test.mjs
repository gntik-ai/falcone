import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackfill } from '../../scripts/backfill-workspace-service-accounts.mjs';
import { fixture, W, ROLE, MARKER } from './helpers/workspace-sa-fixture.mjs';

test('pre-1140 SA without a stored workspace attribute reaches the canonical bound end state', async () => {
  const f = fixture();
  f.state.user.attributes = {};
  const { exitCode } = await runBackfill({ ...f.options, argv: ['--apply'] });
  assert.equal(exitCode, 0);
  assert.equal(f.state.client.enabled, true);
  assert.equal(f.state.mappers[0].config['claim.value'], W);
  assert.deepEqual(f.state.defaults, []);
  assert.ok(f.state.roles.includes(ROLE));
  assert.deepEqual(f.state.user.attributes, {}); // W comes only from the registry.
});

test('a terminal revoked row is reported without blocking an active legacy SA or touching its client', async () => {
  const f = fixture();
  f.state.additionalRows = [{ ...f.state.row, id: 'revoked-sa', status: 'revoked',
    kc_client_id: 'sa-revoked', kc_client_uuid: 'revoked-client' }];
  f.state.unregistered = [{ id: 'revoked-client', clientId: 'sa-revoked',
    attributes: { 'in-falcone.kind': 'service-account' } }];
  const dryRun = await runBackfill(f.options);
  assert.equal(dryRun.exitCode, 1);
  assert.deepEqual(f.writes, []);
  const { exitCode, result } = await runBackfill({ ...f.options, argv: ['--apply'] });
  assert.equal(exitCode, 1);
  assert.deepEqual(result.failed, [{ serviceAccountId: 'revoked-sa', reason: 'inactive-registry-row' }]);
  assert.ok(f.state.roles.includes(ROLE));
  assert.equal(f.state.mappers[0].config['claim.value'], W);
  f.writes.length = 0;
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
  assert.deepEqual(f.writes, []);
});

test('dry-run reports each registry plan and extra effective roles without writing', async () => {
  const f = fixture();
  f.state.inheritedRoles.push('tenant_admin');
  const { exitCode, result } = await runBackfill(f.options);
  assert.equal(exitCode, 0);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(result.inspected[0].extraRoles, ['tenant_admin']);
  assert.equal(result.inspected[0].workspaceId, W);
  assert.deepEqual(result.inspected[0].plan, ['disable-client', 'install-workspace-mapper',
    'verify-workspace-mapper', 'detach-workspace-context', 'verify-claim-sources',
    'ensure-workspace-role', 'assign-workspace-role', 'verify-effective-roles', 'restore-enabled-client']);
});

const registryConflicts = {
  revoked: f => { f.state.row.status = 'revoked'; },
  orphan: f => { f.state.row.joined_workspace_id = null; },
  'foreign workspace': f => { f.state.row.workspace_tenant_id = 'foreign'; },
  'wrong workspace': f => { f.state.row.joined_workspace_id = 'foreign'; },
  'missing tenant': f => { f.state.row.joined_tenant_id = null; },
  'foreign tenant': f => { f.state.row.joined_tenant_id = 'foreign'; },
  'wrong realm': f => { f.state.row.iam_realm = 'foreign'; },
  'wrong uuid': f => { f.state.client.id = 'foreign'; },
  'wrong clientId': f => { f.state.client.clientId = 'foreign'; },
  'wrong kind': f => { f.state.client.attributes['in-falcone.kind'] = 'tenant-app'; },
  'unregistered client': f => { f.state.unregistered = [{ id: 'other', clientId: 'sa-other', attributes: { 'in-falcone.kind': 'service-account' } }]; },
};
for (const [name, mutate] of Object.entries(registryConflicts)) {
  test(`${name} is reported with no Keycloak or DB writes`, async () => {
    const f = fixture();
    mutate(f);
    const { exitCode, result } = await runBackfill({ ...f.options, argv: ['--apply'] });
    assert.equal(exitCode, 1);
    assert.ok(result.failed.length);
    assert.deepEqual(f.writes, []);
  });
}

for (const location of ['client', 'default', 'optional']) {
  for (const claim of ['workspace_id', 'workspace_ids']) {
    test(`${location} scope with noncanonical ${claim} blocks all writes`, async () => {
      const f = fixture();
      const mapper = { name: 'unexpected', protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-attribute-mapper', config: { 'claim.name': claim } };
      if (location === 'client') f.state.mappers.push(mapper);
      else {
        const scope = { id: 'conflict', name: 'other-scope' };
        (location === 'default' ? f.state.defaults : f.state.optional).push(scope);
        f.state.scopeMappers.conflict = [mapper];
      }
      assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
      assert.deepEqual(f.writes, []);
    });
  }
}
for (const value of ['true', 'false']) {
  test(`workspace-context config with unexpected multivalued=${value} is never removed`, async () => {
    const f = fixture();
    f.state.scopeMappers['scope-one'][0].config.multivalued = value;
    assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
    assert.deepEqual(f.writes, []);
  });
}

for (const value of [undefined, [], [''], ['  '], ['other'], [W, 'other']]) {
  test(`legacy attribute ${JSON.stringify(value)} and inherited values cannot override registry W`, async () => {
    const f = fixture();
    f.state.user.attributes.workspace_id = value;
    f.state.user.groups = [{ attributes: { workspace_id: ['foreign'] } }];
    assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
    assert.equal(f.state.mappers[0].config['claim.value'], W);
    assert.equal(f.state.client.enabled, true);
    assert.deepEqual(f.state.defaults, []);
    assert.ok(f.state.roles.includes(ROLE));
  });
  test(`unverified migration of legacy attribute ${JSON.stringify(value)} stays disabled without a new role`, async () => {
    const f = fixture({ fail: 'verify-claims' });
    f.state.user.attributes.workspace_id = value;
    f.state.user.groups = [{ attributes: { workspace_id: ['foreign'] } }];
    assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
    assert.equal(f.state.client.enabled, false);
    assert.ok(!f.state.roles.includes(ROLE));
    assert.ok(!f.writes.includes('enable'));
  });
}

test('failure at every read/write, including lost write acknowledgements, preserves prior roles and never leaves a new grant', async () => {
  const baseline = fixture();
  await runBackfill({ ...baseline.options, argv: ['--apply'] });
  for (let index = 1; index <= baseline.calls.length; index++) {
    for (const afterCommit of [false, true]) {
      const f = fixture({ failAt: index, afterCommit });
      f.state.roles.push('tenant_admin'); // Includes effective group/composite grants.
      const { exitCode } = await runBackfill({ ...f.options, argv: ['--apply'] });
      assert.equal(exitCode, 1, `${index}: ${baseline.calls[index - 1]}`);
      assert.ok(!f.state.roles.includes(ROLE), `${index}: no new role remains`);
      assert.ok(f.state.roles.includes('tenant_admin'));
      assert.ok(f.state.roles.includes('offline_access'));
      if (f.writes.some(write => write !== 'disable')) assert.equal(f.state.client.enabled, false);
      assert.doesNotMatch(f.output.join(''), /secret-token|private-provider-body/);
      assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0,
        `${index}: retry succeeds`);
      assert.equal(f.state.client.enabled, true, `${index}: retry restores original issuance`);
    }
  }
});

test('a preexisting workspace role and extra effective roles survive a failed migration', async () => {
  const f = fixture({ fail: 'remove-default', afterCommit: true });
  f.state.roles.push(ROLE, 'tenant_admin');
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
  assert.deepEqual(f.state.roles, ['offline_access', ROLE, 'tenant_admin']);
  assert.equal(f.state.client.enabled, false);
  assert.ok(!f.writes.includes('remove-role'));
});

test('canonical optional workspace-context is removed only after W is verified', async () => {
  const f = fixture();
  f.state.optional = f.state.defaults;
  f.state.defaults = [];
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.ok(f.calls.indexOf('install') < f.calls.indexOf('remove-optional'));
  assert.ok(f.calls.indexOf('remove-optional') < f.calls.indexOf('assign'));
});

test('an already disabled, unmarked client is never re-enabled', async () => {
  const f = fixture();
  f.state.client.enabled = false;
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.equal(f.state.client.enabled, false);
  assert.ok(!f.writes.includes('enable'));
  f.state.client.attributes[MARKER] = 'foreign';
  f.writes.length = 0;
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
  assert.deepEqual(f.writes, []);
});

test('apply disables, verifies W before detaching scopes, verifies claims before assigning, and is idempotent', async () => {
  const f = fixture();
  const result = await runBackfill({ ...f.options, argv: ['--apply'] });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(f.writes, ['disable', 'install', 'remove-default', 'create-role', 'assign', 'enable']);
  const install = f.calls.indexOf('install');
  const detach = f.calls.indexOf('remove-default');
  assert.ok(f.calls.slice(install + 1, detach).includes('mappers'));
  assert.ok(f.calls.indexOf('verify-claims') < f.calls.indexOf('assign'));
  assert.ok(f.calls.lastIndexOf('roles') > f.calls.indexOf('assign'));
  assert.equal(f.state.client.enabled, true);
  assert.ok(f.state.roles.includes(ROLE));
  f.writes.length = 0;
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.deepEqual(f.writes, []);
});

test('a failed forward migration reports recoverable work and restores the prior enabled state on retry', async () => {
  const f = fixture({ fail: 'assign' });
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
  assert.equal(f.state.client.enabled, false);
  const dryRun = await runBackfill(f.options);
  assert.equal(dryRun.exitCode, 0);
  assert.ok(dryRun.result.inspected[0].plan.includes('enable-marked-client'));
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.equal(f.state.client.enabled, true);
  assert.ok(f.state.roles.includes(ROLE));
  f.writes.length = 0;
  assert.deepEqual((await runBackfill(f.options)).result.inspected[0].plan, []);
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.deepEqual(f.writes, []);
});

test('a failed migration of an already disabled client does not create recovery permission', async () => {
  const f = fixture({ fail: 'assign' });
  f.state.client.enabled = false;
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 1);
  assert.notEqual(f.state.client.attributes[MARKER], W);
  assert.equal((await runBackfill({ ...f.options, argv: ['--apply'] })).exitCode, 0);
  assert.equal(f.state.client.enabled, false);
});
