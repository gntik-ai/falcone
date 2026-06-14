import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  SEAWEEDFS_IAM_ENV,
  SEAWEEDFS_IAM_ERROR_CODES,
  buildSeaweedFSIdentity,
  writeIdentity,
  deleteIdentity,
  reloadIdentities,
  updateIdentityActions
} from '../../services/adapters/src/seaweedfs-iam-client.mjs';

// Spin up a real local mock of the SeaweedFS admin transport so the client's
// SigV4 signing + read-merge-write + reload + retry paths are exercised end to
// end without a live SeaweedFS. Non-provider TEST_AK_ fixtures avoid GitHub
// push-protection rejections (tasks.md 9.5).
function startMockServer({ failConfigureTimes = 0 } = {}) {
  let identities = [];
  const calls = { GET: 0, configure: 0, reload: 0 };
  let configureFailuresLeft = failConfigureTimes;
  const authSeen = [];

  const server = http.createServer((req, res) => {
    authSeen.push(req.headers.authorization ?? null);
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.method === 'GET' && req.url === '/s3/identities') {
        calls.GET += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ identities }));
        return;
      }
      if (req.method === 'POST' && req.url === '/s3/configure') {
        calls.configure += 1;
        if (configureFailuresLeft > 0) {
          configureFailuresLeft -= 1;
          res.writeHead(503); res.end('overloaded');
          return;
        }
        identities = JSON.parse(body).identities;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (req.method === 'POST' && req.url === '/s3/configure/reload') {
        calls.reload += 1;
        res.writeHead(200); res.end('{}');
        return;
      }
      res.writeHead(404); res.end('not found');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        calls,
        authSeen,
        getIdentities: () => identities,
        env: {
          [SEAWEEDFS_IAM_ENV.endpoint]: `http://127.0.0.1:${port}`,
          [SEAWEEDFS_IAM_ENV.accessKey]: 'TEST_AK_ADMIN0001',
          [SEAWEEDFS_IAM_ENV.secretKey]: 'test-admin-secret-0001'
        },
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

const noSleep = async () => {};

test('buildSeaweedFSIdentity expands actions into per-bucket-scoped strings', () => {
  const identity = buildSeaweedFSIdentity({
    name: 'falcone-ws-wA',
    accessKey: 'TEST_AK_TENANTA0001',
    secretKey: 'test-secret-tenant-a-0001',
    actions: ['Read', 'Write', 'List'],
    buckets: ['ten-a-ws-1']
  });
  assert.deepEqual(identity.actions, ['Read:ten-a-ws-1', 'Write:ten-a-ws-1', 'List:ten-a-ws-1']);
  assert.equal(identity.name, 'falcone-ws-wA');
  assert.equal(identity.credentials[0].accessKey, 'TEST_AK_TENANTA0001');
});

test('writeIdentity signs, merges, and reloads via the admin transport', async () => {
  const mock = await startMockServer();
  try {
    const written = await writeIdentity({
      name: 'falcone-ws-wA',
      accessKey: 'TEST_AK_TENANTA0001',
      secretKey: 'test-secret-tenant-a-0001',
      actions: ['Read', 'Write', 'List'],
      buckets: ['ten-a-ws-1']
    }, { env: mock.env, sleep: noSleep });

    assert.equal(written.name, 'falcone-ws-wA');
    assert.equal(mock.calls.configure, 1);
    assert.equal(mock.calls.reload, 1);
    assert.equal(mock.getIdentities().length, 1);
    assert.equal(mock.getIdentities()[0].name, 'falcone-ws-wA');
    // Signing actually happened.
    assert.ok(mock.authSeen.every((a) => a && a.startsWith('AWS4-HMAC-SHA256')));
  } finally {
    await mock.close();
  }
});

test('writeIdentity upserts without clobbering other workspace identities', async () => {
  const mock = await startMockServer();
  try {
    const opts = { sleep: noSleep, env: mock.env };
    await writeIdentity({ name: 'falcone-ws-wA', accessKey: 'TEST_AK_A0001', secretKey: 'test-secret-a', actions: ['Read'], buckets: ['ten-a-ws-1'] }, opts);
    await writeIdentity({ name: 'falcone-ws-wB', accessKey: 'TEST_AK_B0001', secretKey: 'test-secret-b', actions: ['Read'], buckets: ['ten-b-ws-1'] }, opts);
    // Replace wA (rotation-style) — wB must survive.
    await writeIdentity({ name: 'falcone-ws-wA', accessKey: 'TEST_AK_A0002', secretKey: 'test-secret-a2', actions: ['Read'], buckets: ['ten-a-ws-1'] }, opts);

    const names = mock.getIdentities().map((i) => i.name).sort();
    assert.deepEqual(names, ['falcone-ws-wA', 'falcone-ws-wB']);
    const wA = mock.getIdentities().find((i) => i.name === 'falcone-ws-wA');
    assert.equal(wA.credentials[0].accessKey, 'TEST_AK_A0002');
  } finally {
    await mock.close();
  }
});

test('writeIdentity retries on a transient 5xx then succeeds', async () => {
  const mock = await startMockServer({ failConfigureTimes: 1 });
  try {
    await writeIdentity({
      name: 'falcone-ws-wA',
      accessKey: 'TEST_AK_TENANTA0001',
      secretKey: 'test-secret-tenant-a-0001',
      actions: ['Read'],
      buckets: ['ten-a-ws-1']
    }, { env: mock.env, sleep: noSleep });

    // First configure 503'd, retry succeeded → 2 configure calls total.
    assert.equal(mock.calls.configure, 2);
    assert.equal(mock.getIdentities().length, 1);
  } finally {
    await mock.close();
  }
});

test('writeIdentity surfaces a persistent 5xx as IAM_WRITE_FAILED after max attempts', async () => {
  const mock = await startMockServer({ failConfigureTimes: 99 });
  try {
    await assert.rejects(
      () => writeIdentity(
        { name: 'falcone-ws-wA', accessKey: 'TEST_AK_A', secretKey: 'test-secret', actions: ['Read'], buckets: ['ten-a-ws-1'] },
        { env: mock.env, sleep: noSleep }
      ),
      (err) => err.code === SEAWEEDFS_IAM_ERROR_CODES.IAM_WRITE_FAILED
    );
    assert.equal(mock.calls.configure, 3); // DEFAULT_MAX_ATTEMPTS
  } finally {
    await mock.close();
  }
});

test('writeIdentity fail-closes on an empty bucket list before any backend call', async () => {
  const mock = await startMockServer();
  try {
    await assert.rejects(
      () => writeIdentity(
        { name: 'falcone-ws-wA', accessKey: 'TEST_AK_A', secretKey: 'test-secret', actions: ['Read'], buckets: [] },
        { env: mock.env, sleep: noSleep }
      ),
      (err) => err.code === SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE
    );
    assert.equal(mock.calls.configure, 0, 'no identity write should reach the backend');
  } finally {
    await mock.close();
  }
});

test('writeIdentity fail-closes on a wildcard bucket (no backend call)', async () => {
  // The scope guard runs before any transport is resolved, so even with no IAM
  // config the wildcard is rejected with INVALID_IDENTITY_SCOPE.
  await assert.rejects(
    () => writeIdentity(
      { name: 'falcone-ws-wA', accessKey: 'TEST_AK_A', secretKey: 'test-secret', actions: ['Read'], buckets: ['*'] },
      { env: {}, sleep: noSleep }
    ),
    (err) => err.code === SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE
  );
});

test('buildSeaweedFSIdentity fail-closes on an empty action set', () => {
  assert.throws(
    () => buildSeaweedFSIdentity({ name: 'falcone-ws-wA', accessKey: 'a', secretKey: 's', actions: [], buckets: ['ten-a-ws-1'] }),
    (err) => err.code === SEAWEEDFS_IAM_ERROR_CODES.INVALID_IDENTITY_SCOPE
  );
});

test('deleteIdentity removes the identity and is idempotent', async () => {
  const mock = await startMockServer();
  try {
    await writeIdentity({ name: 'falcone-ws-wA', accessKey: 'TEST_AK_A', secretKey: 'test-secret', actions: ['Read'], buckets: ['ten-a-ws-1'] }, { sleep: noSleep, env: mock.env });

    const first = await deleteIdentity('falcone-ws-wA', { env: mock.env, sleep: noSleep });
    assert.deepEqual(first, { name: 'falcone-ws-wA', deleted: true });
    assert.equal(mock.getIdentities().length, 0);

    // Deleting again is a success (idempotent), just reports deleted:false.
    const second = await deleteIdentity('falcone-ws-wA', { env: mock.env, sleep: noSleep });
    assert.deepEqual(second, { name: 'falcone-ws-wA', deleted: false });
  } finally {
    await mock.close();
  }
});

test('reloadIdentities triggers a backend reload', async () => {
  const mock = await startMockServer();
  try {
    const result = await reloadIdentities({ env: mock.env, sleep: noSleep });
    assert.deepEqual(result, { reloaded: true });
    assert.equal(mock.calls.reload, 1);
  } finally {
    await mock.close();
  }
});

test('updateIdentityActions re-scopes an existing identity while preserving its credentials', async () => {
  const mock = await startMockServer();
  try {
    await writeIdentity(
      { name: 'falcone-ws-wA', accessKey: 'TEST_AK_A', secretKey: 'test-secret', actions: ['Read', 'Write', 'List'], buckets: ['ten-a-ws-1'] },
      { sleep: noSleep, env: mock.env }
    );
    const before = mock.getIdentities()[0];

    const result = await updateIdentityActions(
      { name: 'falcone-ws-wA', actions: ['Read', 'List'], buckets: ['ten-a-ws-1'] },
      { sleep: noSleep, env: mock.env }
    );

    assert.deepEqual(result.actions, ['Read:ten-a-ws-1', 'List:ten-a-ws-1']);
    const after = mock.getIdentities()[0];
    assert.deepEqual(after.credentials, before.credentials, 'credentials are preserved across an action update');
    assert.deepEqual(after.actions, ['Read:ten-a-ws-1', 'List:ten-a-ws-1']);
  } finally {
    await mock.close();
  }
});

test('updateIdentityActions throws IDENTITY_NOT_FOUND for a missing identity (no implicit create)', async () => {
  const mock = await startMockServer();
  try {
    await assert.rejects(
      () => updateIdentityActions({ name: 'falcone-ws-missing', actions: ['Read'], buckets: ['ten-a-ws-1'] }, { sleep: noSleep, env: mock.env }),
      (err) => err.code === SEAWEEDFS_IAM_ERROR_CODES.IDENTITY_NOT_FOUND
    );
    assert.equal(mock.calls.configure, 0, 'no write happens when the identity is absent');
  } finally {
    await mock.close();
  }
});

test('missing IAM config raises IAM_CONFIG_MISSING', async () => {
  await assert.rejects(
    () => writeIdentity(
      { name: 'falcone-ws-wA', accessKey: 'TEST_AK_A', secretKey: 'test-secret', actions: ['Read'], buckets: ['ten-a-ws-1'] },
      { env: {}, sleep: noSleep }
    ),
    (err) => err.code === SEAWEEDFS_IAM_ERROR_CODES.IAM_CONFIG_MISSING
  );
});
