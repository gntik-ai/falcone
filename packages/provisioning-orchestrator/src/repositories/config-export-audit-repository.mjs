/**
 * Data access for `config_export_audit_log` table.
 * @module repositories/config-export-audit-repository
 */

const ALLOWED_ACTOR_TYPES = new Set(['superadmin', 'sre', 'service_account']);

/**
 * Inserts a row into `config_export_audit_log`.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} pgClient
 * @param {Object} record - must match the table columns
 * @param {string} record.tenant_id
 * @param {string} record.actor_id
 * @param {string} record.actor_type
 * @param {string[]} record.domains_requested
 * @param {string[]} record.domains_exported
 * @param {string[]} [record.domains_failed]
 * @param {string[]} [record.domains_not_available]
 * @param {string} record.result_status
 * @param {number} [record.artifact_bytes]
 * @param {string} [record.format_version]
 * @param {string} record.correlation_id
 * @param {string} record.export_started_at
 * @param {string} record.export_ended_at
 * @param {string} [record.error_detail]
 * @returns {Promise<{id: string}>}
 */
export async function insertExportAuditLog(pgClient, record) {
  if (!record.tenant_id) throw new Error('tenant_id is required');
  if (!record.actor_id) throw new Error('actor_id is required');
  if (!record.actor_type || !ALLOWED_ACTOR_TYPES.has(record.actor_type)) {
    throw new Error(`actor_type must be one of: ${[...ALLOWED_ACTOR_TYPES].join(', ')}`);
  }
  if (!record.correlation_id) throw new Error('correlation_id is required');
  if (!record.export_started_at) throw new Error('export_started_at is required');
  if (!record.export_ended_at) throw new Error('export_ended_at is required');
  if (!Array.isArray(record.domains_requested)) throw new Error('domains_requested must be an array');
  if (!Array.isArray(record.domains_exported)) throw new Error('domains_exported must be an array');

  const sql = `
    INSERT INTO config_export_audit_log (
      tenant_id, actor_id, actor_type,
      domains_requested, domains_exported, domains_failed, domains_not_available,
      result_status, artifact_bytes, format_version, correlation_id,
      export_started_at, export_ended_at, error_detail
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6, $7,
      $8, $9, $10, $11,
      $12, $13, $14
    )
    RETURNING id
  `;

  const values = [
    record.tenant_id,
    record.actor_id,
    record.actor_type,
    record.domains_requested,
    record.domains_exported,
    record.domains_failed ?? [],
    record.domains_not_available ?? [],
    record.result_status,
    record.artifact_bytes ?? null,
    record.format_version ?? '1.0',
    record.correlation_id,
    record.export_started_at,
    record.export_ended_at,
    record.error_detail ?? null,
  ];

  const result = await pgClient.query(sql, values);
  return { id: result.rows[0].id };
}
