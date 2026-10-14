import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeFunctionsFamilySource } from '../../scripts/lib/functions-family-source.mjs';
import * as sources from '../../scripts/lib/public-api-family-source.mjs';

test('generator composition reports a functions shared-schema edit instead of reverting it from storage', () => {
  const read = path => JSON.parse(readFileSync(path, 'utf8'));
  const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');
  const functions = read('apps/control-plane-executor/openapi/families/functions.openapi.json');
  const storage = read('apps/control-plane-executor/openapi/families/storage.openapi.json');
  functions.components.schemas.ErrorResponse.description = 'Updated functions error contract';

  assert.throws(() => {
    const merged = mergeFunctionsFamilySource(document, functions, document.info.version);
    sources.mergePublicApiFamilySource(merged, storage, document.info.version, 'storage');
  }, /Shared component conflict.*functions.*#\/components\/schemas\/ErrorResponse/);
  assert.notEqual(document.components.schemas.ErrorResponse.description, 'Updated functions error contract');
});

test('family generation detects transitive shared conflicts and preserves synchronized edits', () => {
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  const document = {
    info: { version: '1.22.0' },
    paths: {
      '/functions': { get: { 'x-family': 'functions', responses: { 200: { schema: ref('SharedEnvelope') } } } },
      '/storage': { get: { 'x-family': 'storage', responses: { 200: { schema: ref('SharedEnvelope') } } } },
    },
    components: { schemas: {
      SharedEnvelope: { properties: { error: ref('SharedError') } },
      SharedError: { type: 'string', description: 'Original error contract' },
    } },
  };
  const functions = { paths: { '/functions': document.paths['/functions'] }, components: structuredClone(document.components) };
  const storage = { paths: { '/storage': document.paths['/storage'] }, components: structuredClone(document.components) };
  const compose = () => sources.mergePublicApiFamilySource(
    mergeFunctionsFamilySource(document, functions, '1.22.0'), storage, '1.22.0', 'storage',
  );

  storage.components.schemas.SharedError.description = 'Updated shared error contract';
  assert.throws(compose, /Shared component conflict.*storage.*#\/components\/schemas\/SharedError/);
  document.components.schemas.SharedError.description = 'Updated shared error contract';
  assert.throws(compose, /Shared component conflict.*functions.*#\/components\/schemas\/SharedError/);
  functions.components.schemas.SharedError.description = 'Updated shared error contract';
  const merged = compose();
  assert.equal(merged.components.schemas.SharedError.description, 'Updated shared error contract');
  assert.deepEqual(sources.mergePublicApiFamilySource(merged, storage, '1.22.0', 'storage'), merged);
});

test('storage family generation replaces response contracts and prunes only orphaned schemas', () => {
  const ref = name => ({ $ref: `#/components/schemas/${name}` });
  const document = {
    info: { version: '1.22.0' },
    paths: {
      '/objects': { get: { 'x-family': 'storage', responses: { 200: { schema: ref('StorageObjectDownload') } } } },
      '/metadata': { get: { 'x-family': 'storage', responses: { 200: { schema: ref('StorageObjectMetadata') } } } },
      '/functions': { get: { 'x-family': 'functions', responses: { 200: { schema: ref('Shared') } } } },
    },
    components: { schemas: {
      StorageObjectDownload: { properties: { metadata: ref('StorageObjectMetadata'), payload: ref('StorageObjectPayload') } },
      StorageObjectPayload: { type: 'object' }, StorageObjectMetadata: { type: 'object' }, Shared: { type: 'string' },
    } },
  };
  const family = {
    paths: {
      '/objects': { get: { 'x-family': 'storage', responses: { 200: { schema: ref('StorageObjectReadResult') } } } },
      '/metadata': document.paths['/metadata'],
    },
    components: { schemas: { StorageObjectReadResult: { type: 'object' }, StorageObjectMetadata: { type: 'object' } } },
  };
  const merged = sources.mergePublicApiFamilySource(document, family, '1.22.0', 'storage');
  assert.deepEqual(merged.paths['/objects'], family.paths['/objects']);
  assert.deepEqual(merged.paths['/functions'], document.paths['/functions']);
  assert.deepEqual(Object.keys(merged.components.schemas).sort(), ['Shared', 'StorageObjectMetadata', 'StorageObjectReadResult']);
  assert.deepEqual(sources.mergePublicApiFamilySource(merged, family, '1.22.0', 'storage'), merged);
  assert.ok(document.components.schemas.StorageObjectDownload, 'input is unchanged');
});
