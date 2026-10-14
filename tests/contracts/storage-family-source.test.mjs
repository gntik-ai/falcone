import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../../scripts/lib/functions-family-source.mjs';

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
