import { PlanChangeHistoryEntry } from '../models/plan-change-history-entry.mjs';

function mapQuotaImpact(row) {
  return {
    dimensionKey: row.dimension_key,
    displayLabel: row.display_label,
    unit: row.unit,
    previousEffectiveValueKind: row.previous_effective_value_kind,
    previousEffectiveValue: row.previous_effective_value,
    newEffectiveValueKind: row.new_effective_value_kind,
    newEffectiveValue: row.new_effective_value,
    comparison: row.comparison,
    observedUsage: row.observed_usage,
    usageObservedAt: row.usage_observed_at,
    usageSource: row.usage_source,
    usageStatus: row.usage_status,
    usageUnknownReason: row.usage_unknown_reason,
    isHardDecrease: row.is_hard_decrease
  };
}

function mapCapabilityImpact(row) {
  return {
    capabilityKey: row.capability_key,
    displayLabel: row.display_label,
    previousState: row.previous_state,
    newState: row.new_state,
    comparison: row.comparison
  };
}

function mapEntry(row, quotaImpacts = [], capabilityImpacts = []) {
  return row ? {
    historyEntryId: row.id,
    planAssignmentId: row.plan_assignment_id,
    tenantId: row.tenant_id,
    previousPlanId: row.previous_plan_id,
    newPlanId: row.new_plan_id,
    actorId: row.actor_id,
    effectiveAt: row.effective_at,
    correlationId: row.correlation_id,
    changeReason: row.change_reason,
    changeDirection: row.change_direction,
    usageCollectionStatus: row.usage_collection_status,
    overLimitDimensionCount: row.over_limit_dimension_count,
    assignmentMetadata: row.assignment_metadata ?? {},
    quotaImpacts,
    capabilityImpacts
  } : null;
}

export async function insertHistoryEntry(client, entry) {
  const model = entry instanceof PlanChangeHistoryEntry ? entry : new PlanChangeHistoryEntry(entry);
  const record = model.toRecord();
  const { rows } = await client.query(
    `INSERT INTO tenant_plan_change_history
      (plan_assignment_id, tenant_id, previous_plan_id, new_plan_id, actor_id, effective_at, correlation_id, change_reason, change_direction, usage_collection_status, over_limit_dimension_count, assignment_metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (plan_assignment_id) DO UPDATE SET plan_assignment_id = EXCLUDED.plan_assignment_id
     RETURNING *`,
    [record.plan_assignment_id, record.tenant_id, record.previous_plan_id, record.new_plan_id, record.actor_id, record.effective_at, record.correlation_id, record.change_reason, record.change_direction, record.usage_collection_status, record.over_limit_dimension_count, JSON.stringify(record.assignment_metadata ?? {})]
  );
  return mapEntry(rows[0]);
}

export async function insertQuotaImpacts(client, historyEntryId, items = []) {
  const inserted = [];
  for (const item of items) {
    const { rows } = await client.query(
      `INSERT INTO tenant_plan_quota_impacts
        (history_entry_id, tenant_id, dimension_key, display_label, unit, previous_effective_value_kind, previous_effective_value, new_effective_value_kind, new_effective_value, comparison, observed_usage, usage_observed_at, usage_source, usage_status, usage_unknown_reason, is_hard_decrease)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (history_entry_id, dimension_key) DO UPDATE SET history_entry_id = EXCLUDED.history_entry_id
       RETURNING *`,
      [historyEntryId, item.tenantId ?? null, item.dimensionKey, item.displayLabel ?? null, item.unit ?? null, item.previousEffectiveValueKind, item.previousEffectiveValue ?? null, item.newEffectiveValueKind, item.newEffectiveValue ?? null, item.comparison, item.observedUsage ?? null, item.usageObservedAt ?? null, item.usageSource ?? null, item.usageStatus, item.usageUnknownReason ?? null, Boolean(item.isHardDecrease)]
    );
    inserted.push(mapQuotaImpact(rows[0]));
  }
  return inserted;
}

export async function insertCapabilityImpacts(client, historyEntryId, items = []) {
  const inserted = [];
  for (const item of items) {
    const { rows } = await client.query(
      `INSERT INTO tenant_plan_capability_impacts
        (history_entry_id, tenant_id, capability_key, display_label, previous_state, new_state, comparison)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (history_entry_id, capability_key) DO UPDATE SET history_entry_id = EXCLUDED.history_entry_id
       RETURNING *`,
      [historyEntryId, item.tenantId ?? null, item.capabilityKey, item.displayLabel ?? null, item.previousState ?? null, item.newState ?? null, item.comparison]
    );
    inserted.push(mapCapabilityImpact(rows[0]));
  }
  return inserted;
}

export async function getHistoryEntry(client, historyEntryId) {
  const headerResult = await client.query('SELECT * FROM tenant_plan_change_history WHERE id = $1', [historyEntryId]);
  const header = headerResult.rows[0];
  if (!header) return null;
  const [quotaResult, capabilityResult] = await Promise.all([
    client.query('SELECT * FROM tenant_plan_quota_impacts WHERE history_entry_id = $1 ORDER BY dimension_key ASC', [historyEntryId]),
    client.query('SELECT * FROM tenant_plan_capability_impacts WHERE history_entry_id = $1 ORDER BY capability_key ASC', [historyEntryId])
  ]);
  return mapEntry(header, quotaResult.rows.map(mapQuotaImpact), capabilityResult.rows.map(mapCapabilityImpact));
}

export async function queryHistoryByTenant(client, tenantId, filters = {}) {
  const page = Math.max(Number(filters.page ?? 1), 1);
  const pageSize = Math.min(Math.max(Number(filters.pageSize ?? 20), 1), 100);
  const offset = (page - 1) * pageSize;
  const where = ['tenant_id = $1'];
  const values = [tenantId];
  if (filters.actorId) {
    values.push(filters.actorId);
    where.push(`actor_id = $${values.length}`);
  }
  if (filters.from) {
    values.push(filters.from);
    where.push(`effective_at >= $${values.length}`);
  }
  if (filters.to) {
    values.push(filters.to);
    where.push(`effective_at <= $${values.length}`);
  }
  const whereSql = where.join(' AND ');
  const countPromise = client.query(`SELECT COUNT(*)::int AS total FROM tenant_plan_change_history WHERE ${whereSql}`, values);
  const headerPromise = client.query(
    `SELECT * FROM tenant_plan_change_history
      WHERE ${whereSql}
      ORDER BY effective_at DESC, id DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset]
  );
  const [countResult, headerResult] = await Promise.all([countPromise, headerPromise]);
  const headers = headerResult.rows;
  const ids = headers.map((row) => row.id);
  if (!ids.length) return { items: [], total: countResult.rows[0]?.total ?? 0, page, pageSize };
  const [quotaResult, capabilityResult] = await Promise.all([
    client.query('SELECT * FROM tenant_plan_quota_impacts WHERE history_entry_id = ANY($1::uuid[]) ORDER BY dimension_key ASC', [ids]),
    client.query('SELECT * FROM tenant_plan_capability_impacts WHERE history_entry_id = ANY($1::uuid[]) ORDER BY capability_key ASC', [ids])
  ]);
  const quotaMap = new Map();
  const capabilityMap = new Map();
  for (const row of quotaResult.rows) {
    const list = quotaMap.get(row.history_entry_id) ?? [];
    list.push(mapQuotaImpact(row));
    quotaMap.set(row.history_entry_id, list);
  }
  for (const row of capabilityResult.rows) {
    const list = capabilityMap.get(row.history_entry_id) ?? [];
    list.push(mapCapabilityImpact(row));
    capabilityMap.set(row.history_entry_id, list);
  }
  return {
    items: headers.map((row) => mapEntry(row, quotaMap.get(row.id) ?? [], capabilityMap.get(row.id) ?? [])),
    total: countResult.rows[0]?.total ?? 0,
    page,
    pageSize
  };
}
