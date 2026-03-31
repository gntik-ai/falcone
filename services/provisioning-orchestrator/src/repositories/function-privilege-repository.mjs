function mapAssignment(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    memberId: row.member_id,
    functionDeployment: row.function_deployment,
    functionInvocation: row.function_invocation,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at
  };
}

function mapDenial(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    actorId: row.actor_id,
    actorType: row.actor_type,
    attemptedOperation: row.attempted_operation,
    requiredSubdomain: row.required_subdomain,
    presentedSubdomains: row.presented_subdomains ?? [],
    topLevelDomain: row.top_level_domain,
    requestPath: row.request_path,
    httpMethod: row.http_method,
    targetFunctionId: row.target_function_id,
    correlationId: row.correlation_id,
    deniedReason: row.denied_reason,
    sourceIp: row.source_ip,
    deniedAt: row.denied_at
  };
}

export async function upsert(client, assignment) {
  const previousResult = await client.query(
    `SELECT id, function_deployment, function_invocation FROM function_privilege_assignments WHERE tenant_id = $1 AND workspace_id = $2 AND member_id = $3`,
    [assignment.tenantId, assignment.workspaceId, assignment.memberId]
  );
  const previous = previousResult.rows[0] ?? null;
  const result = await client.query(
    `INSERT INTO function_privilege_assignments (tenant_id, workspace_id, member_id, function_deployment, function_invocation, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, workspace_id, member_id)
     DO UPDATE SET function_deployment = EXCLUDED.function_deployment,
                   function_invocation = EXCLUDED.function_invocation,
                   assigned_by = EXCLUDED.assigned_by,
                   updated_at = now()
     RETURNING *`,
    [assignment.tenantId, assignment.workspaceId, assignment.memberId, assignment.functionDeployment, assignment.functionInvocation, assignment.assignedBy]
  );
  const row = result.rows[0];
  const transitions = [];
  for (const [subdomain, field] of [['function_deployment', 'functionDeployment'], ['function_invocation', 'functionInvocation']]) {
    const nextValue = Boolean(assignment[field]);
    const prevValue = previous ? Boolean(previous[subdomain]) : false;
    if (prevValue === nextValue) continue;
    transitions.push({ assignmentId: row.id, privilegeSubdomain: subdomain, changeType: nextValue ? 'assigned' : 'revoked' });
    await client.query(
      `INSERT INTO function_privilege_assignment_history (assignment_id, tenant_id, workspace_id, member_id, privilege_subdomain, change_type, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, assignment.tenantId, assignment.workspaceId, assignment.memberId, subdomain, nextValue ? 'assigned' : 'revoked', assignment.assignedBy]
    );
  }
  return { assignment: mapAssignment(row), transitions };
}

export async function findByWorkspaceMember(pool, workspaceId, memberId) {
  const result = await pool.query(`SELECT * FROM function_privilege_assignments WHERE workspace_id = $1 AND member_id = $2`, [workspaceId, memberId]);
  return mapAssignment(result.rows[0]);
}

export async function listByWorkspace(pool, workspaceId) {
  const result = await pool.query(`SELECT * FROM function_privilege_assignments WHERE workspace_id = $1 ORDER BY member_id`, [workspaceId]);
  return result.rows.map(mapAssignment);
}

export async function recordDenial(pool, denialEvent) {
  const result = await pool.query(
    `INSERT INTO function_privilege_denials (tenant_id, workspace_id, actor_id, actor_type, attempted_operation, required_subdomain, presented_subdomains, top_level_domain, request_path, http_method, target_function_id, correlation_id, denied_reason, source_ip, denied_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (correlation_id) DO NOTHING
     RETURNING *`,
    [denialEvent.tenantId, denialEvent.workspaceId, denialEvent.actorId, denialEvent.actorType, denialEvent.attemptedOperation, denialEvent.requiredSubdomain, denialEvent.presentedSubdomains ?? [], denialEvent.topLevelDomain ?? null, denialEvent.requestPath, denialEvent.httpMethod, denialEvent.targetFunctionId ?? null, denialEvent.correlationId, denialEvent.deniedReason, denialEvent.sourceIp ?? null, denialEvent.deniedAt ?? new Date().toISOString()]
  );
  return result.rows[0] ? mapDenial(result.rows[0]) : null;
}

export async function queryDenials(pool, filters = {}) {
  const clauses = [];
  const values = [];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (filters.tenantId) add('tenant_id = ?', filters.tenantId);
  if (filters.workspaceId) add('workspace_id = ?', filters.workspaceId);
  if (filters.requiredSubdomain) add('required_subdomain = ?', filters.requiredSubdomain);
  if (filters.attemptedOperation) add('attempted_operation = ?', filters.attemptedOperation);
  if (filters.actorId) add('actor_id = ?', filters.actorId);
  if (filters.from) add('denied_at >= ?', filters.from);
  if (filters.to) add('denied_at <= ?', filters.to);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(Number(filters.limit ?? 50), Number(filters.offset ?? 0));
  const sql = `SELECT *, COUNT(*) OVER() AS total_count FROM function_privilege_denials ${where} ORDER BY denied_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;
  const result = await pool.query(sql, values);
  return { denials: result.rows.map(mapDenial), total: Number(result.rows[0]?.total_count ?? 0) };
}
