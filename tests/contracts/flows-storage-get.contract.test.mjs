import test from 'node:test';
import assert from 'node:assert/strict';

import { routes } from '../../apps/control-plane/routes.mjs';
import { storageGet, storageGetOutputSchema } from '../../apps/workflow-worker/src/activities/storage-get.mjs';

// Template-to-regex rule from control-plane server.mjs compilePath. Importing the
// server itself starts its runtime; derive matching from the real route templates.
function compilePath(template) {
  const rx = template
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

test('storage.get request resolves to the registered GET storageGetObject handler', async () => {
  const requests = [];
  await storageGet(
    {
      params: { bucketId: 'bucket /one', objectKey: 'folder/image one.png' },
      tenant: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      credential: { baseUrl: 'http://control-plane', apiKey: 'fixture-key' },
    },
    {
      http: async (url, options) => {
        requests.push({ url, options });
        return Response.json({ contentBase64: 'AP+A', contentType: 'image/png' });
      },
    },
  );

  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(options.method, 'GET');
  assert.deepEqual(options.headers, { authorization: 'Bearer fixture-key' });
  const pathname = new URL(url).pathname;
  const matches = routes.filter((route) => route.method === options.method && compilePath(route.path).test(pathname));
  assert.equal(matches.length, 1, 'activity URL must resolve to exactly one registered GET route');
  assert.equal(matches[0].localHandler, 'storageGetObject');
  const params = compilePath(matches[0].path).exec(pathname).groups;
  assert.equal(decodeURIComponent(params.bucketId), 'bucket /one');
  assert.equal(decodeURIComponent(params.objectKey), 'folder/image one.png');
});

test('storage.get binary output validates against its unchanged public output schema', async () => {
  const { default: Ajv } = await import('ajv');
  const validate = new Ajv({ strict: false, allErrors: true }).compile(storageGetOutputSchema);
  for (const contentType of ['image/png', 'application/octet-stream', undefined]) {
    const output = await storageGet(
      { params: { bucketId: 'b1', objectKey: 'image.png' }, tenant: { tenantId: 'tenant-a' } },
      { http: async () => Response.json({ contentBase64: 'AP+AAQ==', contentType }) },
    );
    assert.equal(validate(output), true, JSON.stringify(validate.errors));
    assert.equal(output.body, 'AP+AAQ==');
  }
});
