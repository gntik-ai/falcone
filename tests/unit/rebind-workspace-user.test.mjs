import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRebindArgs, runRebind } from '../../scripts/rebind-workspace-user.mjs';

function fixture() {
  const state = { tenant: { id: 'tenant-one', iam_realm: 'realm-one' },
    workspace: { id: 'workspace-one', tenant_id: 'tenant-one' },
    user: { id: 'user-one', username: 'alice', attributes: { workspace_id: [' '], keep: ['a', 'b'], scalar: 42 } } };
  const writes = [];
  const output = [];
  const options = { argv: ['--tenant', 'tenant-one', '--user', 'user-one', '--workspace', 'workspace-one'],
    pool: { query: async sql => ({ rows: (sql.includes('FROM tenants') ? state.tenant : state.workspace) ? [sql.includes('FROM tenants') ? state.tenant : state.workspace] : [] }) },
    kcAdmin: {
      getUser: async (realm, id) => { assert.equal(realm, 'realm-one'); assert.equal(id, 'user-one'); return state.user; },
      updateUser: async (realm, id, patch) => { writes.push({ realm, id, patch }); state.user.attributes = patch.attributes; },
    }, outStream: { write: text => output.push(text) },
  };
  return { state, writes, options, output };
}

test('single explicit user rebind preserves the full normalized attribute map and tells the user to renew the token', async () => {
  const f = fixture();
  assert.equal((await runRebind(f.options)).exitCode, 0);
  assert.deepEqual(f.writes, []); // dry-run default
  assert.equal((await runRebind({ ...f.options, argv: [...f.options.argv, '--apply'] })).exitCode, 0);
  assert.deepEqual(f.writes, [{ realm: 'realm-one', id: 'user-one', patch: { attributes: {
    workspace_id: ['workspace-one'], keep: ['a', 'b'], scalar: ['42'],
  } } }]);
  assert.match(f.output.join(''), /new token/i);
  f.writes.length = 0;
  assert.equal((await runRebind({ ...f.options, argv: [...f.options.argv, '--apply'] })).exitCode, 0);
  assert.deepEqual(f.writes, []);
});

for (const [name, exitCode, mutate] of [
  ['unknown workspace', 3, f => { f.state.workspace = null; }],
  ['foreign workspace', 4, f => { f.state.workspace.tenant_id = 'foreign'; }],
  ['unknown user', 5, f => { f.state.user = null; }],
  ['SA user by client id', 6, f => { f.state.user.serviceAccountClientId = 'sa-worker'; }],
  ['SA user by username', 6, f => { f.state.user.username = 'service-account-sa-worker'; }],
  ['different binding', 7, f => { f.state.user.attributes.workspace_id = ['other']; }],
  ['multiple bindings', 7, f => { f.state.user.attributes.workspace_id = ['workspace-one', 'other']; }],
  ['unknown tenant', 8, f => { f.state.tenant = null; }],
]) {
  test(`${name} returns distinct status ${exitCode} without writes`, async () => {
    const f = fixture();
    mutate(f);
    assert.equal((await runRebind({ ...f.options, argv: [...f.options.argv, '--apply'] })).exitCode, exitCode);
    assert.deepEqual(f.writes, []);
  });
}
test('unknown Keycloak user (404) and provider error bodies are handled without leaking them', async () => {
  const f = fixture();
  f.options.kcAdmin.getUser = async () => { throw Object.assign(new Error('private-token'), { kcStatus: 404 }); };
  assert.equal((await runRebind(f.options)).exitCode, 5);
  f.options.kcAdmin.getUser = async () => { throw new Error('private-token'); };
  assert.equal((await runRebind(f.options)).exitCode, 9);
  assert.doesNotMatch(f.output.join(''), /private-token/);
});
for (const suffix of [
  ['--user', 'second'], ['--workspace', 'second'], ['second-user'], ['--all'],
  ['--users', 'one,two'], ['--workspace=other'], ['constructor', 'second-user'],
]) {
  test(`bulk or duplicate input ${suffix.join(' ')} is rejected before reads or writes`, async () => {
    const f = fixture();
    const argv = [...f.options.argv, ...suffix];
    assert.throws(() => parseRebindArgs(argv));
    f.options.pool.query = async () => assert.fail('no database reads for invalid args');
    assert.equal((await runRebind({ ...f.options, argv })).exitCode, 2);
    assert.deepEqual(f.writes, []);
  });
}
for (const value of [undefined, [], [''], [' \t ']]) {
  test(`blank ${JSON.stringify(value)} is absent and can bind exactly the operator workspace`, async () => {
    const f = fixture();
    f.state.user.attributes.workspace_id = value;
    if (value === undefined) delete f.state.user.attributes.workspace_id;
    assert.equal((await runRebind({ ...f.options, argv: [...f.options.argv, '--apply'] })).exitCode, 0);
    assert.deepEqual(f.writes[0].patch.attributes.workspace_id, ['workspace-one']);
  });
}

for (const persisted of [undefined, [], [''], [' '], ['foreign'], ['workspace-one', 'foreign']]) {
  test(`rebind rejects a discarded or incorrect persisted binding ${JSON.stringify(persisted)}`, async () => {
    const f = fixture();
    f.options.kcAdmin.updateUser = async (_realm, _id, patch) => {
      f.writes.push(patch);
      f.state.user.attributes.workspace_id = persisted;
    };
    const result = await runRebind({ ...f.options, argv: [...f.options.argv, '--apply'] });
    assert.equal(result.exitCode, 9);
    assert.equal(result.result.reason, 'workspace-binding-not-persisted');
    assert.equal(result.result.message, undefined);
  });
}
