import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWeedShellTransport,
  writeIdentity,
  deleteIdentity,
  updateIdentityActions,
} from '../../packages/adapters/src/seaweedfs-iam-client.mjs';

// Faithful in-memory model of `weed shell s3.configure` (verified semantics
// against the pinned SeaweedFS 4.33 image): view returns the JSON config;
// `-user X -access_key.. -secret_key.. -buckets.. -actions.. -apply` upserts a
// dynamic identity carrying per-bucket-scoped action strings and APPENDS the
// credential; `-user X -delete -apply` removes it. Static identities are flagged.
function fakeWeedShell({ staticAdmin = true } = {}) {
  let ids = staticAdmin
    ? [{ name: 'anvAdmin', credentials: [{ accessKey: 'adminkey', secretKey: 'adminsecret' }], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'], isStatic: true }]
    : [];
  const calls = [];
  async function exec(cmd) {
    calls.push(cmd);
    const parts = cmd.trim().split(/\s+/);
    if (cmd.trim() === 's3.configure') return JSON.stringify({ identities: ids });
    const flag = (name) => { const i = parts.indexOf(name); return i >= 0 ? parts[i + 1] : undefined; };
    const user = flag('-user');
    if (parts.includes('-delete')) { ids = ids.filter((i) => i.name !== user); return 'deleted'; }
    const buckets = (flag('-buckets') || '').split(',').filter(Boolean);
    const actions = (flag('-actions') || '').split(',').filter(Boolean);
    const scoped = [];
    for (const a of actions) for (const b of buckets) scoped.push(`${a}:${b}`);
    let id = ids.find((i) => i.name === user);
    if (!id) { id = { name: user, credentials: [], actions: scoped, isStatic: false }; ids.push(id); }
    else { id.actions = scoped; }
    id.credentials.push({ accessKey: flag('-access_key'), secretKey: flag('-secret_key') });
    return 'applied';
  }
  return { exec, calls, ids: () => ids };
}

const noSleep = async () => {};

test('weed-shell transport: writeIdentity creates a scoped dynamic identity, admin untouched', async () => {
  const swfs = fakeWeedShell();
  const transport = createWeedShellTransport({ exec: swfs.exec });

  await writeIdentity(
    { name: 'falcone-ws-wA', accessKey: 'AKTESTA', secretKey: 'sktesta', actions: ['Read', 'Write', 'List'], buckets: ['ten-a-ws-1'] },
    { transport, sleep: noSleep }
  );

  const wA = swfs.ids().find((i) => i.name === 'falcone-ws-wA');
  assert.deepEqual(wA.actions, ['Read:ten-a-ws-1', 'Write:ten-a-ws-1', 'List:ten-a-ws-1']);
  assert.equal(wA.credentials.length, 1);
  assert.ok(swfs.ids().some((i) => i.name === 'anvAdmin' && i.isStatic), 'static admin preserved');
});

test('weed-shell transport: grace overlap then cleanup (delete + re-add to exact state)', async () => {
  const swfs = fakeWeedShell();
  const transport = createWeedShellTransport({ exec: swfs.exec });
  const opts = { transport, sleep: noSleep };

  await writeIdentity({ name: 'falcone-ws-wA', credentials: [{ accessKey: 'AK1', secretKey: 's1' }], actions: ['Read', 'Write', 'List'], buckets: ['ten-a-ws-1'] }, opts);
  // Grace overlap: new + old.
  await writeIdentity({ name: 'falcone-ws-wA', credentials: [{ accessKey: 'AK2', secretKey: 's2' }, { accessKey: 'AK1', secretKey: 's1' }], actions: ['Read', 'Write', 'List'], buckets: ['ten-a-ws-1'] }, opts);
  assert.deepEqual(swfs.ids().find((i) => i.name === 'falcone-ws-wA').credentials.map((c) => c.accessKey).sort(), ['AK1', 'AK2']);
  // Cleanup: keep only the current key.
  await writeIdentity({ name: 'falcone-ws-wA', credentials: [{ accessKey: 'AK2', secretKey: 's2' }], actions: ['Read', 'Write', 'List'], buckets: ['ten-a-ws-1'] }, opts);
  assert.deepEqual(swfs.ids().find((i) => i.name === 'falcone-ws-wA').credentials.map((c) => c.accessKey), ['AK2']);
});

test('weed-shell transport: deleteIdentity removes the tenant but never the static admin', async () => {
  const swfs = fakeWeedShell();
  const transport = createWeedShellTransport({ exec: swfs.exec });
  const opts = { transport, sleep: noSleep };

  await writeIdentity({ name: 'falcone-ws-wA', accessKey: 'AK1', secretKey: 's1', actions: ['Read'], buckets: ['ten-a-ws-1'] }, opts);
  await deleteIdentity('falcone-ws-wA', opts);

  assert.deepEqual(swfs.ids().map((i) => i.name), ['anvAdmin']);
});

test('weed-shell transport: static admin is preserved even when not in the desired set', async () => {
  const swfs = fakeWeedShell();
  const transport = createWeedShellTransport({ exec: swfs.exec });
  await transport.writeIdentities([]); // desired = empty
  assert.deepEqual(swfs.ids().map((i) => i.name), ['anvAdmin']);
});

test('weed-shell transport: updateIdentityActions re-scopes actions, preserves credentials', async () => {
  const swfs = fakeWeedShell();
  const transport = createWeedShellTransport({ exec: swfs.exec });
  const opts = { transport, sleep: noSleep };

  await writeIdentity({ name: 'falcone-ws-wA', accessKey: 'AK1', secretKey: 's1', actions: ['Read', 'Write', 'List'], buckets: ['ten-a-ws-1'] }, opts);
  await updateIdentityActions({ name: 'falcone-ws-wA', actions: ['Read', 'List'], buckets: ['ten-a-ws-1'] }, opts);

  const wA = swfs.ids().find((i) => i.name === 'falcone-ws-wA');
  assert.deepEqual(wA.actions, ['Read:ten-a-ws-1', 'List:ten-a-ws-1']);
  assert.deepEqual(wA.credentials.map((c) => c.accessKey), ['AK1']);
});

test('createWeedShellTransport requires an exec function', () => {
  assert.throws(() => createWeedShellTransport({}), (e) => e.code === 'IAM_CONFIG_MISSING');
});
