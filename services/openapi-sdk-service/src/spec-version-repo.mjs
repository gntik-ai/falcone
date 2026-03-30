export async function getCurrentSpec(pool, workspaceId) {
  const result = await pool.query(
    `SELECT id, tenant_id, workspace_id, spec_version, content_hash, format_json, format_yaml, capability_tags, created_at
       FROM workspace_openapi_versions
      WHERE workspace_id = $1 AND is_current = TRUE
      ORDER BY created_at DESC
      LIMIT 1`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    specVersion: row.spec_version,
    contentHash: row.content_hash,
    formatJson: row.format_json,
    formatYaml: row.format_yaml,
    capabilityTags: row.capability_tags,
    createdAt: row.created_at
  };
}

export async function insertNewSpec(pool, spec) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE workspace_openapi_versions SET is_current = FALSE WHERE workspace_id = $1 AND is_current = TRUE', [spec.workspaceId]);
    const inserted = await client.query(
      `INSERT INTO workspace_openapi_versions
       (tenant_id, workspace_id, spec_version, content_hash, format_json, format_yaml, capability_tags, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING id`,
      [spec.tenantId, spec.workspaceId, spec.specVersion, spec.contentHash, spec.formatJson, spec.formatYaml, spec.capabilityTags]
    );
    await client.query('COMMIT');
    return { id: inserted.rows[0].id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (typeof client.release === 'function') client.release();
  }
}

export async function getSpecHistory(pool, workspaceId, limit = 10) {
  const result = await pool.query(
    `SELECT id, tenant_id, workspace_id, spec_version, content_hash, capability_tags, is_current, created_at
       FROM workspace_openapi_versions
      WHERE workspace_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [workspaceId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    specVersion: row.spec_version,
    contentHash: row.content_hash,
    capabilityTags: row.capability_tags,
    isCurrent: row.is_current,
    createdAt: row.created_at
  }));
}
