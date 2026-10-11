// Adapt the existing custom-role repository contract to a dedicated PostgreSQL
// client. All ID lookups and mutations are constrained to the verified tenant.
export function tenantRoleStorage(db, identity) {
  if (!db || typeof db.query !== 'function') return db;
  const tenantId = identity.tenantId;
  const one = async (sql, values) => (await db.query(sql, values)).rows[0] ?? null;
  return {
    async listByScope(_tenantId, workspaceId) {
      return (await db.query('SELECT * FROM tenant_custom_roles WHERE tenant_id=$1 AND workspace_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL ORDER BY role_name', [tenantId, workspaceId])).rows;
    },
    findById(id) {
      return one('SELECT * FROM tenant_custom_roles WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [id, tenantId]);
    },
    insert(row) {
      return one('INSERT INTO tenant_custom_roles (tenant_id, workspace_id, role_name, allowed_actions, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [tenantId, row.workspace_id ?? null, row.role_name, row.allowed_actions, row.created_by]);
    },
    update(row) {
      return one('UPDATE tenant_custom_roles SET role_name=$3, allowed_actions=$4, updated_at=$5 WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING *', [row.id, tenantId, row.role_name, row.allowed_actions, row.updated_at]);
    },
    softDelete(row) {
      return one('UPDATE tenant_custom_roles SET deleted_at=$3, updated_at=$3 WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING *', [row.id, tenantId, row.deleted_at]);
    }
  };
}
