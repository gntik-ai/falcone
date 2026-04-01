/**
 * Data access for `config_reprovision_audit_log` table.
 * @module repositories/config-reprovision-audit-repository
 */

const ALLOWED_ACTOR_TYPES = new Set(['superadmin', 'sre', 'service_account']);

/**
 * Inserts a row into `config_reprovision_audit_log`.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {Object} record
 * @param {string} record.tenant_id
 * @param {string} record.source_tenant_id
 * @param {string} record.actor_id
 * @param {string} record.actor_type
 * @param {boolean} [record.dry_run]
 * @param {string[]} record.requested_domains
 * @param {string[]} [record.effective_domains]
 * @param {string} [record.identifier_map_hash]
 * @param {string} [record.artifact_checksum]
 * @param {string} record.format_version
 * @param {string} record.result_status
 * @param {Object} [record.domain_summary]
 * @param {Object} [record.resource_summary]
 * @param {string} record.correlation_id
 * @param {string} record.started_at
 * @param {string} record.ended_at
 * @param {string} [record.error_detail]
 * @returns {Promise<{id: string}>}
 */
export async function insertReprovisionAuditLog(pgClient, record) {
  if (!record.tenant_id) throw new Error('tenant_id is required');
  if (!record.source_tenant_id) throw new Error('source_tenant_id is required');
  if (!record.actor_id) throw new Error('actor_id is required');
  if (!record.actor_type || !ALLOWED_ACTOR_TYPES.has(record.actor_type)) {
    throw new Error(`actor_type must be one of: ${[...ALLOWED_ACTOR_TYPES].join(', ')}`);
  }
  if (!record.correlation_id) throw new Error('correlation_id is required');
  if (!record.started_at) throw new Error('started_at is required');
  if (!record.ended_at) throw new Error('ended_at is required');

  const sql = `
    INSERT INTO config_reprovision_audit_log (
      tenant_id, source_tenant_id, actor_id, actor_type, dry_run,
      requested_domains, effective_domains, identifier_map_hash, artifact_checksum,
      format_version, result_status, domain_summary, resource_summary,
      correlation_id, started_at, ended_at, error_detail
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12, $13,
      $14, $15, $16, $17
    )
    RETURNING id
  `;

  const values = [
    record.tenant_id,
    record.source_tenant_id,
    record.actor_id,
    record.actor_type,
    record.dry_run ?? false,
    record.requested_domains,
    record.effective_domains ?? [],
    record.identifier_map_hash ?? null,
    record.artifact_checksum ?? null,
    record.format_version,
    record.result_status,
    record.domain_summary ? JSON.stringify(record.domain_summary) : null,
    record.resource_summary ? JSON.stringify(record.resource_summary) : null,
    record.correlation_id,
    record.started_at,
    record.ended_at,
    record.error_detail ?? null,
  ];

  const result = await pgClient.query(sql, values);
  return { id: result.rows[0].id };
}

/**
 * Retrieve a reprovision audit record by correlation_id.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {string} correlationId
 * @returns {Promise<Object | null>}
 */
export async function getReprovisionAuditByCorrelationId(pgClient, correlationId) {
  const result = await pgClient.query(
    'SELECT * FROM config_reprovision_audit_log WHERE correlation_id = $1',
    [correlationId],
  );
  return result.rows[0] ?? null;
}
