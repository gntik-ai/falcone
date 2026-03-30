export async function upsertSdkPackage(pool, { tenantId, workspaceId, language, specVersion }) {
  const existing = await pool.query(
    `SELECT id, status, download_url, url_expires_at, error_message, spec_version
       FROM workspace_sdk_packages
      WHERE workspace_id = $1 AND language = $2 AND spec_version = $3
      LIMIT 1`,
    [workspaceId, language, specVersion]
  );

  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id,
      status: existing.rows[0].status,
      downloadUrl: existing.rows[0].download_url,
      urlExpiresAt: existing.rows[0].url_expires_at,
      errorMessage: existing.rows[0].error_message,
      specVersion: existing.rows[0].spec_version
    };
  }

  const inserted = await pool.query(
    `INSERT INTO workspace_sdk_packages (tenant_id, workspace_id, language, spec_version, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id, status`,
    [tenantId, workspaceId, language, specVersion]
  );

  return inserted.rows[0];
}

export async function updateSdkPackageStatus(pool, id, { status, downloadUrl = null, urlExpiresAt = null, errorMessage = null }) {
  await pool.query(
    `UPDATE workspace_sdk_packages
        SET status = $2,
            download_url = $3,
            url_expires_at = $4,
            error_message = $5,
            updated_at = now()
      WHERE id = $1`,
    [id, status, downloadUrl, urlExpiresAt, errorMessage]
  );
}

export async function getSdkPackage(pool, workspaceId, language) {
  const result = await pool.query(
    `SELECT id, tenant_id, workspace_id, language, spec_version, status, download_url, url_expires_at, error_message, created_at, updated_at
       FROM workspace_sdk_packages
      WHERE workspace_id = $1 AND language = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [workspaceId, language]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    language: row.language,
    specVersion: row.spec_version,
    status: row.status,
    downloadUrl: row.download_url,
    urlExpiresAt: row.url_expires_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function markStaleSdkPackages(pool, workspaceId, currentSpecVersion) {
  await pool.query(
    `UPDATE workspace_sdk_packages
        SET status = 'stale', updated_at = now()
      WHERE workspace_id = $1 AND status = 'ready' AND spec_version <> $2`,
    [workspaceId, currentSpecVersion]
  );
}
