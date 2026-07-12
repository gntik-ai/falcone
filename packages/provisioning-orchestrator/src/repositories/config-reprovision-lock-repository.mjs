/**
 * Data access for `tenant_config_reprovision_locks` table.
 * @module repositories/config-reprovision-lock-repository
 */

import { randomUUID } from 'node:crypto';

/**
 * Attempt to acquire the reprovision lock for a tenant.
 * If an active lock exists that hasn't expired, throws with code 'LOCK_HELD'.
 * If an expired lock exists, reclaims it.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {Object} params
 * @param {string} params.tenant_id
 * @param {string} params.actor_id
 * @param {string} params.actor_type
 * @param {string} params.source_tenant_id
 * @param {boolean} params.dry_run
 * @param {string} params.correlation_id
 * @param {number} params.ttlMs
 * @returns {Promise<{ lock_token: string, expires_at: string }>}
 */
export async function acquireLock(pgClient, { tenant_id, actor_id, actor_type, source_tenant_id, dry_run, correlation_id, ttlMs }) {
  const lockToken = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // Try to insert; if a row exists, handle it
  const upsertSql = `
    INSERT INTO tenant_config_reprovision_locks (
      tenant_id, lock_token, actor_id, actor_type, source_tenant_id,
      dry_run, correlation_id, status, acquired_at, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), $8)
    ON CONFLICT (tenant_id) DO UPDATE SET
      lock_token = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.lock_token  -- keep old token (will detect conflict below)
        ELSE EXCLUDED.lock_token
      END,
      actor_id = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.actor_id
        ELSE EXCLUDED.actor_id
      END,
      actor_type = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.actor_type
        ELSE EXCLUDED.actor_type
      END,
      source_tenant_id = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.source_tenant_id
        ELSE EXCLUDED.source_tenant_id
      END,
      dry_run = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.dry_run
        ELSE EXCLUDED.dry_run
      END,
      correlation_id = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.correlation_id
        ELSE EXCLUDED.correlation_id
      END,
      status = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.status
        ELSE 'active'
      END,
      acquired_at = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.acquired_at
        ELSE NOW()
      END,
      expires_at = CASE
        WHEN tenant_config_reprovision_locks.status = 'active'
          AND tenant_config_reprovision_locks.expires_at > NOW()
        THEN tenant_config_reprovision_locks.expires_at
        ELSE EXCLUDED.expires_at
      END,
      released_at = NULL,
      error_detail = NULL
    RETURNING lock_token, expires_at::text
  `;

  const result = await pgClient.query(upsertSql, [
    tenant_id, lockToken, actor_id, actor_type, source_tenant_id,
    dry_run, correlation_id, expiresAt,
  ]);

  const row = result.rows[0];

  // If the returned lock_token is not our new one, the lock is held by someone else
  if (row.lock_token !== lockToken) {
    const err = new Error(`Reprovision lock already held for tenant '${tenant_id}'`);
    err.code = 'LOCK_HELD';
    throw err;
  }

  return { lock_token: row.lock_token, expires_at: row.expires_at };
}

/**
 * Release the lock for a tenant, if the token matches.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {Object} params
 * @param {string} params.tenant_id
 * @param {string} params.lock_token
 */
export async function releaseLock(pgClient, { tenant_id, lock_token }) {
  await pgClient.query(
    `UPDATE tenant_config_reprovision_locks SET status = 'released', released_at = NOW() WHERE tenant_id = $1 AND lock_token = $2 AND status = 'active'`,
    [tenant_id, lock_token],
  );
}

/**
 * Mark the lock as failed with an error detail.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {Object} params
 * @param {string} params.tenant_id
 * @param {string} params.lock_token
 * @param {string} params.error_detail
 */
export async function failLock(pgClient, { tenant_id, lock_token, error_detail }) {
  await pgClient.query(
    `UPDATE tenant_config_reprovision_locks SET status = 'failed', released_at = NOW(), error_detail = $3 WHERE tenant_id = $1 AND lock_token = $2 AND status = 'active'`,
    [tenant_id, lock_token, error_detail],
  );
}

/**
 * Get the active lock for a tenant, or null if none.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {string} tenantId
 * @returns {Promise<Object | null>}
 */
export async function getActiveLock(pgClient, tenantId) {
  const result = await pgClient.query(
    `SELECT * FROM tenant_config_reprovision_locks WHERE tenant_id = $1 AND status = 'active' AND expires_at > NOW()`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}
