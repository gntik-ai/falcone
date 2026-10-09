// Run only against an isolated CI database; each test uses its own schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as store from '../../../apps/control-plane/tenant-store.mjs';

const databaseAvailable = Boolean(process.env.DATABASE_URL || process.env.DB_URL || process.env.PGHOST);
const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;

async function isolatedDatabase(run) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString });
  await client.connect();
  const schema = `invitation_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    await run(client, schema, pg);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
}

test('975: pending legacy rows expire and all unkeyed recipient hints are scrubbed idempotently', { skip: !databaseAvailable && 'Isolated PostgreSQL connection is unavailable' }, async () => {
  await isolatedDatabase(async client => {
    const legacyDigest = 'f8a007c08360846d297596d6664244b1abef84aa96a328b44e1699da2b1e62b3';
    await client.query(`CREATE TABLE tenant_invitations (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, workspace_id TEXT, email_hash TEXT NOT NULL,
      masked_email TEXT, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', expires_at TIMESTAMPTZ NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}', target_bindings JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by TEXT)`);
    await client.query(`INSERT INTO tenant_invitations (id, tenant_id, email_hash, masked_email, role, expires_at, status)
      VALUES ('legacy', 'tenant-test', $1, 'g***t@example.invalid', 'tenant_viewer', NOW()+interval '7 days', 'pending'),
             ('legacy-accepted', 'tenant-test', $1, 'g***t@example.invalid', 'tenant_viewer', NOW()+interval '7 days', 'accepted'),
             ('legacy-revoked', 'tenant-test', $1, 'g***t@example.invalid', 'tenant_viewer', NOW()+interval '7 days', 'revoked'),
             ('legacy-expired', 'tenant-test', $1, 'g***t@example.invalid', 'tenant_viewer', NOW()+interval '7 days', 'expired')`, [legacyDigest]);
    await store.ensureSchema(client);
    await store.insertInvitation(client, { id: 'current', tenantId: 'tenant-test', role: 'tenant_viewer',
      emailHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64), emailHmacKeyId: 'current-key', expiresAt: '2099-01-01T00:00:00Z' });
    await store.ensureSchema(client);
    // Seeded rows share created_at; migrations may change their physical order.
    // Compare every persisted field by identity, independent of tied list ordering.
    const readInvitations = async () => (await store.listInvitations(client, 'tenant-test'))
      .sort((left, right) => left.id.localeCompare(right.id));
    const first = await readInvitations();
    assert.equal(first.length, 5);
    assert.deepEqual(Object.fromEntries(first.map(row => [row.id, row.status])), {
      legacy: 'expired', 'legacy-accepted': 'accepted', 'legacy-revoked': 'revoked',
      'legacy-expired': 'expired', current: 'pending'
    });
    assert.ok(first.every(row => row.masked_email === null && row.email_hash !== legacyDigest));
    assert.ok(first.filter(row => row.email_hmac_key_id === null).every(row => row.email_hash === '' && row.token_hash === null));
    assert.equal(first.find(row => row.id === 'current').email_hash, 'a'.repeat(64));
    await store.ensureSchema(client);
    assert.deepEqual(await readInvitations(), first);
    await client.query(`UPDATE tenant_invitations SET email_hash=$1, masked_email='g***t@example.invalid' WHERE id='legacy-accepted'`, [legacyDigest]);
    await store.ensureSchema(client);
    assert.deepEqual(await readInvitations(), first);
  });
});

test('975: PostgreSQL conditional claim admits exactly one concurrent acceptance', { skip: !databaseAvailable && 'Isolated PostgreSQL connection is unavailable' }, async () => {
  await isolatedDatabase(async (client, schema, pg) => {
    await store.ensureSchema(client);
    await store.insertInvitation(client, { id: 'inv-test', tenantId: 'tenant-test', role: 'tenant_viewer',
      emailHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64), emailHmacKeyId: 'test-key', expiresAt: '2099-01-01T00:00:00Z' });
    const other = new pg.Client({ connectionString });
    await other.connect();
    try {
      await other.query(`SET search_path TO ${schema}, public`);
      const results = await Promise.all([client, other].map(db => store.claimInvitation(db, 'tenant-test', 'inv-test', 'b'.repeat(64), 'a'.repeat(64), 'test-key')));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await store.getInvitation(client, 'tenant-test', 'inv-test')).status, 'accepted');
    } finally { await other.end(); }
  });
});
