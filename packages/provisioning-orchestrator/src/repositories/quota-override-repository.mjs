import { appendPlanAudit } from './plan-audit-repository.mjs';
import { QuotaOverride, normalizeOverrideRecord, isOverrideExpired } from '../models/quota-override.mjs';

function nowIso(now = new Date()) { return now.toISOString(); }
function ensureStores(db) { db._quotaOverrides ??= []; db._planAuditEvents ??= []; return db; }
function mapRow(row) { return row ? normalizeOverrideRecord(row) : null; }
async function transaction(db, run) {
  const pooled = typeof db.connect === 'function' && typeof db.totalCount === 'number';
  const client = pooled ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    if (pooled) client.release();
  }
}
function matches(record, filters = {}) {
  return (!filters.tenantId || record.tenantId === filters.tenantId)
    && (!filters.dimensionKey || record.dimensionKey === filters.dimensionKey)
    && (!filters.status || record.status === filters.status);
}

export async function createOverride(db, payload = {}) {
  const record = new QuotaOverride(payload);
  if (db._quotaOverrides !== undefined) {
    ensureStores(db);
    const active = db._quotaOverrides.find((item) => item.tenantId === record.tenantId && item.dimensionKey === record.dimensionKey && item.status === 'active');
    if (active) { active.status = 'superseded'; active.supersededBy = record.id; }
    const row = { ...record, overrideId: record.id };
    db._quotaOverrides.push(row);
    await appendPlanAudit(db, { action_type: active ? 'quota.override.superseded' : 'quota.override.created', actor_id: payload.createdBy, tenant_id: payload.tenantId, previous_state: active ? { overrideId: active.id ?? active.overrideId, overrideValue: active.overrideValue } : null, new_state: { overrideId: record.id, dimensionKey: record.dimensionKey, overrideValue: record.overrideValue, quotaType: record.quotaType, graceMargin: record.graceMargin } });
    return { override: mapRow(row), supersededOverrideId: active?.id ?? active?.overrideId ?? null };
  }
  return transaction(db, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::int8)', [`quota-override:${record.tenantId}:${record.dimensionKey}`]);
    const active = (await client.query("SELECT * FROM quota_overrides WHERE tenant_id = $1 AND dimension_key = $2 AND status = 'active' FOR UPDATE", [record.tenantId, record.dimensionKey])).rows[0];
    if (active) await client.query("UPDATE quota_overrides SET status = 'superseded' WHERE id = $1", [active.id]);
    const { rows } = await client.query(`INSERT INTO quota_overrides
      (id, tenant_id, dimension_key, override_value, quota_type, grace_margin, justification, expires_at, status, created_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [record.id, record.tenantId, record.dimensionKey, record.overrideValue, record.quotaType, record.graceMargin, record.justification, record.expiresAt, record.status, record.createdBy, record.createdAt]);
    if (active) await client.query('UPDATE quota_overrides SET superseded_by = $2 WHERE id = $1', [active.id, record.id]);
    await appendPlanAudit(client, { action_type: active ? 'quota.override.superseded' : 'quota.override.created', actor_id: payload.createdBy, tenant_id: payload.tenantId, previous_state: active ? { overrideId: active.id, overrideValue: Number(active.override_value) } : null, new_state: { overrideId: record.id, dimensionKey: record.dimensionKey, overrideValue: record.overrideValue, quotaType: record.quotaType, graceMargin: record.graceMargin } }, { inTransaction: true });
    return { override: mapRow(rows[0]), supersededOverrideId: active?.id ?? null };
  });
}

export async function getActiveOverrideByTenantAndDimension(db, tenantId, dimensionKey) {
  if (db._quotaOverrides !== undefined) return mapRow(db._quotaOverrides.find((item) => item.tenantId === tenantId && item.dimensionKey === dimensionKey && item.status === 'active' && !isOverrideExpired(item)));
  const { rows } = await db.query(`SELECT * FROM quota_overrides WHERE tenant_id = $1 AND dimension_key = $2 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 1`, [tenantId, dimensionKey]);
  return mapRow(rows[0]);
}

export async function getOverrideById(db, overrideId) {
  if (db._quotaOverrides !== undefined) return mapRow(db._quotaOverrides.find((item) => (item.overrideId ?? item.id) === overrideId));
  const { rows } = await db.query(`SELECT * FROM quota_overrides WHERE id = $1`, [overrideId]);
  return mapRow(rows[0]);
}

export async function modifyOverride(db, { overrideId, actorId, justification, changes }) {
  if (db._quotaOverrides === undefined) return transaction(db, async client => {
    const row = mapRow((await client.query('SELECT * FROM quota_overrides WHERE id = $1 FOR UPDATE', [overrideId])).rows[0]);
    if (!row) throw Object.assign(new Error('Override not found'), { code: 'OVERRIDE_NOT_FOUND' });
    if (row.status !== 'active') throw Object.assign(new Error('Override not active'), { code: 'OVERRIDE_NOT_ACTIVE' });
    const previousState = { overrideValue: row.overrideValue, quotaType: row.quotaType, graceMargin: row.graceMargin, expiresAt: row.expiresAt ?? null };
    const values = [overrideId, actorId, nowIso(), justification];
    const fields = ['modified_by = $2', 'modified_at = $3', 'modification_justification = $4'];
    for (const [key, column] of Object.entries({ overrideValue: 'override_value', quotaType: 'quota_type', graceMargin: 'grace_margin', expiresAt: 'expires_at' })) {
      if (Object.hasOwn(changes, key)) { values.push(changes[key]); fields.push(`${column} = $${values.length}`); }
    }
    const updated = mapRow((await client.query(`UPDATE quota_overrides SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, values)).rows[0]);
    const newState = { overrideValue: updated.overrideValue, quotaType: updated.quotaType, graceMargin: updated.graceMargin, expiresAt: updated.expiresAt ?? null };
    await appendPlanAudit(client, { action_type: 'quota.override.modified', actor_id: actorId, tenant_id: row.tenantId, previous_state: previousState, new_state: newState }, { inTransaction: true });
    return { override: updated, previousState, newState };
  });
  ensureStores(db);
  const row = db._quotaOverrides.find((item) => (item.overrideId ?? item.id) === overrideId);
  if (!row) throw Object.assign(new Error('Override not found'), { code: 'OVERRIDE_NOT_FOUND' });
  if (row.status !== 'active') throw Object.assign(new Error('Override not active'), { code: 'OVERRIDE_NOT_ACTIVE' });
  const previousState = { overrideValue: row.overrideValue, quotaType: row.quotaType, graceMargin: row.graceMargin, expiresAt: row.expiresAt ?? null };
  Object.assign(row, changes, { modifiedBy: actorId, modifiedAt: nowIso(), modificationJustification: justification });
  await appendPlanAudit(db, { action_type: 'quota.override.modified', actor_id: actorId, tenant_id: row.tenantId, previous_state: previousState, new_state: { overrideValue: row.overrideValue, quotaType: row.quotaType, graceMargin: row.graceMargin, expiresAt: row.expiresAt ?? null } });
  return { override: mapRow(row), previousState, newState: { overrideValue: row.overrideValue, quotaType: row.quotaType, graceMargin: row.graceMargin, expiresAt: row.expiresAt ?? null } };
}

export async function revokeOverride(db, { overrideId, actorId, justification }) {
  if (db._quotaOverrides === undefined) return transaction(db, async client => {
    const row = mapRow((await client.query('SELECT * FROM quota_overrides WHERE id = $1 FOR UPDATE', [overrideId])).rows[0]);
    if (!row) throw Object.assign(new Error('Override not found'), { code: 'OVERRIDE_NOT_FOUND' });
    if (row.status !== 'active') throw Object.assign(new Error('Override not active'), { code: 'OVERRIDE_NOT_ACTIVE' });
    const { rows } = await client.query("UPDATE quota_overrides SET status = 'revoked', revoked_by = $2, revoked_at = $3, revocation_justification = $4 WHERE id = $1 RETURNING *", [overrideId, actorId, nowIso(), justification]);
    await appendPlanAudit(client, { action_type: 'quota.override.revoked', actor_id: actorId, tenant_id: row.tenantId, previous_state: { overrideValue: row.overrideValue, status: 'active' }, new_state: { status: 'revoked', revokedBy: actorId, revocationJustification: justification } }, { inTransaction: true });
    return mapRow(rows[0]);
  });
  ensureStores(db);
  const row = db._quotaOverrides.find((item) => (item.overrideId ?? item.id) === overrideId);
  if (!row) throw Object.assign(new Error('Override not found'), { code: 'OVERRIDE_NOT_FOUND' });
  if (row.status !== 'active') throw Object.assign(new Error('Override not active'), { code: 'OVERRIDE_NOT_ACTIVE' });
  row.status = 'revoked'; row.revokedBy = actorId; row.revokedAt = nowIso(); row.revocationJustification = justification;
  await appendPlanAudit(db, { action_type: 'quota.override.revoked', actor_id: actorId, tenant_id: row.tenantId, previous_state: { overrideValue: row.overrideValue, status: 'active' }, new_state: { status: 'revoked', revokedBy: actorId, revocationJustification: justification } });
  return mapRow(row);
}

export async function listOverrides(db, { tenantId = null, dimensionKey = null, status = 'active', page = 1, pageSize = 50 } = {}) {
  if (db._quotaOverrides === undefined) return transaction(db, async client => {
    const filters = '($1::text IS NULL OR tenant_id = $1) AND ($2::text IS NULL OR dimension_key = $2) AND ($3::text IS NULL OR status = $3)';
    const values = [tenantId || null, dimensionKey || null, status || null];
    const count = await client.query(`SELECT COUNT(*) AS total FROM quota_overrides WHERE ${filters}`, values);
    const { rows } = await client.query(`SELECT * FROM quota_overrides WHERE ${filters} ORDER BY created_at DESC, id LIMIT $4 OFFSET $5`, [...values, pageSize, (page - 1) * pageSize]);
    return { overrides: rows.map(mapRow), total: Number(count.rows[0].total), page, pageSize };
  });
  ensureStores(db);
  const filtered = db._quotaOverrides.filter((item) => matches(item, { tenantId, dimensionKey, status }));
  const start = (page - 1) * pageSize;
  return { overrides: filtered.slice(start, start + pageSize).map(mapRow), total: filtered.length, page, pageSize };
}

export async function expireOverrides(db, { now = new Date(), batchSize = 100, actorId = 'system' } = {}) {
  if (db._quotaOverrides === undefined) return transaction(db, async client => {
    const { rows } = await client.query(`UPDATE quota_overrides SET status = 'expired' WHERE id IN (
      SELECT id FROM quota_overrides WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= $1
      ORDER BY expires_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
    ) RETURNING *`, [now, batchSize]);
    const expired = rows.map(mapRow);
    for (const row of expired) {
      await appendPlanAudit(client, { action_type: 'quota.override.expired', actor_id: actorId, tenant_id: row.tenantId, previous_state: { overrideValue: row.overrideValue, status: 'active', expiresAt: row.expiresAt }, new_state: { status: 'expired' } }, { inTransaction: true });
    }
    return expired;
  });
  ensureStores(db);
  const expired = [];
  for (const row of db._quotaOverrides) {
    if (expired.length >= batchSize) break;
    if (row.status === 'active' && isOverrideExpired(row, now)) {
      row.status = 'expired';
      expired.push(mapRow(row));
      await appendPlanAudit(db, { action_type: 'quota.override.expired', actor_id: actorId, tenant_id: row.tenantId, previous_state: { overrideValue: row.overrideValue, status: 'active', expiresAt: row.expiresAt }, new_state: { status: 'expired' } });
    }
  }
  return expired;
}
