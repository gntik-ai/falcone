import { randomUUID } from 'node:crypto';
import { QuotaOverride, normalizeOverrideRecord, isOverrideExpired } from '../models/quota-override.mjs';

function nowIso(now = new Date()) { return now.toISOString(); }
function ensureStores(db) { db._quotaOverrides ??= []; db._planAuditEvents ??= []; return db; }
function mapRow(row) { return row ? normalizeOverrideRecord(row) : null; }
function matches(record, filters = {}) {
  return (!filters.tenantId || record.tenantId === filters.tenantId)
    && (!filters.dimensionKey || record.dimensionKey === filters.dimensionKey)
    && (!filters.status || record.status === filters.status);
}
async function insertAudit(db, event) {
  if (db._planAuditEvents) {
    db._planAuditEvents.push({ id: randomUUID(), created_at: nowIso(), ...event });
    return;
  }
  await db.query(`INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [event.action_type, event.actor_id, event.tenant_id ?? null, event.plan_id ?? null, JSON.stringify(event.previous_state ?? null), JSON.stringify(event.new_state ?? {}), event.correlation_id ?? null]);
}

export async function createOverride(db, payload = {}) {
  const record = new QuotaOverride(payload);
  if (db._quotaOverrides !== undefined) {
    ensureStores(db);
    const active = db._quotaOverrides.find((item) => item.tenantId === record.tenantId && item.dimensionKey === record.dimensionKey && item.status === 'active');
    if (active) { active.status = 'superseded'; active.supersededBy = record.id; }
    const row = { ...record, overrideId: record.id };
    db._quotaOverrides.push(row);
    await insertAudit(db, { action_type: active ? 'quota.override.superseded' : 'quota.override.created', actor_id: payload.createdBy, tenant_id: payload.tenantId, previous_state: active ? { overrideId: active.id ?? active.overrideId, overrideValue: active.overrideValue } : null, new_state: { overrideId: record.id, dimensionKey: record.dimensionKey, overrideValue: record.overrideValue, quotaType: record.quotaType, graceMargin: record.graceMargin } });
    return { override: mapRow(row), supersededOverrideId: active?.id ?? active?.overrideId ?? null };
  }
  return { override: mapRow({ ...record, overrideId: record.id }), supersededOverrideId: null };
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
  ensureStores(db);
  const row = db._quotaOverrides.find((item) => (item.overrideId ?? item.id) === overrideId);
  if (!row) throw Object.assign(new Error('Override not found'), { code: 'OVERRIDE_NOT_FOUND' });
  if (row.status !== 'active') throw Object.assign(new Error('Override not active'), { code: 'OVERRIDE_NOT_ACTIVE' });
  const previousState = { overrideValue: row.overrideValue, quotaType: row.quotaType, graceMargin: row.graceMargin, expiresAt: row.expiresAt ?? null };
  Object.assign(row, changes, { modifiedBy: actorId, modifiedAt: nowIso(), modificationJustification: justification });
  await insertAudit(db, { action_type: 'quota.override.modified', actor_id: actorId, tenant_id: row.tenantId, previous_state: previousState, new_state: { overrideValue: row.overrideValue, quotaType: row.quotaType, graceMargin: row.graceMargin, expiresAt: row.expiresAt ?? null } });
  return { override: mapRow(row), previousState, newState: { overrideValue: row.overrideValue, quotaType: row.quotaType, graceMargin: row.graceMargin, expiresAt: row.expiresAt ?? null } };
}

export async function revokeOverride(db, { overrideId, actorId, justification }) {
  ensureStores(db);
  const row = db._quotaOverrides.find((item) => (item.overrideId ?? item.id) === overrideId);
  if (!row) throw Object.assign(new Error('Override not found'), { code: 'OVERRIDE_NOT_FOUND' });
  if (row.status !== 'active') throw Object.assign(new Error('Override not active'), { code: 'OVERRIDE_NOT_ACTIVE' });
  row.status = 'revoked'; row.revokedBy = actorId; row.revokedAt = nowIso(); row.revocationJustification = justification;
  await insertAudit(db, { action_type: 'quota.override.revoked', actor_id: actorId, tenant_id: row.tenantId, previous_state: { overrideValue: row.overrideValue, status: 'active' }, new_state: { status: 'revoked', revokedBy: actorId, revocationJustification: justification } });
  return mapRow(row);
}

export async function listOverrides(db, { tenantId = null, dimensionKey = null, status = 'active', page = 1, pageSize = 50 } = {}) {
  ensureStores(db);
  const filtered = db._quotaOverrides.filter((item) => matches(item, { tenantId, dimensionKey, status }));
  const start = (page - 1) * pageSize;
  return { overrides: filtered.slice(start, start + pageSize).map(mapRow), total: filtered.length, page, pageSize };
}

export async function expireOverrides(db, { now = new Date(), batchSize = 100, actorId = 'system' } = {}) {
  ensureStores(db);
  const expired = [];
  for (const row of db._quotaOverrides) {
    if (expired.length >= batchSize) break;
    if (row.status === 'active' && isOverrideExpired(row, now)) {
      row.status = 'expired';
      expired.push(mapRow(row));
      await insertAudit(db, { action_type: 'quota.override.expired', actor_id: actorId, tenant_id: row.tenantId, previous_state: { overrideValue: row.overrideValue, status: 'active', expiresAt: row.expiresAt }, new_state: { status: 'expired' } });
    }
  }
  return expired;
}
