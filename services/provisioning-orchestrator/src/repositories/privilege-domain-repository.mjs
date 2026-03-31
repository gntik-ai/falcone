function mapAssignment(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    structural_admin: row.structural_admin,
    data_access: row.data_access,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at
  };
}

export async function upsertAssignment(client, { tenantId, workspaceId, memberId, structural_admin, data_access, assignedBy, correlationId }) {
  const existing = await client.query(
    `SELECT id, structural_admin, data_access FROM privilege_domain_assignments WHERE tenant_id = $1 AND workspace_id = $2 AND member_id = $3`,
    [tenantId, workspaceId, memberId]
  );
  const previous = existing.rows[0] ?? null;
  const result = await client.query(
    `INSERT INTO privilege_domain_assignments (tenant_id, workspace_id, member_id, structural_admin, data_access, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, workspace_id, member_id)
     DO UPDATE SET structural_admin = EXCLUDED.structural_admin,
                   data_access = EXCLUDED.data_access,
                   assigned_by = EXCLUDED.assigned_by,
                   updated_at = now()
     RETURNING *`,
    [tenantId, workspaceId, memberId, structural_admin, data_access, assignedBy]
  );
  const row = result.rows[0];
  const transitions = [];
  for (const [domain, nextValue] of [['structural_admin', structural_admin], ['data_access', data_access]]) {
    const previousValue = previous ? Boolean(previous[domain]) : false;
    if (previousValue === nextValue) continue;
    transitions.push({
      assignmentId: row.id,
      changeType: nextValue ? 'assigned' : 'revoked',
      privilegeDomain: domain,
      changedBy: assignedBy,
      correlationId: correlationId ?? null
    });
  }
  for (const transition of transitions) {
    await client.query(
      `INSERT INTO privilege_domain_assignment_history
       (assignment_id, tenant_id, workspace_id, member_id, change_type, privilege_domain, changed_by, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [transition.assignmentId, tenantId, workspaceId, memberId, transition.changeType, transition.privilegeDomain, transition.changedBy, transition.correlationId]
    );
  }
  return { assignment: mapAssignment(row), transitions };
}

export async function getAssignment(pool, { tenantId, workspaceId, memberId }) {
  const result = await pool.query(
    `SELECT * FROM privilege_domain_assignments WHERE tenant_id = $1 AND workspace_id = $2 AND member_id = $3`,
    [tenantId, workspaceId, memberId]
  );
  return mapAssignment(result.rows[0]);
}

export async function listAssignments(pool, { tenantId, workspaceId }) {
  const result = await pool.query(
    `SELECT * FROM privilege_domain_assignments WHERE tenant_id = $1 AND workspace_id = $2 ORDER BY member_id`,
    [tenantId, workspaceId]
  );
  return result.rows.map(mapAssignment);
}

export async function getStructuralAdminCount(client, { workspaceId, tenantId }) {
  const result = await client.query(
    `SELECT COALESCE(structural_admin_count, 0) AS structural_admin_count
     FROM workspace_structural_admin_count WHERE workspace_id = $1 AND tenant_id = $2`,
    [workspaceId, tenantId]
  );
  return Number(result.rows[0]?.structural_admin_count ?? 0);
}

export async function getStructuralAdminCountForUpdate(client, { workspaceId, tenantId }) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS structural_admin_count
       FROM privilege_domain_assignments
      WHERE workspace_id = $1 AND tenant_id = $2 AND structural_admin = true
      FOR UPDATE`,
    [workspaceId, tenantId]
  );
  return Number(result.rows[0]?.structural_admin_count ?? 0);
}

export async function insertDenial(pool, denialRecord) {
  const result = await pool.query(
    `INSERT INTO privilege_domain_denials
      (tenant_id, workspace_id, actor_id, actor_type, credential_domain, required_domain, http_method, request_path, source_ip, correlation_id, denied_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (correlation_id) DO NOTHING
     RETURNING *`,
    [
      denialRecord.tenantId,
      denialRecord.workspaceId,
      denialRecord.actorId,
      denialRecord.actorType,
      denialRecord.credentialDomain,
      denialRecord.requiredDomain,
      denialRecord.httpMethod,
      denialRecord.requestPath,
      denialRecord.sourceIp,
      denialRecord.correlationId,
      denialRecord.deniedAt
    ]
  );
  return result.rows[0] ?? null;
}

export async function queryDenials(pool, { tenantId, workspaceId, requiredDomain, actorId, from, to, limit = 50, offset = 0 }) {
  const filters = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    filters.push(sql.replace('?', `$${values.length}`));
  };
  if (tenantId) add('tenant_id = ?', tenantId);
  if (workspaceId) add('workspace_id = ?', workspaceId);
  if (requiredDomain) add('required_domain = ?', requiredDomain);
  if (actorId) add('actor_id = ?', actorId);
  if (from) add('denied_at >= ?', from);
  if (to) add('denied_at <= ?', to);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS total FROM privilege_domain_denials ${where}`;
  const countResult = await pool.query(countSql, values);
  values.push(limit, offset);
  const listSql = `SELECT * FROM privilege_domain_denials ${where} ORDER BY denied_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;
  const listResult = await pool.query(listSql, values);
  return {
    denials: listResult.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      actorId: row.actor_id,
      actorType: row.actor_type,
      credentialDomain: row.credential_domain,
      requiredDomain: row.required_domain,
      httpMethod: row.http_method,
      requestPath: row.request_path,
      sourceIp: row.source_ip,
      correlationId: row.correlation_id,
      deniedAt: row.denied_at
    })),
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}
