import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/tenant-config-format-versions.mjs';

const defaultAuth = { actor_id: 'sre-1', actor_type: 'sre', scopes: ['platform:admin:config:export'] };

test('returns 200 with format versions info', async () => {
  const result = await main({}, { auth: defaultAuth });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.current_version, '1.0.0');
  assert.ok(result.body.min_migratable_version);
  assert.ok(Array.isArray(result.body.versions));
  assert.ok(result.body.versions.length >= 1);
});

test('version entry has required fields', async () => {
  const result = await main({}, { auth: defaultAuth });
  const v1 = result.body.versions[0];
  assert.ok(v1.version);
  assert.ok(v1.release_date);
  assert.ok(v1.change_notes);
  assert.ok(v1.schema_checksum);
});

test('returns 403 without auth', async () => {
  const result = await main({});
  assert.equal(result.statusCode, 403);
});
