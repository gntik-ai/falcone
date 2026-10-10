import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFunctionsFamilySource } from '../../scripts/lib/functions-family-source.mjs';

test('generation uses functions family paths and removes only components orphaned by withdrawal', () => {
  const document = {
    info: { version: '1.21.0' },
    paths: {
      '/v1/functions/served': { get: { 'x-family': 'functions', operationId: 'served', responses: { 200: { $ref: '#/components/schemas/Kept' } } } },
      '/v1/functions/withdrawn': { post: { 'x-family': 'functions', operationId: 'withdrawn', responses: { 200: { $ref: '#/components/schemas/Removed' } } } },
      '/v1/events/kept': { get: { 'x-family': 'events', responses: { 200: { $ref: '#/components/schemas/Shared' } } } },
    },
    components: { schemas: {
      Kept: { type: 'string' },
      Removed: { allOf: [{ $ref: '#/components/schemas/RemovedChild' }, { $ref: '#/components/schemas/Shared' }] },
      RemovedChild: { type: 'string' },
      Shared: { type: 'string' },
      Unrelated: { type: 'string' },
    } },
  };
  const family = { paths: { '/v1/functions/served': document.paths['/v1/functions/served'] }, components: { schemas: { Kept: { type: 'string' } } } };
  const result = mergeFunctionsFamilySource(document, family, '1.22.0');
  assert.equal(result.info.version, '1.22.0');
  assert.deepEqual(Object.keys(result.paths), ['/v1/functions/served', '/v1/events/kept']);
  assert.deepEqual(result.paths['/v1/functions/served'], document.paths['/v1/functions/served']);
  assert.deepEqual(result.paths['/v1/events/kept'], document.paths['/v1/events/kept']);
  assert.deepEqual(Object.keys(result.components.schemas).sort(), ['Kept', 'Shared', 'Unrelated']);
  assert.deepEqual(mergeFunctionsFamilySource(result, family, '1.22.0'), result);
});
