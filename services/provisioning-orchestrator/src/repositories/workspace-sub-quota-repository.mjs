import { randomUUID } from 'node:crypto';
import { WorkspaceSubQuota, fromRow } from '../models/workspace-sub-quota.mjs';

function ensureStore(db) { db._workspaceSubQuotas ??= []; db._planAuditEvents ??= []; return db; }
function nowIso() { return new Date().toISOString(); }
function matches(row, { tenantId, workspaceId, dimensionKey }) {
  return row.tenantId === tenantId && row.workspaceId === workspaceId && row.dimensionKey === dimensionKey;
}

export async function getTotalAllocatedExcluding({ tenantId, dimensionKey, excludeWorkspaceId }, pgClient) {
  if (pgClient._workspaceSubQuotas !== undefined) {
    ensureStore(pgClient);
    return pgClient._workspaceSubQuotas
      .filter((row) => row.tenantId === tenantId && row.dimensionKey === dimensionKey && row.workspaceId !== excludeWorkspaceId)
      .reduce((sum, row) => sum + Number(row.allocatedValue), 0);
  }
  const { rows } = await pgClient.query(
    `SELECT COALESCE(SUM(allocated_value), 0) AS total
       FROM workspace_sub_quotas
      WHERE tenant_id = $1 AND dimension_key = $2 AND workspace_id <> $3
      FOR UPDATE`,
    [tenantId, dimensionKey, excludeWorkspaceId]
  );
  return Number(rows[0]?.total ?? 0);
}

export async function upsertSubQuota({ tenantId, workspaceId, dimensionKey, allocatedValue, actorId }, tenantEffectiveLimit, pgClient) {
  if (pgClient._workspaceSubQuotas !== undefined) {
    ensureStore(pgClient);
    const existing = pgClient._workspaceSubQuotas.find((row) => matches(row, { tenantId, workspaceId, dimensionKey })) ?? null;
    const existingSum = await getTotalAllocatedExcluding({ tenantId, dimensionKey, excludeWorkspaceId: workspaceId }, pgClient);
    if (tenantEffectiveLimit !== -1 && existingSum + allocatedValue > tenantEffectiveLimit) {
      throw Object.assign(new Error('Sub quota exceeds tenant limit'), { code: 'SUB_QUOTA_EXCEEDS_TENANT_LIMIT', statusCode: 422 });
    }
    const timestamp = nowIso();
    if (existing) {
      const previousValue = Number(existing.allocatedValue);
      existing.allocatedValue = allocatedValue;
      existing.updatedBy = actorId;
      existing.updatedAt = timestamp;
      return { subQuota: fromRow(existing), isNew: false, previousValue };
    }
    const row = new WorkspaceSubQuota({ id: randomUUID(), tenantId, workspaceId, dimensionKey, allocatedValue, createdBy: actorId, updatedBy: actorId, createdAt: timestamp, updatedAt: timestamp });
    pgClient._workspaceSubQuotas.push({ ...row });
    return { subQuota: row, isNew: true, previousValue: null };
  }

  await pgClient.query('BEGIN');
  try {
    await pgClient.query(`SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
    const existingSum = await getTotalAllocatedExcluding({ tenantId, dimensionKey, excludeWorkspaceId: workspaceId }, pgClient);
    if (tenantEffectiveLimit !== -1 && existingSum + allocatedValue > tenantEffectiveLimit) {
      throw Object.assign(new Error('Sub quota exceeds tenant limit'), { code: 'SUB_QUOTA_EXCEEDS_TENANT_LIMIT', statusCode: 422 });
    }
    const previousResult = await pgClient.query(`SELECT * FROM workspace_sub_quotas WHERE tenant_id = $1 AND workspace_id = $2 AND dimension_key = $3`, [tenantId, workspaceId, dimensionKey]);
    const previous = previousResult.rows[0] ?? null;
    const { rows } = await pgClient.query(
      `INSERT INTO workspace_sub_quotas (tenant_id, workspace_id, dimension_key, allocated_value, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (tenant_id, workspace_id, dimension_key)
       DO UPDATE SET allocated_value = EXCLUDED.allocated_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [tenantId, workspaceId, dimensionKey, allocatedValue, actorId]
    );
    await pgClient.query('COMMIT');
    return { subQuota: fromRow(rows[0]), isNew: !previous, previousValue: previous ? Number(previous.allocated_value) : null };
  } catch (error) {
    try { await pgClient.query('ROLLBACK'); } catch {}
    if (error?.code === '55P03') throw Object.assign(new Error('Lock timeout'), { code: 'LOCK_TIMEOUT', statusCode: 503, cause: error });
    throw error;
  }
}

export async function removeSubQuota({ tenantId, workspaceId, dimensionKey }, pgClient) {
  if (pgClient._workspaceSubQuotas !== undefined) {
    ensureStore(pgClient);
    const index = pgClient._workspaceSubQuotas.findIndex((row) => matches(row, { tenantId, workspaceId, dimensionKey }));
    if (index < 0) throw Object.assign(new Error('Sub quota not found'), { code: 'SUB_QUOTA_NOT_FOUND', statusCode: 404 });
    return fromRow(pgClient._workspaceSubQuotas.splice(index, 1)[0]);
  }
  const { rows } = await pgClient.query(`DELETE FROM workspace_sub_quotas WHERE tenant_id=$1 AND workspace_id=$2 AND dimension_key=$3 RETURNING *`, [tenantId, workspaceId, dimensionKey]);
  if (!rows[0]) throw Object.assign(new Error('Sub quota not found'), { code: 'SUB_QUOTA_NOT_FOUND', statusCode: 404 });
  return fromRow(rows[0]);
}

export async function listSubQuotas({ tenantId, workspaceId = null, dimensionKey = null, limit = 50, offset = 0 }, pgClient) {
  if (pgClient._workspaceSubQuotas !== undefined) {
    ensureStore(pgClient);
    const items = pgClient._workspaceSubQuotas.filter((row) => row.tenantId === tenantId && (!workspaceId || row.workspaceId === workspaceId) && (!dimensionKey || row.dimensionKey === dimensionKey));
    return { items: items.slice(offset, offset + limit).map(fromRow), total: items.length };
  }
  const filters = ['tenant_id = $1'];
  const params = [tenantId];
  if (workspaceId) { params.push(workspaceId); filters.push(`workspace_id = $${params.length}`); }
  if (dimensionKey) { params.push(dimensionKey); filters.push(`dimension_key = $${params.length}`); }
  params.push(limit, offset);
  const { rows } = await pgClient.query(`SELECT *, COUNT(*) OVER() AS total FROM workspace_sub_quotas WHERE ${filters.join(' AND ')} ORDER BY workspace_id ASC, dimension_key ASC LIMIT $${params.length - 1} OFFSET $${params.length}` , params);
  return { items: rows.map(fromRow), total: Number(rows[0]?.total ?? 0) };
}

export async function getSubQuotasForWorkspace({ tenantId, workspaceId }, pgClient) {
  return (await listSubQuotas({ tenantId, workspaceId, limit: 1000, offset: 0 }, pgClient)).items;
}
