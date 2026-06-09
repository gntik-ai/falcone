function mapRow(row) {
  return row ? { ...row } : null;
}

// Active storage programmatic credentials whose policy expiry has elapsed:
// last_rotated_at + max_storage_credential_age_days days <= now(). Only tenants
// with a configured max_storage_credential_age_days (non-null) participate, so a
// tenant without a storage rotation policy is never returned.
export async function listExpiredStorageCredentials(client, batchSize = 200) {
  const result = await client.query(
    `SELECT c.credential_id,
            c.tenant_id,
            c.workspace_id,
            c.display_name,
            c.principal_type,
            c.principal_id,
            c.secret_version,
            c.created_at,
            c.last_rotated_at,
            p.max_storage_credential_age_days,
            EXISTS (
              SELECT 1 FROM storage_credential_rotation_states s
              WHERE s.credential_id = c.credential_id AND s.state = 'in_progress'
            ) AS rotation_in_progress
       FROM storage_programmatic_credentials c
       JOIN tenant_rotation_policies p ON p.tenant_id = c.tenant_id
      WHERE c.state = 'active'
        AND p.max_storage_credential_age_days IS NOT NULL
        AND c.last_rotated_at + (p.max_storage_credential_age_days * interval '1 day') <= now()
      ORDER BY c.last_rotated_at ASC
      LIMIT $1`,
    [batchSize]
  );

  return result.rows.map(mapRow);
}
