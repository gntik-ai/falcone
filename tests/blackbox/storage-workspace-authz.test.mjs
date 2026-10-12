import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const TENANT = 'tenant-t';
const PAYLOAD = Buffer.from([0x89, 0x50, 0x00, 0xff, 0x41]);
const BUCKETS = [
  { bucket_name: 'bucket-dev', tenant_id: TENANT, workspace_id: 'ws1' },
  { bucket_name: 'bucket-prod', tenant_id: TENANT, workspace_id: 'ws2' },
];
const DENIED = [
  ['unbound viewer', 'tenant_viewer', undefined],
  ['unbound developer', 'tenant_developer', undefined],
  ['development developer', 'tenant_developer', ['ws1']],
  ['development viewer', 'workspace_viewer', ['ws1']],
  ['empty binding', 'tenant_viewer', []],
  ['unbound workspace viewer', 'workspace_viewer', undefined],
];

function identity(role, workspaceIds) {
  const actorType = ['tenant_owner', 'tenant_admin'].includes(role) ? 'tenant_owner'
    : ['workspace_owner', 'workspace_admin'].includes(role) ? 'workspace_admin'
      : ['superadmin', 'internal'].includes(role) ? role : 'tenant_member';
  return { actorType,
    roles: [role], tenantId: TENANT, ...(workspaceIds === undefined ? {} : { workspaceIds }) };
}

function context(caller, records = BUCKETS) {
  return {
    identity: caller, params: { bucketId: 'bucket-prod', objectKey: 'prod-secret.bin', workspaceId: 'ws2' },
    body: {}, query: {}, headers: {},
    pool: { async query(sql, params = []) {
      if (sql.includes('FROM workspace_buckets')) {
        return { rows: sql.includes('WHERE bucket_name') ? records.filter((r) => r.bucket_name === params[0]) : records };
      }
      throw new Error('unexpected database query');
    } },
  };
}

function fakeS3(t) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), options });
    const listing = new URL(url).pathname === '/';
    const xml = listing
      ? '<ListAllMyBucketsResult><Buckets><Bucket><Name>bucket-dev</Name></Bucket><Bucket><Name>bucket-prod</Name></Bucket><Bucket><Name>bucket-foreign</Name></Bucket><Bucket><Name>bucket-orphan</Name></Bucket><Bucket><Name>bucket-unregistered</Name></Bucket></Buckets></ListAllMyBucketsResult>'
      : '<ListBucketResult><Contents><Key>prod-secret.bin</Key><Size>5</Size><ETag>prod-etag</ETag></Contents></ListBucketResult>';
    const range = options.headers.range;
    const status = range === 'bytes=1-3' ? 206 : range ? 416 : 200;
    const manifest = new URL(url).pathname.includes('/.falcone/exports/');
    const bytes = listing || new URL(url).searchParams.has('list-type') ? Buffer.from(xml)
      : manifest ? Buffer.from('{"formatVersion":1,"entries":[]}')
        : status === 206 ? Buffer.from([0x50, 0x00, 0xff])
          : status === 416 ? Buffer.from('<Error><Code>InvalidRange</Code></Error>') : PAYLOAD;
    return { ok: status < 400, status,
      headers: new Map([['content-length', String(bytes.length)], ['content-type', 'application/octet-stream'], ['etag', '"prod-etag"'],
        ...(status === 206 ? [['content-range', 'bytes 1-3/5']] : [])]),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => bytes.toString('utf8'),
    };
  });
  return calls;
}

test('unbound tenant_viewer cannot download production object bytes', async (t) => {
  const calls = fakeS3(t);
  const result = await STORAGE_HANDLERS.storageGetObject(context(identity('tenant_viewer')));
  assert.equal(result.statusCode, 404);
  assert.equal(result.body.code, 'BUCKET_NOT_FOUND');
  assert.equal(calls.length, 0, 'authorization must precede S3');
  assert.deepEqual(Object.keys(result.body).sort(), ['code', 'message']);
});

function assertBucketDenied(result) {
  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.body, { code: 'BUCKET_NOT_FOUND', message: 'bucket bucket-prod not found' });
  assert.equal(result.headers, undefined, 'no metadata headers');
}

test('production metadata is hidden from unbound and development callers', async (t) => {
  const calls = fakeS3(t);
  for (const [name, role, bindings] of DENIED) {
    const result = await STORAGE_HANDLERS.storageObjectMetadata(context(identity(role, bindings)));
    assertBucketDenied(result);
    assert.equal(calls.length, 0, name);
  }
});

test('production object listing is hidden from unbound and development callers', async (t) => {
  const calls = fakeS3(t);
  for (const [name, role, bindings] of DENIED) {
    assertBucketDenied(await STORAGE_HANDLERS.storageListObjects(context(identity(role, bindings))));
    assert.equal(calls.length, 0, name);
  }
});

test('workspace-addressed routes do not grant authority from the matching path', async (t) => {
  const calls = fakeS3(t);
  for (const handler of ['storageBucketExportManifestGet', 'storageBucketExport', 'storageBucketImport']) {
    for (const [name, role, bindings] of DENIED) {
      const ctx = context(identity(role, bindings));
      ctx.params.manifestId = 'smf_0123456789abcdef01';
      assertBucketDenied(await STORAGE_HANDLERS[handler](ctx));
      assert.equal(calls.length, 0, `${handler}: ${name}`);
    }
  }
});

test('bucket list exposes only authorized workspace buckets', async (t) => {
  const calls = fakeS3(t);
  const records = [...BUCKETS,
    { bucket_name: 'bucket-foreign', tenant_id: 'other-tenant', workspace_id: 'ws2' },
    { bucket_name: 'bucket-orphan', tenant_id: TENANT, workspace_id: null },
  ];
  for (const [caller, expected] of [
    [identity('tenant_viewer'), []],
    [identity('tenant_developer'), []],
    [identity('tenant_developer', ['ws1']), ['bucket-dev']],
    [identity('workspace_viewer', ['ws1']), ['bucket-dev']],
    [identity('tenant_viewer', ['ws2']), ['bucket-prod']],
    [identity('tenant_owner'), ['bucket-dev', 'bucket-prod', 'bucket-orphan']],
    [identity('tenant_admin'), ['bucket-dev', 'bucket-prod', 'bucket-orphan']],
    [{ actorType: 'superadmin' }, ['bucket-dev', 'bucket-prod', 'bucket-foreign', 'bucket-orphan', 'bucket-unregistered']],
    [{ actorType: 'internal' }, ['bucket-dev', 'bucket-prod', 'bucket-foreign', 'bucket-orphan', 'bucket-unregistered']],
  ]) {
    const result = await STORAGE_HANDLERS.storageListBuckets(context(caller, records));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.items.map((item) => item.resourceId), expected);
    assert.equal(result.body.page.size, expected.length);
    if (expected.length === 0) assert.equal(calls.length, 0, 'deny before S3');
  }
});

test('production GET denies every unbound or differently bound caller', async (t) => {
  const calls = fakeS3(t);
  for (const [name, role, bindings] of DENIED) {
    const ctx = context(identity(role, bindings));
    ctx.req = { headers: { range: 'bytes=1-3' } };
    assertBucketDenied(await STORAGE_HANDLERS.storageGetObject(ctx));
    assert.equal(calls.length, 0, name);
  }
});

test('verified production bindings and tenant/platform admins retain byte-identical reads', async (t) => {
  fakeS3(t);
  const callers = [
    ...['tenant_developer', 'tenant_viewer', 'workspace_viewer', 'workspace_developer', 'workspace_admin',
      'workspace_owner', 'workspace_operator', 'workspace_auditor', 'workspace_service_account'].map((role) => identity(role, ['ws2'])),
    identity('tenant_owner'), identity('tenant_admin', ['ws1']),
    { actorType: 'superadmin' }, { actorType: 'internal' },
  ];
  for (const caller of callers) {
    const ctx = context(caller);
    const result = await STORAGE_HANDLERS.storageGetObject(ctx);
    assert.equal(result.statusCode, 200, JSON.stringify(caller));
    assert.deepEqual(Buffer.from(result.body.contentBase64, 'base64'), PAYLOAD);
    assert.equal(result.body.sizeBytes, 5);
    const metadata = await STORAGE_HANDLERS.storageObjectMetadata(ctx);
    assert.equal(metadata.statusCode, 200);
    assert.equal(metadata.body.sizeBytes, 5);
    assert.equal(metadata.body.etag, 'prod-etag');
    const listing = await STORAGE_HANDLERS.storageListObjects(ctx);
    assert.equal(listing.statusCode, 200);
    assert.deepEqual(listing.body.items.map((item) => [item.objectKey, item.sizeBytes, item.etag]), [['prod-secret.bin', 5, 'prod-etag']]);
  }
});

test('authorized range reads preserve partial bytes and clean 416 errors', async (t) => {
  const calls = fakeS3(t);
  const ctx = context(identity('workspace_viewer', ['ws2']));
  ctx.req = { headers: { range: 'bytes=1-3' } };
  const result = await STORAGE_HANDLERS.storageGetObject(ctx);
  assert.equal(result.statusCode, 206);
  assert.deepEqual(Buffer.from(result.body.contentBase64, 'base64'), Buffer.from([0x50, 0x00, 0xff]));
  assert.equal(result.body.sizeBytes, 3);
  assert.deepEqual(result.headers, { 'content-range': 'bytes 1-3/5', 'accept-ranges': 'bytes' });
  assert.equal(calls[0].options.headers.range, 'bytes=1-3');
  ctx.req.headers.range = 'bytes=100-200';
  const unsatisfiable = await STORAGE_HANDLERS.storageGetObject(ctx);
  assert.deepEqual(unsatisfiable, { statusCode: 416, body: {
    code: 'STORAGE_RANGE_NOT_SATISFIABLE', message: 'The requested range is not satisfiable for this object.',
  } });
});

test('cross-tenant, missing registry and missing workspace bindings fail closed', async (t) => {
  const calls = fakeS3(t);
  for (const handler of ['storageGetObject', 'storageObjectMetadata', 'storageListObjects', 'storageBucketExportManifestGet']) {
    for (const caller of [identity('tenant_viewer', ['ws2']), identity('workspace_admin', ['ws2'])]) {
      for (const workspace_id of [null, undefined]) {
        assertBucketDenied(await STORAGE_HANDLERS[handler](context(caller,
          [{ ...BUCKETS[1], workspace_id }])));
      }
      assertBucketDenied(await STORAGE_HANDLERS[handler](context(caller, [])));
    }
    for (const role of ['tenant_owner', 'tenant_admin', 'tenant_developer', 'tenant_viewer', 'workspace_viewer']) {
      const caller = { ...identity(role, ['ws2']), tenantId: 'other-tenant' };
      assertBucketDenied(await STORAGE_HANDLERS[handler](context(caller)));
    }
  }
  assert.equal(calls.length, 0);
});

test('request fields, singular workspaceId and unknown roles cannot confer authority', async (t) => {
  const calls = fakeS3(t);
  const callers = [identity('tenant_viewer', ['ws1']), identity('unknown', ['ws2']),
    { ...identity('tenant_viewer'), workspaceId: 'ws2' },
    { ...identity('tenant_viewer'), workspaceIds: 'ws2' },
    { actorType: 'tenant_owner', tenantId: TENANT, workspaceIds: ['ws2'] },
  ];
  for (const caller of callers) {
    const ctx = context(caller);
    ctx.body = { roles: ['tenant_owner'], tenantId: TENANT, workspaceIds: ['ws2'], workspaceId: 'ws2' };
    ctx.query = { workspaceId: 'ws2', workspaceIds: ['ws2'] };
    ctx.req = { headers: { 'x-workspace-id': 'ws2', 'x-workspace-ids': 'ws2', 'x-actor-type': 'tenant_owner' } };
    for (const handler of ['storageGetObject', 'storageObjectMetadata', 'storageListObjects', 'storageBucketExportManifestGet']) {
      assertBucketDenied(await STORAGE_HANDLERS[handler](ctx));
    }
  }
  assert.equal(calls.length, 0);
});

test('bound manifest readers must also use the correct workspace path', async (t) => {
  const calls = fakeS3(t);
  const ctx = context(identity('workspace_viewer', ['ws2']));
  ctx.params.manifestId = 'smf_0123456789abcdef01';
  const result = await STORAGE_HANDLERS.storageBucketExportManifestGet(ctx);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { formatVersion: 1, entries: [] });
  const before = calls.length;
  ctx.params.workspaceId = 'ws1';
  assertBucketDenied(await STORAGE_HANDLERS.storageBucketExportManifestGet(ctx));
  assert.equal(calls.length, before);
});

test('object-key validation still precedes database, authorization and S3', async (t) => {
  const calls = fakeS3(t);
  const ctx = context(identity('tenant_viewer'));
  ctx.params.objectKey = '..%2Fsecret';
  ctx.pool = { query: async () => { throw new Error('malformed keys must not reach the database'); } };
  for (const handler of ['storageGetObject', 'storageObjectMetadata', 'storagePutObject', 'storageDeleteObject']) {
    const result = await STORAGE_HANDLERS[handler](ctx);
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.code, 'INVALID_OBJECT_KEY');
  }
  assert.equal(calls.length, 0);
});

test('workspace read grants do not widen PUT or DELETE structural authority', async (t) => {
  const calls = fakeS3(t);
  for (const role of ['tenant_viewer', 'tenant_developer', 'workspace_viewer', 'workspace_developer', 'workspace_admin']) {
    for (const handler of ['storagePutObject', 'storageDeleteObject']) {
      const result = await STORAGE_HANDLERS[handler](context(identity(role, ['ws2'])));
      assert.equal(result.statusCode, 403);
      assert.equal(result.body.code, 'FORBIDDEN');
    }
  }
  assert.equal(calls.length, 0);
  for (const [name, role, bindings] of DENIED) {
    for (const handler of ['storagePutObject', 'storageDeleteObject']) {
      assertBucketDenied(await STORAGE_HANDLERS[handler](context(identity(role, bindings))));
      assert.equal(calls.length, 0, name);
    }
  }
});

test('tenant admins and platform actors retain writes on both workspaces', async (t) => {
  const calls = fakeS3(t);
  for (const caller of [identity('tenant_owner'), identity('tenant_admin', ['ws1']), { actorType: 'superadmin' }, { actorType: 'internal' }]) {
    for (const bucket of ['bucket-dev', 'bucket-prod']) {
      const ctx = context(caller);
      ctx.params.bucketId = bucket;
      ctx.body = { contentBase64: 'iVAA/0E=' };
      const put = await STORAGE_HANDLERS.storagePutObject(ctx);
      assert.equal(put.statusCode, 201);
      assert.deepEqual(calls.at(-1).options.body, PAYLOAD);
      const deletion = await STORAGE_HANDLERS.storageDeleteObject(ctx);
      assert.equal(deletion.statusCode, 200);
      assert.equal(calls.at(-1).options.method, 'DELETE');
    }
  }
});
