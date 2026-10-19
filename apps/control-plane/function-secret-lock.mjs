// Serialize resolution, runtime projection and registry writes with rotation/revocation.
// PostgreSQL session locks coordinate control-plane replicas; the local queue also supports
// single-process/in-memory stores without requiring a database in pure handler tests.
const queues = new Map();
export async function withFunctionSecretLock(pool, tenantId, workspaceId, operation) {
  const key = JSON.stringify(['function-secrets', tenantId, workspaceId]);
  const previous = queues.get(key) ?? Promise.resolve();
  let unlockLocal;
  const current = new Promise((resolve) => { unlockLocal = resolve; });
  queues.set(key, current);
  await previous;
  let client;
  let locked = false;
  try {
    if (typeof pool?.connect === 'function') {
      client = await pool.connect();
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [key]);
      locked = true;
    }
    return await operation(client ?? pool);
  } finally {
    let releaseError;
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
    } catch (error) {
      releaseError = error; // Discard the connection rather than returning a held session lock.
      throw error;
    } finally {
      try { client?.release(releaseError); }
      finally {
        if (queues.get(key) === current) queues.delete(key);
        unlockLocal();
      }
    }
  }
}
