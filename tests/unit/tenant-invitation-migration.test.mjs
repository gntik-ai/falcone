import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema } from '../../apps/control-plane/tenant-store.mjs';

// Execute the migration's portable UPDATE statements in a real SQL engine,
// rather than duplicating their predicates in a database fake. PostgreSQL DDL
// and concurrency remain covered by the mandatory real-stack integration suite.
let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node 20 CI uses PostgreSQL instead. */ }

test('975: migration expires only pending legacy invitations and scrubs all recipient hints', {
  skip: !DatabaseSync && 'SQLite unavailable on this Node version; covered by PostgreSQL real-stack tests'
}, async () => {
  const db = new DatabaseSync(':memory:');
  try {
    // Known digest from the issue's reproduced address, independent of the migration.
    const legacyDigest = 'f8a007c08360846d297596d6664244b1abef84aa96a328b44e1699da2b1e62b3';
    db.exec(`CREATE TABLE tenant_invitations (id TEXT PRIMARY KEY, status TEXT, token_hash TEXT, masked_email TEXT,
        email_hash TEXT NOT NULL, email_hmac_key_id TEXT);
      INSERT INTO tenant_invitations VALUES
        ('legacy-pending', 'pending', NULL, 'g***t@example.invalid', '${legacyDigest}', NULL),
        ('legacy-accepted', 'accepted', NULL, 'g***t@example.invalid', '${legacyDigest}', NULL),
        ('legacy-revoked', 'revoked', NULL, 'g***t@example.invalid', '${legacyDigest}', NULL),
        ('legacy-expired', 'expired', NULL, 'g***t@example.invalid', '${legacyDigest}', NULL),
        ('current-pending', 'pending', 'current-token-hash', NULL, 'current-keyed-hmac', 'current-key');`);
    const pool = {
      async query(sql) {
        if (/^UPDATE\s+tenant_invitations\b/i.test(sql.trim())) db.exec(sql);
        return { rows: [] };
      }
    };
    const read = () => db.prepare('SELECT id, status, token_hash, masked_email FROM tenant_invitations ORDER BY id').all().map(row => ({ ...row }));
    await ensureSchema(pool);
    const first = read();
    const identifiers = () => db.prepare('SELECT id, email_hash FROM tenant_invitations ORDER BY id').all().map(row => ({ ...row }));
    const scrubbed = [
      { id: 'current-pending', email_hash: 'current-keyed-hmac' },
      { id: 'legacy-accepted', email_hash: '' },
      { id: 'legacy-expired', email_hash: '' },
      { id: 'legacy-pending', email_hash: '' },
      { id: 'legacy-revoked', email_hash: '' }
    ];
    assert.deepEqual(identifiers(), scrubbed);
    assert.deepEqual(first, [
      { id: 'current-pending', status: 'pending', token_hash: 'current-token-hash', masked_email: null },
      { id: 'legacy-accepted', status: 'accepted', token_hash: null, masked_email: null },
      { id: 'legacy-expired', status: 'expired', token_hash: null, masked_email: null },
      { id: 'legacy-pending', status: 'expired', token_hash: null, masked_email: null },
      { id: 'legacy-revoked', status: 'revoked', token_hash: null, masked_email: null }
    ]);
    await ensureSchema(pool);
    assert.deepEqual(read(), first);
    assert.deepEqual(identifiers(), scrubbed);
    // A final schema run must scrub writes from old pods during a rolling update.
    db.prepare('UPDATE tenant_invitations SET email_hash=?, masked_email=? WHERE id=?')
      .run(legacyDigest, 'g***t@example.invalid', 'legacy-accepted');
    await ensureSchema(pool);
    assert.deepEqual(read(), first);
    assert.deepEqual(identifiers(), scrubbed);
  } finally { db.close(); }
});
