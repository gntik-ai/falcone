/**
 * Data access layer for backup_status_snapshots.
 * ESM sibling of repository.ts — used by black-box tests and the action.js mirror.
 * Only module that knows the table structure.
 */

// Minimal DB interface — in production, use the shared pg client from the monorepo
let _client = null

function getClient() {
  if (_client) return _client
  throw new Error('No DB client injected. Call setClient() before use or set DB_URL.')
}

/** Allow injection for testing */
export function setClient(client) {
  _client = client
}

function rowToSnapshot(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    componentType: row.component_type,
    instanceId: row.instance_id,
    instanceLabel: row.instance_label ?? null,
    deploymentProfile: row.deployment_profile ?? null,
    isSharedInstance: row.is_shared_instance,
    status: row.status,
    lastSuccessfulBackupAt: row.last_successful_backup_at ? new Date(row.last_successful_backup_at) : null,
    lastCheckedAt: new Date(row.last_checked_at),
    detail: row.detail ?? null,
    adapterMetadata: row.adapter_metadata ?? null,
    collectedAt: new Date(row.collected_at),
  }
}

export async function getByTenant(tenantId, options) {
  const db = _client
  if (!db) throw new Error('No DB client injected. Call setClient() before use.')
  const includeShared = options?.includeShared ?? false
  const result = includeShared
    ? await db.query(
        `SELECT * FROM backup_status_snapshots WHERE tenant_id = $1 OR is_shared_instance = TRUE ORDER BY last_checked_at DESC`,
        [tenantId],
      )
    : await db.query(
        `SELECT * FROM backup_status_snapshots WHERE tenant_id = $1 AND is_shared_instance = FALSE ORDER BY last_checked_at DESC`,
        [tenantId],
      )
  return result.rows.map(rowToSnapshot)
}

export async function getAll(options) {
  const db = _client
  if (!db) throw new Error('No DB client injected. Call setClient() before use.')
  const includeShared = options?.includeShared ?? true
  const result = includeShared
    ? await db.query(`SELECT * FROM backup_status_snapshots ORDER BY last_checked_at DESC`)
    : await db.query(
        `SELECT * FROM backup_status_snapshots WHERE is_shared_instance = FALSE ORDER BY last_checked_at DESC`,
      )
  return result.rows.map(rowToSnapshot)
}

export async function upsertSnapshot(snapshot) {
  const db = _client
  if (!db) throw new Error('No DB client injected. Call setClient() before use.')
  await db.query(
    `INSERT INTO backup_status_snapshots
       (tenant_id, component_type, instance_id, instance_label, deployment_profile,
        is_shared_instance, status, last_successful_backup_at, last_checked_at, detail, adapter_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, component_type, instance_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       last_successful_backup_at = EXCLUDED.last_successful_backup_at,
       last_checked_at = EXCLUDED.last_checked_at,
       detail = EXCLUDED.detail,
       adapter_metadata = EXCLUDED.adapter_metadata,
       instance_label = EXCLUDED.instance_label,
       deployment_profile = EXCLUDED.deployment_profile,
       is_shared_instance = EXCLUDED.is_shared_instance,
       collected_at = NOW()`,
    [
      snapshot.tenantId,
      snapshot.componentType,
      snapshot.instanceId,
      snapshot.instanceLabel ?? null,
      snapshot.deploymentProfile ?? null,
      snapshot.isSharedInstance,
      snapshot.status,
      snapshot.lastSuccessfulBackupAt ?? null,
      snapshot.lastCheckedAt,
      snapshot.detail ?? null,
      snapshot.adapterMetadata ? JSON.stringify(snapshot.adapterMetadata) : null,
    ],
  )
}
