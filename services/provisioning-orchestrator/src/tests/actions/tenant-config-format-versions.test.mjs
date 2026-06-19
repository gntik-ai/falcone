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

test('returns 401 without any trusted identity headers', async () => {
  // No trusted gateway identity headers at all → unauthenticated (401), not forbidden.
  // (Matches the authoritative anti-spoofing invariant in
  // tests/blackbox/tenant-config-verify-role-claims.test.mjs: a forged Bearer JWT with no
  // gateway headers is never treated as identity.)
  const result = await main({});
  assert.equal(result.statusCode, 401);
});

test('returns 200 for a superadmin with no own-tenant claim', async () => {
  // A platform superadmin carries trusted x-actor-roles but no x-tenant-id; this
  // tenant-agnostic catalog read must succeed for them (was a 401 regression).
  const result = await main({ __ow_headers: { 'x-actor-roles': 'superadmin' } });
  assert.equal(result.statusCode, 200);
  assert.ok(Array.isArray(result.body.versions));
});
