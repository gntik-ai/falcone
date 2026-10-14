import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { secretInventory } from '../../../packages/provisioning-orchestrator/src/actions/secret-inventory.mjs';

test('inventory API returns metadata without values for authorized operator', async () => {
  const result = await secretInventory(
    { domain: 'platform', auth: { roles: ['platform-operator'] } },
    { query: async () => ({ rows: [{ name: 'app-password', domain: 'platform', path: 'platform/postgresql/app-password', createdAt: '2026-03-30T00:00:00Z', updatedAt: '2026-03-30T00:00:00Z', status: 'active', secretType: 'password' }] }) }
  );
  assert.equal(result.statusCode, 200);
  assert.equal('value' in result.body.secrets[0], false);
});

test('inventory joins live versions after pagination and isolates tenants in real Postgres', async t => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set; real Postgres is required');
    return;
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    const schema = `inventory_${randomUUID().replaceAll('-', '')}`;
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET LOCAL search_path TO ${schema}, public`);
    for (const file of [
      '022-secret-metadata.sql',
      '092-secret-rotation.sql'
    ]) {
      await db.query(await readFile(new URL(`../../../packages/provisioning-orchestrator/src/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    // 51 platform rows exercise the default bound and updatedAt ordering.
    await db.query(`INSERT INTO secret_metadata (secret_path, domain, secret_name, secret_type, updated_at)
      SELECT 'platform/key-' || n, 'platform', 'key-' || n, 'password',
             '2026-01-01T00:00:00Z'::timestamptz + n * interval '1 day'
        FROM generate_series(1, 51) n`);
    await db.query(`INSERT INTO secret_metadata (secret_path, domain, tenant_id, secret_name, secret_type)
      VALUES ($1, 'tenant', $2, 'key', 'password'), ($3, 'tenant', $4, 'key', 'password')`,
      [`tenant/${a}/key`, a, `tenant/${b}/key`, b]);
    await db.query(`INSERT INTO secret_version_states
      (secret_path, domain, secret_name, vault_version, state, activated_at, initiated_by)
      VALUES ('platform/key-51', 'platform', 'key-51', 2, 'active', '2026-03-31T00:00:00Z', 'seed'),
             ('platform/key-51', 'platform', 'key-51', 9, 'revoked', '2026-04-02T00:00:00Z', 'seed'),
             ('platform/key-50', 'platform', 'key-50', 3, 'active', '2026-04-01T00:00:00Z', 'seed'),
             ('platform/key-50', 'platform', 'key-50', 2, 'grace', '2026-03-31T00:00:00Z', 'seed'),
             ('platform/key-49', 'platform', 'key-49', 1, 'expired', '2026-03-31T00:00:00Z', 'seed'),
             ('platform/key-48', 'platform', 'key-48', 1, 'grace', '2026-03-30T00:00:00Z', 'seed')`);
    const query = db.query.bind(db);
    const auth = { roles: ['platform-operator'] };
    const response = await secretInventory({ domain: 'platform', auth }, { query });
    assert.equal(response.statusCode, 200);
    assert.deepEqual([response.body.offset, response.body.limit, response.body.secrets.length], [0, 50, 50]);
    assert.deepEqual(response.body.secrets.map(row => row.name), Array.from({ length: 50 }, (_, n) => `key-${51 - n}`));
    const [sole, rotating, expired, grace] = response.body.secrets;
    assert.deepEqual(sole.currentVersion, { vaultVersion: 2, state: 'active', activatedAt: '2026-03-31T00:00:00+00:00' });
    assert.equal(sole.requiresForce, true);
    assert.equal(rotating.currentVersion.vaultVersion, 3);
    assert.equal(rotating.requiresForce, false);
    assert.equal(expired.currentVersion, null);
    assert.equal(expired.requiresForce, false);
    assert.equal(grace.currentVersion.state, 'grace');
    assert.equal(grace.requiresForce, true);
    for (const row of response.body.secrets) {
      assert.deepEqual(Object.keys(row).sort(), ['name', 'domain', 'path', 'createdAt', 'updatedAt', 'status', 'secretType', 'tenantId', 'currentVersion', 'requiresForce'].sort());
      assert.equal(row.tenantId, null);
    }
    const page = await secretInventory({ domain: 'platform', auth, offset: '50', limit: '1' }, { query });
    assert.deepEqual(page.body.secrets.map(row => row.name), ['key-1']);
    const tenant = await secretInventory({ domain: 'tenant', auth: { roles: ['tenant-operator'], tenantId: a } }, { query });
    assert.deepEqual(tenant.body.secrets.map(row => row.tenantId), [a]);
    const selected = await secretInventory({ domain: 'tenant', tenantId: b, auth }, { query });
    assert.deepEqual(selected.body.secrets.map(row => row.tenantId), [b]);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
