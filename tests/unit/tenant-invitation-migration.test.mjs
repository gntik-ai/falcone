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
    db.exec(`CREATE TABLE tenant_invitations (id TEXT PRIMARY KEY, status TEXT, token_hash TEXT, masked_email TEXT);
      INSERT INTO tenant_invitations VALUES
        ('legacy-pending', 'pending', NULL, 'g***t@example.invalid'),
        ('legacy-accepted', 'accepted', NULL, 'g***t@example.invalid'),
        ('legacy-revoked', 'revoked', NULL, 'g***t@example.invalid'),
        ('legacy-expired', 'expired', NULL, 'g***t@example.invalid'),
        ('current-pending', 'pending', 'current-token-hash', NULL);`);
    const pool = {
      async query(sql) {
        if (/^UPDATE\s+tenant_invitations\b/i.test(sql.trim())) db.exec(sql);
        return { rows: [] };
      }
    };
    const read = () => db.prepare('SELECT id, status, token_hash, masked_email FROM tenant_invitations ORDER BY id').all().map(row => ({ ...row }));
    await ensureSchema(pool);
    const first = read();
    assert.deepEqual(first, [
      { id: 'current-pending', status: 'pending', token_hash: 'current-token-hash', masked_email: null },
      { id: 'legacy-accepted', status: 'accepted', token_hash: null, masked_email: null },
      { id: 'legacy-expired', status: 'expired', token_hash: null, masked_email: null },
      { id: 'legacy-pending', status: 'expired', token_hash: null, masked_email: null },
      { id: 'legacy-revoked', status: 'revoked', token_hash: null, masked_email: null }
    ]);
    await ensureSchema(pool);
    assert.deepEqual(read(), first);
  } finally { db.close(); }
});
