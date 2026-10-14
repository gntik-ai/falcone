import test from 'node:test';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const path = '/v1/storage/buckets/{resourceId}/objects/{objectKey}';
const family = await SwaggerParser.dereference('apps/control-plane-executor/openapi/families/storage.openapi.json');
const published = await SwaggerParser.dereference('apps/control-plane-executor/openapi/control-plane.openapi.json');
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });

// Validate the public HTTP result, not internal collaborators or a list of keys.
// Successful statuses must be explicit: the default error response cannot admit them.
function responseViolations(operation, response) {
  const label = `${operation.operationId} ${response.statusCode}`;
  const declared = operation.responses[String(response.statusCode)];
  if (!declared) return [`${label}: status is not declared`];
  const schema = declared.content?.['application/json']?.schema;
  if (!schema) return [`${label}: JSON response schema is not declared`];
  const validate = ajv.compile(schema);
  const errors = validate(response.body) ? [] : [`${label}: ${ajv.errorsText(validate.errors)}`];
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    const header = Object.entries(declared.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    if (!header) errors.push(`${label}: header ${name} is not declared`);
    else {
      const validateHeader = ajv.compile(header.schema);
      if (!validateHeader(value)) errors.push(`${label}: header ${name}: ${ajv.errorsText(validateHeader.errors)}`);
    }
  }
  return errors;
}

function context(body = {}) {
  const bucket = { bucket_name: 'contract-assets', workspace_id: 'fixture-workspace', tenant_id: 'fixture-tenant' };
  return {
    params: { bucketId: bucket.bucket_name, objectKey: 'sample.bin' }, body, query: {}, req: { headers: {} },
    identity: { sub: 'fixture-owner', tenantId: bucket.tenant_id, workspaceId: bucket.workspace_id,
      workspaceIds: [bucket.workspace_id], roles: ['tenant_owner'], actorType: 'tenant_owner' },
    pool: { async query(sql) {
      return { rows: sql.toLowerCase().includes('from workspace_buckets') ? [bucket] : [] };
    } },
  };
}

function storageFixture(t) {
  let stored;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options.method === 'PUT') {
      stored = { bytes: Buffer.from(options.body), contentType: options.headers['content-type'] };
      return new Response('', { status: 200 });
    }
    if (stored) {
      if (options.headers.range === 'bytes=0-3') return new Response(stored.bytes.subarray(0, 4), {
        status: 206, headers: { 'content-type': stored.contentType, 'content-length': '4', 'content-range': 'bytes 0-3/6' },
      });
      return new Response(stored.bytes, { headers: { 'content-type': stored.contentType, 'content-length': String(stored.bytes.length) } });
    }
    return new Response('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
  });
}

test('uploadStorageObject real PUT emits a declared 201 JSON envelope without body scope', async t => {
  storageFixture(t);
  const response = await STORAGE_HANDLERS.storagePutObject(context({ contentBase64: 'AP+AAUFC', contentType: 'application/octet-stream' }));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(responseViolations(family.paths[path].put, response), []);
});

test('downloadStorageObject real GET emits a declared flat 200 envelope and Accept-Ranges', async t => {
  storageFixture(t);
  await STORAGE_HANDLERS.storagePutObject(context({ contentBase64: 'AP+AAUFC', contentType: 'application/octet-stream' }));
  const response = await STORAGE_HANDLERS.storageGetObject(context());
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.contentBase64, 'AP+AAUFC');
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.deepEqual(responseViolations(family.paths[path].get, response), []);
});

test('downloadStorageObject real range GET emits a declared 206 envelope and Content-Range', async t => {
  storageFixture(t);
  await STORAGE_HANDLERS.storagePutObject(context({ contentBase64: 'AP+AAUFC', contentType: 'application/octet-stream' }));
  const ctx = context();
  ctx.req.headers.range = 'bytes=0-3';
  const response = await STORAGE_HANDLERS.storageGetObject(ctx);
  assert.equal(response.statusCode, 206);
  assert.equal(response.body.contentBase64, 'AP+AAQ==');
  assert.equal(response.body.contentRange, 'bytes 0-3/6');
  assert.equal(response.body.partial, true);
  assert.equal(response.headers['content-range'], 'bytes 0-3/6');
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.deepEqual(responseViolations(family.paths[path].get, response), []);
});

test('StorageObjectWriteRequest accepts payload-only scope and rejects body tenantId or workspaceId', () => {
  const validate = ajv.compile(family.components.schemas.StorageObjectWriteRequest);
  const body = { contentBase64: 'AP+AAUFC', contentType: 'application/octet-stream' };
  assert.equal(validate(body), true, ajv.errorsText(validate.errors));
  for (const field of ['tenantId', 'workspaceId']) {
    assert.equal(validate({ ...body, [field]: 'forbidden' }), false);
    assert.ok(validate.errors.some(error => error.keyword === 'additionalProperties' && error.params.additionalProperty === field));
  }
});

test('conformance guard names uploadStorageObject 202 when a real PUT result status drifts', async t => {
  storageFixture(t);
  const response = await STORAGE_HANDLERS.storagePutObject(context({ contentBase64: 'AP+AAUFC', contentType: 'application/octet-stream' }));
  assert.deepEqual(responseViolations(family.paths[path].put, { ...response, statusCode: 202 }),
    ['uploadStorageObject 202: status is not declared']);
});

test('conformance guard names downloadStorageObject status and missing contentBase64 for both GET variants', async t => {
  storageFixture(t);
  await STORAGE_HANDLERS.storagePutObject(context({ contentBase64: 'AP+AAUFC', contentType: 'application/octet-stream' }));
  for (const range of [undefined, 'bytes=0-3']) {
    const ctx = context();
    if (range) ctx.req.headers.range = range;
    const response = await STORAGE_HANDLERS.storageGetObject(ctx);
    const body = { ...response.body };
    delete body.contentBase64;
    const errors = responseViolations(family.paths[path].get, { ...response, body });
    assert.ok(errors.some(error => error.includes(`downloadStorageObject ${range ? 206 : 200}`) && error.includes('contentBase64')));
  }
});

test('published storage response and request contracts match the family source', () => {
  for (const method of ['get', 'put']) {
    assert.deepEqual(published.paths[path][method].responses, family.paths[path][method].responses);
  }
  assert.deepEqual(published.components.schemas.StorageObjectWriteRequest, family.components.schemas.StorageObjectWriteRequest);
});
